import { describe, it, expect } from 'vitest';
import { emptyState, initWatermarks, ingest, setBuffer } from '../src/mono_state';
import type { MonoStatementItem } from '../src/monobank';

function it_(id: string, time: number, amount = -100): MonoStatementItem {
  return { id, time, description: 'x', mcc: 5411, amount, currencyCode: 980, balance: 0 };
}

describe('initWatermarks', () => {
  it('sets a start watermark only for untracked accounts', () => {
    const s0 = { ...emptyState(), lastSeen: { a: 100 } };
    const s1 = initWatermarks(s0, ['a', 'b'], 999);
    expect(s1.lastSeen).toEqual({ a: 100, b: 999 });
  });
});

describe('ingest', () => {
  it('buffers new items, dedups by id, advances the watermark', () => {
    let s = initWatermarks(emptyState(), ['m1'], 0);
    const r1 = ingest(s, 'm1', 'acct', [it_('a', 10), it_('b', 20)]);
    s = r1.state;
    expect(r1.added).toBe(2);
    expect(s.buffer).toHaveLength(2);
    expect(s.lastSeen.m1).toBe(20);

    // Re-fetching an overlapping window must not double-buffer 'b'.
    const r2 = ingest(s, 'm1', 'acct', [it_('b', 20), it_('c', 30)]);
    s = r2.state;
    expect(r2.added).toBe(1);
    expect(s.buffer.map((x) => x.item.id)).toEqual(['a', 'b', 'c']);
    expect(s.lastSeen.m1).toBe(30);
  });

  it('tags each buffered item with its Actual account id', () => {
    const r = ingest(initWatermarks(emptyState(), ['m1'], 0), 'm1', 'acct-42', [it_('a', 10)]);
    expect(r.state.buffer[0]).toMatchObject({ monoId: 'm1', accountId: 'acct-42' });
  });
});

describe('setBuffer', () => {
  it('replaces the buffer (used to keep only failed items)', () => {
    const s = ingest(initWatermarks(emptyState(), ['m1'], 0), 'm1', 'acct', [it_('a', 10)]).state;
    expect(setBuffer(s, []).buffer).toEqual([]);
  });
});
