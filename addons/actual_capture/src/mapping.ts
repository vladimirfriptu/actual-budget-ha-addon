import { toMinorUnits } from './money';
import type {
  AccountRef,
  CategoryRef,
  LlmResult,
  PlanOutcome,
  PostPlan,
  SubPlan,
  TransferPayeeRef,
  Vocab,
} from './types';

export const DRAFT_TAG = '#draft';

// Words that mean "cash" across ru/uk/en, used to route ambiguous references to
// the configured default cash account.
const CASH_ALIASES = ['нал', 'налич', 'готівк', 'cash', 'кэш', 'кеш'];

/** Lowercase, trim, collapse whitespace, drop most punctuation. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCash(query: string): boolean {
  const n = normalizeName(query);
  return CASH_ALIASES.some((a) => n.includes(a));
}

/** Resolve a free-text name against a list by exact-normalized then substring match. */
function resolveByName<T extends { name: string }>(query: string | null | undefined, list: T[]): T | null {
  if (!query) return null;
  const q = normalizeName(query);
  if (!q) return null;
  const exact = list.find((item) => normalizeName(item.name) === q);
  if (exact) return exact;
  // Substring both ways: query in name ("моно" → "Монобанк") or name in query.
  const partial = list.find((item) => {
    const n = normalizeName(item.name);
    return n.includes(q) || q.includes(n);
  });
  return partial ?? null;
}

export function resolveAccount(query: string | null | undefined, accounts: AccountRef[]): AccountRef | null {
  return resolveByName(query, accounts);
}

export function resolveCategory(query: string | null | undefined, categories: CategoryRef[]): CategoryRef | null {
  return resolveByName(query, categories);
}

export function findTransferPayee(accountId: string, transferPayees: TransferPayeeRef[]): TransferPayeeRef | null {
  return transferPayees.find((p) => p.accountId === accountId) ?? null;
}

/** The default cash account resolved from config, or the first on-budget account as a last resort. */
function defaultAccount(vocab: Vocab, defaultCashName: string): AccountRef | null {
  return (
    resolveAccount(defaultCashName, vocab.accounts) ??
    vocab.accounts.find((a) => !a.offbudget) ??
    vocab.accounts[0] ??
    null
  );
}

/** Normalize an LLM date to YYYY-MM-DD, falling back to `today` when absent/invalid. */
export function toYmd(date: string | null | undefined, today: string): string {
  if (!date) return today;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
  if (!m) return today;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function buildNotes(baseNote: string, warnings: string[]): string {
  const parts: string[] = [];
  if (baseNote.trim()) parts.push(baseNote.trim());
  parts.push(DRAFT_TAG);
  if (warnings.length) parts.push(`⚠ ${warnings.join('; ')}`);
  return parts.join(' ');
}

/** Negate an amount to an outflow, normalizing -0 to 0. */
function outflow(minor: number): number {
  return minor === 0 ? 0 : -minor;
}

function amountMinorOrZero(amount: number | null | undefined, warnings: string[]): number {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    warnings.push('сумма не распознана');
    return 0;
  }
  return toMinorUnits(Math.abs(amount));
}

/**
 * Turn a validated LLM result into a concrete plan for the Actual layer.
 * Never throws and never drops the event: on any ambiguity it produces a draft
 * transaction (tagged #draft) and records warnings for evening review.
 */
export function planFromLlm(
  llm: LlmResult,
  vocab: Vocab,
  opts: { defaultCashAccount: string; today: string },
): PlanOutcome {
  const warnings: string[] = [];
  const date = toYmd(llm.date, opts.today);
  const baseNote = (llm.note ?? '').trim();
  const fallback = defaultAccount(vocab, opts.defaultCashAccount);

  if (llm.intent === 'transfer') {
    const outcome = tryPlanTransfer(llm, vocab, opts, date, baseNote, fallback);
    if (outcome) return outcome;
    // fall through to a plain draft transaction if the transfer can't be built
  }

  return planTransaction(llm, vocab, opts, date, baseNote, warnings, fallback);
}

function tryPlanTransfer(
  llm: LlmResult,
  vocab: Vocab,
  opts: { defaultCashAccount: string; today: string },
  date: string,
  baseNote: string,
  fallback: AccountRef | null,
): PlanOutcome | null {
  const warnings: string[] = [];
  const from = resolveAccount(llm.from_account, vocab.accounts);
  // A transfer targets one of the user's OWN accounts. Only default to cash when
  // the target text actually says "cash" (a withdrawal). An unresolved target
  // (e.g. "жене" — a person) is NOT a transfer → caller degrades to an expense.
  const to =
    resolveAccount(llm.to_account, vocab.accounts) ??
    (looksLikeCash(llm.to_account ?? '') ? fallback : null);

  if (!from || !to) return null; // let caller degrade to a draft transaction
  const transferPayee = findTransferPayee(to.id, vocab.transferPayees);
  if (!transferPayee) return null;

  const amountMinor = outflow(amountMinorOrZero(llm.amount, warnings));
  const plan: PostPlan = {
    kind: 'transfer',
    fromAccountId: from.id,
    transferPayeeId: transferPayee.payeeId,
    amountMinor,
    date,
    notes: buildNotes(baseNote || `перевод ${from.name} → ${to.name}`, warnings),
  };
  return { plan, warnings };
}

function planTransaction(
  llm: LlmResult,
  vocab: Vocab,
  opts: { defaultCashAccount: string; today: string },
  date: string,
  baseNote: string,
  warnings: string[],
  fallback: AccountRef | null,
): PlanOutcome {
  if (llm.intent === 'transfer') warnings.push('перевод не распознан полностью');

  // A degraded transfer carries the paying account in from_account, a plain
  // expense in account — accept either.
  const acctHint = llm.account ?? llm.from_account ?? null;
  const resolved = resolveAccount(llm.account, vocab.accounts) ?? resolveAccount(llm.from_account, vocab.accounts);
  const account = resolved ?? (looksLikeCash(acctHint ?? '') ? fallback : null) ?? fallback;

  if (!account) {
    throw new Error('no accounts available in the budget to file a transaction');
  }
  if (acctHint && !resolved && !looksLikeCash(acctHint)) {
    warnings.push(`счёт не распознан: '${acctHint}'`);
  }

  const splits = llm.splits ?? [];
  let amountMinor: number;
  let subtransactions: SubPlan[] | undefined;
  let categoryId: string | undefined;

  if (splits.length > 0) {
    subtransactions = splits.map((s) => {
      const cat = resolveCategory(s.category, vocab.categories);
      if (s.category && !cat) warnings.push(`категория не распознана: '${s.category}'`);
      return {
        amountMinor: outflow(toMinorUnits(Math.abs(s.amount))),
        categoryId: cat?.id,
        notes: s.note?.trim() || undefined,
      };
    });
    amountMinor = subtransactions.reduce((sum, s) => sum + s.amountMinor, 0);
  } else {
    amountMinor = outflow(amountMinorOrZero(llm.amount, warnings));
    const cat = resolveCategory(llm.category, vocab.categories);
    if (llm.category && !cat) warnings.push(`категория не распознана: '${llm.category}'`);
    categoryId = cat?.id;
  }

  const plan: PostPlan = {
    kind: 'transaction',
    accountId: account.id,
    amountMinor,
    categoryId,
    payeeName: llm.payee?.trim() || undefined,
    date,
    notes: buildNotes(baseNote, warnings),
    subtransactions,
  };
  return { plan, warnings };
}
