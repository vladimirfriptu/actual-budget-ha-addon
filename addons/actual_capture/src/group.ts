import { normalizeName } from './mapping';
import type { LlmResult } from './types';

// Deterministic grouping for the /draft…/release session: the LLM extracts one
// entry per item; here we sum items that share the same category+account into a
// single expense whose note lists what was bought. Keeping the arithmetic in
// code (not the model) makes the totals reliable. Pure.

/** Merge per-item results by (category, account); sum amounts, join item notes.
 *  Uncategorized items are kept as separate transactions (never lumped). */
export function mergeByCategory(items: LlmResult[]): LlmResult[] {
  const order: string[] = [];
  const groups = new Map<string, LlmResult>();

  items.forEach((it, i) => {
    const amt = typeof it.amount === 'number' && Number.isFinite(it.amount) ? it.amount : 0;
    const cat = it.category ? normalizeName(it.category) : '';
    const key = cat ? `${cat}|${normalizeName(it.account ?? '')}` : `__uncat_${i}`;

    const cur = groups.get(key);
    if (cur) {
      cur.amount = (cur.amount ?? 0) + amt;
      const notes = [cur.note, it.note].map((s) => s?.trim()).filter(Boolean);
      cur.note = notes.join(', ');
    } else {
      groups.set(key, { ...it, amount: amt });
      order.push(key);
    }
  });

  return order.map((k) => groups.get(k)!);
}
