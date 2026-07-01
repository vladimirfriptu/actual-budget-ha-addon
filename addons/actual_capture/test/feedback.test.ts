import { describe, it, expect } from 'vitest';
import { formatConfirmation } from '../src/feedback';
import type { PlanOutcome } from '../src/types';

describe('formatConfirmation', () => {
  it('formats a single expense draft', () => {
    const o: PlanOutcome = {
      plan: { kind: 'transaction', accountId: 'a', amountMinor: -20000, date: '2026-07-01', notes: '#draft' },
      warnings: [],
    };
    expect(formatConfirmation(o)).toBe('✅ 200.00 · черновик');
  });

  it('formats a split receipt with item count', () => {
    const o: PlanOutcome = {
      plan: {
        kind: 'transaction',
        accountId: 'a',
        amountMinor: -4250,
        date: '2026-07-01',
        notes: '#draft',
        subtransactions: [
          { amountMinor: -3000 },
          { amountMinor: -1250 },
        ],
      },
      warnings: [],
    };
    expect(formatConfirmation(o)).toContain('2 позиц.');
    expect(formatConfirmation(o)).toContain('42.50');
  });

  it('formats a transfer and appends warnings', () => {
    const o: PlanOutcome = {
      plan: {
        kind: 'transfer',
        fromAccountId: 'a',
        transferPayeeId: 'p',
        amountMinor: -50000,
        date: '2026-07-01',
        notes: '#draft',
      },
      warnings: ['сумма не распознана'],
    };
    const msg = formatConfirmation(o);
    expect(msg).toContain('🔁 перевод 500.00');
    expect(msg).toContain('⚠ сумма не распознана');
  });
});
