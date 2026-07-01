import { randomUUID } from 'node:crypto';
import type { PostPlan } from './types';

// In-memory store of drafts awaiting the user's ✅. Keyed by a short id carried
// in the Telegram callback_data. Not persisted: on restart pending drafts are
// lost and a late tap is treated as "expired" (see bot.ts).

export interface PendingDraft {
  plan: PostPlan;
  summary: string;
  createdAt: number;
}

const HOUR_MS = 60 * 60 * 1000;

export class PendingStore {
  private readonly map = new Map<string, PendingDraft>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly genId: () => string;

  constructor(opts: { ttlMs?: number; now?: () => number; genId?: () => string } = {}) {
    this.ttlMs = opts.ttlMs ?? HOUR_MS;
    this.now = opts.now ?? Date.now;
    this.genId = opts.genId ?? randomUUID;
  }

  /** Store a draft and return its id. Sweeps expired entries opportunistically. */
  add(plan: PostPlan, summary: string): string {
    this.sweep();
    const id = this.genId();
    this.map.set(id, { plan, summary, createdAt: this.now() });
    return id;
  }

  /** Remove and return a draft (undefined if unknown/expired). */
  take(id: string): PendingDraft | undefined {
    const draft = this.map.get(id);
    if (draft) this.map.delete(id);
    return draft;
  }

  /** Drop entries older than the TTL. */
  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, draft] of this.map) {
      if (draft.createdAt < cutoff) this.map.delete(id);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
