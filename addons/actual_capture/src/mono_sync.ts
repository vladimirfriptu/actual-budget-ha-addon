import type { ActualClient } from './actual';
import type { LlmDeps } from './llm';
import { categorizeBatch } from './llm';
import { resolveAccount, resolveCategory, findTransferPayee } from './mapping';
import { formatMinor } from './money';
import { getClientInfo, getStatement, MonoRateLimitError, type MonoDeps } from './monobank';
import { mapMonoTargets } from './mono_map';
import { planFromMonoItem } from './mono_plan';
import {
  loadState,
  saveState,
  initWatermarks,
  ingest,
  setBuffer,
  type BufferedItem,
  type MonoState,
} from './mono_state';
import type { CategItem } from './types';

// Orchestrates the Monobank poller: pull statements (rate-limited), buffer,
// batch-categorize + flush into Actual as #drafts, and reconcile balances daily.
// Live I/O shell — the correctness-bearing logic lives in the pure modules it
// composes (mono_map, mono_plan, mono_state, llm.categorizeBatch).

export interface MonoSyncConfig {
  pollMinutes: number;
  batchSize: number;
  flushHour: number;
  balanceHour: number;
  startDate: string; // YYYY-MM-DD, or '' for first-run = now
  cashAccountName: string;
}

export interface MonoSyncDeps {
  mono: MonoDeps;
  actual: ActualClient;
  llmDeps: () => LlmDeps;
  notify: (msg: string) => Promise<void>;
  statePath: string;
  now: () => Date;
  log: (msg: string) => void;
}

const MONO_MIN_INTERVAL_MS = 61_000; // Monobank: ~1 request / 60 s per endpoint
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class MonoSync {
  private state: MonoState = { version: 1, lastSeen: {}, seenIds: [], buffer: [] };
  private lastReqAt = 0;
  private polling = false;
  private lastFlushDay = '';
  private lastBalanceDay = '';
  private pollTimer?: NodeJS.Timeout;
  private dailyTimer?: NodeJS.Timeout;

  constructor(private readonly cfg: MonoSyncConfig, private readonly deps: MonoSyncDeps) {}

  async start(): Promise<void> {
    this.state = await loadState(this.deps.statePath);
    const info = await this.gated(() => getClientInfo(this.deps.mono));
    const vocab = await this.deps.actual.getVocab();
    const { targets, skipped } = mapMonoTargets(info, vocab.accounts);
    if (skipped.length) this.deps.log(`[mono] skipped: ${skipped.join(', ')}`);
    if (targets.length === 0) {
      this.deps.log('[mono] no accounts mapped — poller idle');
      return;
    }
    const startSec = this.startSec();
    this.state = initWatermarks(this.state, targets.map((t) => t.monoId), startSec);
    await saveState(this.deps.statePath, this.state);
    this.deps.log(`[mono] active: ${targets.length} accounts, poll every ${this.cfg.pollMinutes}m`);

    this.pollTimer = setInterval(() => void this.safePoll(), this.cfg.pollMinutes * 60_000);
    this.dailyTimer = setInterval(() => void this.tickDaily(), 15 * 60_000);
    void this.safePoll();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.dailyTimer) clearInterval(this.dailyTimer);
  }

  private startSec(): number {
    if (this.cfg.startDate) {
      const ms = Date.parse(`${this.cfg.startDate}T00:00:00Z`);
      if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    }
    return Math.floor(this.deps.now().getTime() / 1000);
  }

  /** Serialize Monobank calls with a ≥61s spacing to respect the rate limit. */
  private async gated<T>(fn: () => Promise<T>): Promise<T> {
    const wait = MONO_MIN_INTERVAL_MS - (Date.now() - this.lastReqAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      this.lastReqAt = Date.now();
    }
  }

  private async safePoll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.poll();
    } catch (err) {
      if (err instanceof MonoRateLimitError) this.deps.log('[mono] rate-limited, will retry next tick');
      else this.deps.log(`[mono] poll error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.polling = false;
    }
  }

  private async poll(): Promise<void> {
    const info = await this.gated(() => getClientInfo(this.deps.mono));
    const vocab = await this.deps.actual.getVocab();
    const { targets } = mapMonoTargets(info, vocab.accounts);
    const nowSec = Math.floor(this.deps.now().getTime() / 1000);

    for (const t of targets) {
      const from = (this.state.lastSeen[t.monoId] ?? this.startSec()) + 1;
      if (from > nowSec) continue;
      const items = await this.gated(() => getStatement(t.monoId, from, nowSec, this.deps.mono));
      if (items.length >= 500) this.deps.log(`[mono] ${t.label}: 500-item page — window may be truncated`);
      const res = ingest(this.state, t.monoId, t.accountId, items);
      this.state = res.state;
      if (res.added) this.deps.log(`[mono] +${res.added} from ${t.label}`);
    }
    await saveState(this.deps.statePath, this.state);

    if (this.state.buffer.length >= this.cfg.batchSize) await this.flush();
  }

  private async tickDaily(): Promise<void> {
    const d = this.deps.now();
    const day = d.toISOString().slice(0, 10);
    const hour = d.getHours();
    if (hour === this.cfg.flushHour && this.lastFlushDay !== day) {
      this.lastFlushDay = day;
      await this.safeFlush();
    }
    if (hour === this.cfg.balanceHour && this.lastBalanceDay !== day) {
      this.lastBalanceDay = day;
      await this.safeBalanceCheck();
    }
  }

  private async safeFlush(): Promise<void> {
    try {
      await this.flush();
    } catch (err) {
      this.deps.log(`[mono] flush error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Categorize the buffer in one LLM call and file each item as a #draft. */
  private async flush(): Promise<void> {
    const items = [...this.state.buffer];
    if (items.length === 0) return;
    const vocab = await this.deps.actual.getVocab();

    const categItems: CategItem[] = items.map((b, index) => ({
      index,
      amountMajor: b.item.amount / 100,
      mcc: b.item.mcc,
      description: b.item.description,
      comment: b.item.comment,
    }));
    let categories: Array<string | null>;
    try {
      categories = await categorizeBatch(categItems, vocab, this.deps.llmDeps());
    } catch (err) {
      this.deps.log(`[mono] categorize failed, filing uncategorized: ${err instanceof Error ? err.message : err}`);
      categories = items.map(() => null);
    }

    const cashAcct = resolveAccount(this.cfg.cashAccountName, vocab.accounts);
    const cashPayee = cashAcct ? findTransferPayee(cashAcct.id, vocab.transferPayees) : null;

    const failed: BufferedItem[] = [];
    let posted = 0;
    let sum = 0;
    for (let i = 0; i < items.length; i++) {
      const b = items[i]!;
      const cat = resolveCategory(categories[i], vocab.categories);
      const date = new Date(b.item.time * 1000).toISOString().slice(0, 10);
      const plan = planFromMonoItem(b.item, {
        accountId: b.accountId,
        date,
        category: cat,
        cashTransferPayeeId: cashPayee?.payeeId,
      });
      try {
        await this.deps.actual.post(plan);
        posted++;
        sum += b.item.amount;
      } catch (err) {
        this.deps.log(`[mono] post failed (${b.item.id}): ${err instanceof Error ? err.message : String(err)}`);
        failed.push(b);
      }
    }

    this.state = setBuffer(this.state, failed);
    await saveState(this.deps.statePath, this.state);

    let msg = `🏦 Моно: завёл ${posted} операций черновиками (${formatMinor(sum)} ₴)`;
    if (failed.length) msg += `\n⚠ не записал ${failed.length}, повторю позже`;
    await this.deps.notify(msg);
  }

  private async safeBalanceCheck(): Promise<void> {
    try {
      await this.balanceCheck();
    } catch (err) {
      this.deps.log(`[mono] balance check error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Compare Monobank balances against Actual (plus not-yet-flushed buffer). */
  private async balanceCheck(): Promise<void> {
    const info = await this.gated(() => getClientInfo(this.deps.mono));
    const vocab = await this.deps.actual.getVocab();
    const { targets } = mapMonoTargets(info, vocab.accounts);
    const monoBalance = new Map<string, number>();
    for (const a of info.accounts) monoBalance.set(a.id, a.balance);
    for (const j of info.jars) monoBalance.set(j.id, j.balance);

    const lines: string[] = [];
    for (const t of targets) {
      const actualBal = await this.deps.actual.getBalance(t.accountId);
      const pending = this.state.buffer
        .filter((b) => b.accountId === t.accountId)
        .reduce((s, b) => s + b.item.amount, 0);
      const mono = monoBalance.get(t.monoId) ?? 0;
      const diff = mono - (actualBal + pending);
      if (Math.abs(diff) > 1) {
        lines.push(`${t.label}: Моно ${formatMinor(mono)} vs Actual ${formatMinor(actualBal + pending)} (Δ ${formatMinor(diff)})`);
      }
    }
    if (lines.length) await this.deps.notify(`⚠ Расхождение балансов:\n${lines.join('\n')}`);
  }
}
