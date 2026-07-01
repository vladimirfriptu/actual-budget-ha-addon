import { formatMinor } from './money';
import type { PlanOutcome } from './types';

// Build the short Telegram confirmation for a filed draft. Pure.

export function formatConfirmation(outcome: PlanOutcome): string {
  const { plan, warnings } = outcome;
  let head: string;
  if (plan.kind === 'transfer') {
    head = `🔁 перевод ${formatMinor(Math.abs(plan.amountMinor))} · черновик`;
  } else if (plan.subtransactions?.length) {
    head = `✅ черновик · ${plan.subtransactions.length} позиц. · ${formatMinor(Math.abs(plan.amountMinor))}`;
  } else {
    head = `✅ ${formatMinor(Math.abs(plan.amountMinor))} · черновик`;
  }
  if (warnings.length) return `${head}\n⚠ ${warnings.join('; ')}`;
  return head;
}
