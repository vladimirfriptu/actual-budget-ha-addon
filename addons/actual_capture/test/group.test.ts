import { describe, it, expect } from 'vitest';
import { mergeByCategory } from '../src/group';
import { llmResultSchema, type LlmResult } from '../src/types';

const item = (o: Partial<LlmResult>): LlmResult =>
  llmResultSchema.parse({ intent: 'expense', ...o });

describe('mergeByCategory', () => {
  it('sums same-category items and joins their notes', () => {
    const out = mergeByCategory([
      item({ amount: 200, category: 'Продукты', account: 'Наличные', note: 'бананы' }),
      item({ amount: 100, category: 'Продукты', account: 'Наличные', note: 'яблоки' }),
      item({ amount: 1000, category: 'Продукты', account: 'Наличные', note: 'мясо' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 1300, category: 'Продукты', note: 'бананы, яблоки, мясо' });
  });

  it('keeps different categories (and fuel) as separate transactions', () => {
    const out = mergeByCategory([
      item({ amount: 200, category: 'Продукты', account: 'Наличные', note: 'бананы' }),
      item({ amount: 1000, category: 'Топливо', account: null, note: 'заправился' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => [r.category, r.amount])).toEqual([
      ['Продукты', 200],
      ['Топливо', 1000],
    ]);
  });

  it('does not merge across different accounts', () => {
    const out = mergeByCategory([
      item({ amount: 50, category: 'Продукты', account: 'Наличные', note: 'хлеб' }),
      item({ amount: 60, category: 'Продукты', account: 'Монобанк чёрная', note: 'молоко' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('never lumps uncategorized items together', () => {
    const out = mergeByCategory([
      item({ amount: 10, category: null, note: 'что-то' }),
      item({ amount: 20, category: null, note: 'другое' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('treats a missing amount as zero rather than NaN', () => {
    const out = mergeByCategory([
      item({ amount: 100, category: 'Продукты', account: 'Наличные', note: 'сыр' }),
      item({ amount: null, category: 'Продукты', account: 'Наличные', note: 'без цены' }),
    ]);
    expect(out[0]?.amount).toBe(100);
  });
});
