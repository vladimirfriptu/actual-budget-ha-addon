import { describe, it, expect, vi } from 'vitest';
import { categorizeBatch } from '../src/llm';
import type { CategItem, Vocab } from '../src/types';

const vocab: Vocab = {
  accounts: [],
  categories: [
    { id: 'c1', name: 'Продукты', group: 'g' },
    { id: 'c2', name: 'Кафе', group: 'g' },
  ],
  transferPayees: [],
};

const deps = (content: string) => ({
  apiKey: 'k',
  textModel: 'm',
  visionModel: 'm',
  today: '2026-07-01',
  fetchImpl: vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  ) as unknown as typeof fetch,
});

const items: CategItem[] = [
  { index: 0, amountMajor: -250, mcc: 5411, description: 'Сільпо' },
  { index: 1, amountMajor: -80, mcc: 5812, description: 'Кава' },
];

describe('categorizeBatch', () => {
  it('returns [] without calling the model for no items', async () => {
    const d = deps('{}');
    const out = await categorizeBatch([], vocab, d);
    expect(out).toEqual([]);
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it('aligns categories to input order regardless of result order', async () => {
    const content = JSON.stringify({ results: [{ index: 1, category: 'Кафе' }, { index: 0, category: 'Продукты' }] });
    const out = await categorizeBatch(items, vocab, deps(content));
    expect(out).toEqual(['Продукты', 'Кафе']);
  });

  it('fills null for indices the model omitted or nulled', async () => {
    const content = JSON.stringify({ results: [{ index: 0, category: null }] });
    const out = await categorizeBatch(items, vocab, deps(content));
    expect(out).toEqual([null, null]);
  });
});
