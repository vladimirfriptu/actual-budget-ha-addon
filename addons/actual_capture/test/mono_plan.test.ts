import { describe, it, expect } from 'vitest';
import { planFromMonoItem, ATM_MCC } from '../src/mono_plan';
import type { CategoryRef } from '../src/types';
import type { MonoStatementItem } from '../src/monobank';

const cat: CategoryRef = { id: 'c-food', name: 'Продукты', group: 'g' };

function item(over: Partial<MonoStatementItem> = {}): MonoStatementItem {
  return {
    id: 'i1',
    time: 1_700_000_000,
    description: 'Сільпо',
    mcc: 5411,
    amount: -25000,
    currencyCode: 980,
    balance: 0,
    ...over,
  };
}

describe('planFromMonoItem', () => {
  it('files an expense with the resolved category and passes minor units through', () => {
    const plan = planFromMonoItem(item(), { accountId: 'a1', date: '2026-07-01', category: cat });
    expect(plan).toMatchObject({
      kind: 'transaction',
      accountId: 'a1',
      amountMinor: -25000,
      categoryId: 'c-food',
      date: '2026-07-01',
    });
    expect(plan.notes).toContain('mono: Сільпо');
    expect(plan.notes).toContain('#draft');
  });

  it('keeps income positive and works without a category', () => {
    const plan = planFromMonoItem(item({ amount: 5000, description: 'Повернення' }), {
      accountId: 'a1',
      date: '2026-07-01',
      category: null,
    });
    expect(plan).toMatchObject({ kind: 'transaction', amountMinor: 5000 });
    expect('categoryId' in plan ? plan.categoryId : undefined).toBeUndefined();
  });

  it('turns an ATM withdrawal into a transfer to cash', () => {
    const plan = planFromMonoItem(item({ mcc: ATM_MCC, amount: -100000, description: 'Готівка' }), {
      accountId: 'a-card',
      date: '2026-07-01',
      category: null,
      cashTransferPayeeId: 'p-cash',
    });
    expect(plan).toEqual({
      kind: 'transfer',
      fromAccountId: 'a-card',
      transferPayeeId: 'p-cash',
      amountMinor: -100000,
      date: '2026-07-01',
      notes: 'mono: банкомат #draft',
    });
  });

  it('degrades an ATM item to a plain expense when no cash payee is available', () => {
    const plan = planFromMonoItem(item({ mcc: ATM_MCC, amount: -100000 }), {
      accountId: 'a-card',
      date: '2026-07-01',
      category: null,
    });
    expect(plan.kind).toBe('transaction');
  });
});
