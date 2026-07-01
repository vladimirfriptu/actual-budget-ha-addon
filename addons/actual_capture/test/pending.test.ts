import { describe, it, expect } from 'vitest';
import { PendingStore } from '../src/pending';
import type { PostPlan } from '../src/types';

const plan: PostPlan = {
  kind: 'transaction', accountId: 'a', amountMinor: -100, date: '2026-07-01', notes: '#draft',
};

function counterId() {
  let n = 0;
  return () => `id${++n}`;
}

describe('PendingStore', () => {
  it('adds and takes a draft once', () => {
    const store = new PendingStore({ genId: counterId() });
    const id = store.add(plan, 'summary');
    expect(id).toBe('id1');
    const taken = store.take(id);
    expect(taken?.summary).toBe('summary');
    expect(store.take(id)).toBeUndefined(); // second take: gone
    expect(store.size).toBe(0);
  });

  it('returns undefined for an unknown id', () => {
    const store = new PendingStore();
    expect(store.take('nope')).toBeUndefined();
  });

  it('sweeps entries older than the TTL', () => {
    let t = 1000;
    const store = new PendingStore({ ttlMs: 100, now: () => t, genId: counterId() });
    const id = store.add(plan, 's');
    t = 1050; // within TTL
    expect(store.take(id)).toBeDefined();

    const id2 = store.add(plan, 's2');
    t = 2000; // well past TTL → next add sweeps it
    store.add(plan, 's3');
    expect(store.take(id2)).toBeUndefined();
  });
});
