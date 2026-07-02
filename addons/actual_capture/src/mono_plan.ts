import { DRAFT_TAG } from './mapping';
import type { CategoryRef, PostPlan } from './types';
import type { MonoStatementItem } from './monobank';

// Turn a Monobank statement item into a concrete Actual plan. Pure. Amounts are
// already integer minor units (signed: negative = outflow), so they pass through
// unchanged. ATM withdrawals become a transfer card→cash; everything else is an
// expense/income filed as a #draft with the (LLM-picked) category.

export const ATM_MCC = 6011;

export interface MonoPlanCtx {
  accountId: string; // Actual account this item belongs to
  date: string; // YYYY-MM-DD (from the item's own time)
  category: CategoryRef | null; // resolved from the batch LLM (expenses only)
  cashTransferPayeeId?: string; // transfer payee → cash account (for ATM)
}

function noteFor(item: MonoStatementItem): string {
  const base = item.comment?.trim() || item.description?.trim() || 'mono';
  return `mono: ${base} ${DRAFT_TAG}`;
}

export function planFromMonoItem(item: MonoStatementItem, ctx: MonoPlanCtx): PostPlan {
  // ATM withdrawal → transfer card → cash (only when a cash transfer payee exists).
  if (item.mcc === ATM_MCC && item.amount < 0 && ctx.cashTransferPayeeId) {
    return {
      kind: 'transfer',
      fromAccountId: ctx.accountId,
      transferPayeeId: ctx.cashTransferPayeeId,
      amountMinor: item.amount,
      date: ctx.date,
      notes: `mono: банкомат ${DRAFT_TAG}`,
    };
  }
  return {
    kind: 'transaction',
    accountId: ctx.accountId,
    amountMinor: item.amount,
    categoryId: ctx.category?.id,
    date: ctx.date,
    notes: noteFor(item),
  };
}
