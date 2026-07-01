import { formatMinor } from './money';
import { DRAFT_TAG } from './mapping';
import type { PostPlan, Vocab } from './types';

// Human-readable summary of a planned draft, shown in the Telegram approval
// message so the user can judge before tapping ✅. Pure.

function accountName(id: string, vocab: Vocab): string {
  return vocab.accounts.find((a) => a.id === id)?.name ?? '(счёт?)';
}

function categoryName(id: string | undefined, vocab: Vocab): string {
  if (!id) return 'без категории';
  return vocab.categories.find((c) => c.id === id)?.name ?? '(категория?)';
}

/** The account a transfer payee points at (reverse of the transferPayees map). */
function transferTargetName(payeeId: string, vocab: Vocab): string {
  const tp = vocab.transferPayees.find((p) => p.payeeId === payeeId);
  return tp ? accountName(tp.accountId, vocab) : '(счёт?)';
}

/** Strip the internal #draft tag from notes for display. */
function displayNotes(notes: string): string {
  return notes.replace(DRAFT_TAG, '').replace(/\s+/g, ' ').trim();
}

export function describePlan(plan: PostPlan, vocab: Vocab): string {
  if (plan.kind === 'transfer') {
    const line = `🔁 −${formatMinor(Math.abs(plan.amountMinor))} · ${accountName(plan.fromAccountId, vocab)} → ${transferTargetName(plan.transferPayeeId, vocab)}`;
    const note = displayNotes(plan.notes);
    return note ? `${line}\n${note}` : line;
  }

  const acct = accountName(plan.accountId, vocab);
  const total = `−${formatMinor(Math.abs(plan.amountMinor))}`;
  const lines: string[] = [];

  if (plan.subtransactions?.length) {
    lines.push(`${total} · ${acct} · ${plan.subtransactions.length} позиц.`);
    for (const s of plan.subtransactions) {
      const note = s.notes ? ` ${s.notes}` : '';
      lines.push(`• −${formatMinor(Math.abs(s.amountMinor))} ${categoryName(s.categoryId, vocab)}${note}`);
    }
  } else {
    lines.push(`${total} · ${acct} · ${categoryName(plan.categoryId, vocab)}`);
  }

  const note = displayNotes(plan.notes);
  if (note) lines.push(note);
  return lines.join('\n');
}
