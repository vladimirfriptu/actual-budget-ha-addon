import { describe, it, expect } from 'vitest';
import { llmResultSchema, type Vocab } from '../src/types';
import {
  DRAFT_TAG,
  normalizeName,
  resolveAccount,
  resolveCategory,
  toYmd,
  planFromLlm,
} from '../src/mapping';

const vocab: Vocab = {
  accounts: [
    { id: 'acc-cash', name: 'Наличные', offbudget: false },
    { id: 'acc-mono', name: 'Монобанк', offbudget: false },
  ],
  categories: [
    { id: 'cat-food', name: 'Продукты', group: 'g' },
    { id: 'cat-build', name: 'Стройка', group: 'g' },
  ],
  transferPayees: [
    { accountId: 'acc-cash', payeeId: 'pay-cash' },
    { accountId: 'acc-mono', payeeId: 'pay-mono' },
  ],
};

const opts = { defaultCashAccount: 'Наличные', today: '2026-07-01' };
const parse = (o: unknown) => llmResultSchema.parse(o);

describe('helpers', () => {
  it('normalizeName lowercases, trims, strips punctuation', () => {
    expect(normalizeName('  Монобанк! ')).toBe('монобанк');
  });

  it('resolveAccount matches by substring', () => {
    expect(resolveAccount('моно', vocab.accounts)?.id).toBe('acc-mono');
    expect(resolveAccount('нал', vocab.accounts)?.id).toBe('acc-cash');
    expect(resolveAccount('неизвестное', vocab.accounts)).toBeNull();
  });

  it('resolveCategory matches by name', () => {
    expect(resolveCategory('продукты', vocab.categories)?.id).toBe('cat-food');
    expect(resolveCategory(null, vocab.categories)).toBeNull();
  });

  it('toYmd falls back to today on missing/invalid', () => {
    expect(toYmd(null, '2026-07-01')).toBe('2026-07-01');
    expect(toYmd('garbage', '2026-07-01')).toBe('2026-07-01');
    expect(toYmd('2026-05-04T10:00:00Z', '2026-07-01')).toBe('2026-05-04');
  });
});

describe('planFromLlm — expense', () => {
  it('files a negative draft transaction on the resolved account with a category', () => {
    const llm = parse({ intent: 'expense', amount: 200, account: 'нал', category: 'продукты', note: 'овощи' });
    const { plan } = planFromLlm(llm, vocab, opts);
    expect(plan.kind).toBe('transaction');
    if (plan.kind !== 'transaction') throw new Error('wrong kind');
    expect(plan.accountId).toBe('acc-cash');
    expect(plan.amountMinor).toBe(-20000);
    expect(plan.categoryId).toBe('cat-food');
    expect(plan.date).toBe('2026-07-01');
    expect(plan.notes).toContain('овощи');
    expect(plan.notes).toContain(DRAFT_TAG);
  });

  it('falls back to cash and warns when the account is unknown', () => {
    const llm = parse({ intent: 'expense', amount: 50, account: 'керто', category: 'продукты' });
    const { plan, warnings } = planFromLlm(llm, vocab, opts);
    if (plan.kind !== 'transaction') throw new Error('wrong kind');
    expect(plan.accountId).toBe('acc-cash');
    expect(warnings.join(' ')).toMatch(/счёт не распознан/);
    expect(plan.notes).toContain('⚠');
  });

  it('warns when the category is unknown but still drafts', () => {
    const llm = parse({ intent: 'expense', amount: 50, account: 'нал', category: 'зубочистки' });
    const { plan, warnings } = planFromLlm(llm, vocab, opts);
    if (plan.kind !== 'transaction') throw new Error('wrong kind');
    expect(plan.categoryId).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/категория не распознана/);
  });
});

describe('planFromLlm — receipt splits', () => {
  it('builds subtransactions that sum to the parent amount', () => {
    const llm = parse({
      intent: 'receipt',
      account: 'монобанк',
      splits: [
        { amount: 30, category: 'продукты', note: 'овощи' },
        { amount: 12.5, category: 'стройка', note: 'болты' },
      ],
    });
    const { plan } = planFromLlm(llm, vocab, opts);
    if (plan.kind !== 'transaction') throw new Error('wrong kind');
    expect(plan.accountId).toBe('acc-mono');
    expect(plan.subtransactions).toHaveLength(2);
    expect(plan.subtransactions?.[0]).toMatchObject({ amountMinor: -3000, categoryId: 'cat-food' });
    expect(plan.subtransactions?.[1]).toMatchObject({ amountMinor: -1250, categoryId: 'cat-build' });
    expect(plan.amountMinor).toBe(-4250);
  });
});

describe('planFromLlm — transfer', () => {
  it('builds a cash-withdrawal transfer using the cash transfer payee', () => {
    const llm = parse({ intent: 'transfer', amount: 500, from_account: 'монобанк', to_account: 'наличные' });
    const { plan } = planFromLlm(llm, vocab, opts);
    expect(plan.kind).toBe('transfer');
    if (plan.kind !== 'transfer') throw new Error('wrong kind');
    expect(plan.fromAccountId).toBe('acc-mono');
    expect(plan.transferPayeeId).toBe('pay-cash');
    expect(plan.amountMinor).toBe(-50000);
    expect(plan.notes).toContain(DRAFT_TAG);
  });

  it('treats a transfer to an unresolved person as an expense on the source account', () => {
    // "перевёл 750 жене с монобанка" — target is a person, not an own account.
    const llm = parse({ intent: 'transfer', amount: 750, from_account: 'монобанк', to_account: 'жене' });
    const { plan, warnings } = planFromLlm(llm, vocab, opts);
    expect(plan.kind).toBe('transaction');
    if (plan.kind !== 'transaction') throw new Error('wrong kind');
    expect(plan.accountId).toBe('acc-mono');
    expect(plan.amountMinor).toBe(-75000);
    expect(warnings.join(' ')).toMatch(/перевод не распознан/);
  });
});

describe('planFromLlm — never drops the event', () => {
  it('unknown intent with no amount still drafts on cash with amount 0', () => {
    const llm = parse({ intent: 'unknown', note: 'что-то непонятное' });
    const { plan, warnings } = planFromLlm(llm, vocab, opts);
    if (plan.kind !== 'transaction') throw new Error('wrong kind');
    expect(plan.accountId).toBe('acc-cash');
    expect(plan.amountMinor).toBe(0);
    expect(warnings.join(' ')).toMatch(/сумма не распознана/);
    expect(plan.notes).toContain('что-то непонятное');
  });
});
