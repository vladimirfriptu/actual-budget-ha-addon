import { mkdir } from 'node:fs/promises';
import * as api from '@actual-app/api';
import type { ActualConnConfig } from './config';
import type { PostPlan, TransactionPlan, TransferPlan, Vocab } from './types';

// Thin wrapper over @actual-app/api. Holds a local copy of the budget that syncs
// with the Actual server (CRDT), so writes merge with concurrent UI edits.
// This module performs live I/O and is intentionally kept minimal.

export class ActualClient {
  private connected = false;

  constructor(private readonly cfg: ActualConnConfig, private readonly dataDir: string) {}

  async connect(): Promise<void> {
    // Actual serves HTTPS with a self-signed cert; this is a same-box LAN call.
    if (this.cfg.actualUrl.startsWith('https:')) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    // @actual-app/api's init scandirs dataDir and fails if it does not exist.
    await mkdir(this.dataDir, { recursive: true });
    await api.init({
      dataDir: this.dataDir,
      serverURL: this.cfg.actualUrl,
      password: this.cfg.actualPassword,
    });
    const opts = this.cfg.actualE2ePassword ? { password: this.cfg.actualE2ePassword } : undefined;
    await api.downloadBudget(this.cfg.actualSyncId, opts);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connected) await api.shutdown();
    this.connected = false;
  }

  /** Pull accounts, categories and transfer payees to feed the LLM and resolver. */
  async getVocab(): Promise<Vocab> {
    // Sync first so a mid-session /refresh sees items added elsewhere (e.g. the seed).
    await api.sync();
    const [accounts, categories, payees] = await Promise.all([
      api.getAccounts(),
      api.getCategories(),
      api.getPayees(),
    ]);
    return {
      accounts: accounts
        .filter((a) => !a.closed)
        .map((a) => ({ id: a.id, name: a.name, offbudget: Boolean(a.offbudget) })),
      // getCategories() returns a (category | group) union; keep leaf categories.
      categories: categories
        .filter((c): c is { id: string; name: string; group_id: string } => 'group_id' in c)
        .map((c) => ({ id: c.id, name: c.name, group: c.group_id })),
      transferPayees: payees
        .filter((p) => p.transfer_acct)
        .map((p) => ({ accountId: p.transfer_acct as string, payeeId: p.id })),
    };
  }

  /** Current cleared+uncleared balance of an account, in integer minor units. */
  async getBalance(accountId: string): Promise<number> {
    await api.sync();
    return api.getAccountBalance(accountId);
  }

  /** File a plan into Actual as a draft (uncleared, #draft in notes). */
  async post(plan: PostPlan): Promise<void> {
    await api.sync();
    if (plan.kind === 'transfer') {
      await this.postTransfer(plan);
    } else {
      await this.postTransaction(plan);
    }
    await api.sync();
  }

  private async postTransaction(plan: TransactionPlan): Promise<void> {
    const txn: Record<string, unknown> = {
      date: plan.date,
      amount: plan.amountMinor,
      cleared: false,
      notes: plan.notes,
    };
    if (plan.categoryId) txn.category = plan.categoryId;
    if (plan.payeeName) txn.payee_name = plan.payeeName;
    if (plan.subtransactions?.length) {
      txn.subtransactions = plan.subtransactions.map((s) => {
        const sub: Record<string, unknown> = { amount: s.amountMinor };
        if (s.categoryId) sub.category = s.categoryId;
        if (s.notes) sub.notes = s.notes;
        return sub;
      });
    }
    await api.addTransactions(plan.accountId, [txn as never], {
      runTransfers: false,
      learnCategories: false,
    });
  }

  private async postTransfer(plan: TransferPlan): Promise<void> {
    const txn: Record<string, unknown> = {
      date: plan.date,
      amount: plan.amountMinor,
      payee: plan.transferPayeeId,
      cleared: false,
      notes: plan.notes,
    };
    await api.addTransactions(plan.fromAccountId, [txn as never], { runTransfers: true });
  }
}
