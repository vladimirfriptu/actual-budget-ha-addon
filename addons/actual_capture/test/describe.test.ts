import { describe, it, expect } from 'vitest';
import { describePlan } from '../src/describe';
import type { PostPlan, Vocab } from '../src/types';

const vocab: Vocab = {
  accounts: [
    { id: 'acc-cash', name: 'Наличные', offbudget: false },
    { id: 'acc-mono', name: 'Монобанк чёрная', offbudget: false },
  ],
  categories: [{ id: 'cat-food', name: 'Продукты', group: 'g' }],
  transferPayees: [{ accountId: 'acc-cash', payeeId: 'pay-cash' }],
};

describe('describePlan', () => {
  it('describes a single expense with account and category', () => {
    const plan: PostPlan = {
      kind: 'transaction', accountId: 'acc-cash', amountMinor: -20000,
      categoryId: 'cat-food', date: '2026-07-01', notes: 'овощи #draft',
    };
    expect(describePlan(plan, vocab)).toBe('−200.00 · Наличные · Продукты\nовощи');
  });

  it('shows "без категории" when there is no category', () => {
    const plan: PostPlan = {
      kind: 'transaction', accountId: 'acc-mono', amountMinor: -5000,
      date: '2026-07-01', notes: '#draft',
    };
    expect(describePlan(plan, vocab)).toBe('−50.00 · Монобанк чёрная · без категории');
  });

  it('describes a split with per-line categories', () => {
    const plan: PostPlan = {
      kind: 'transaction', accountId: 'acc-mono', amountMinor: -4250, date: '2026-07-01', notes: '#draft',
      subtransactions: [
        { amountMinor: -3000, categoryId: 'cat-food', notes: 'овощи' },
        { amountMinor: -1250 },
      ],
    };
    const out = describePlan(plan, vocab);
    expect(out).toContain('−42.50 · Монобанк чёрная · 2 позиц.');
    expect(out).toContain('• −30.00 Продукты овощи');
    expect(out).toContain('• −12.50 без категории');
  });

  it('describes a transfer as from → to', () => {
    const plan: PostPlan = {
      kind: 'transfer', fromAccountId: 'acc-mono', transferPayeeId: 'pay-cash',
      amountMinor: -200000, date: '2026-07-01', notes: 'перевод #draft',
    };
    expect(describePlan(plan, vocab)).toContain('🔁 −2000.00 · Монобанк чёрная → Наличные');
  });
});
