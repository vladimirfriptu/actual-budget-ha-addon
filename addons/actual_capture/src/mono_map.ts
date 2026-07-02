import { normalizeName } from './mapping';
import type { AccountRef } from './types';
import { UAH, type MonoClientInfo } from './monobank';

// Resolve Monobank accounts/jars to Actual account ids. Pure. Cards match by the
// last 4 digits of the masked PAN appearing in the Actual account name; jars by
// their title being a substring of the Actual account name. Non-UAH and unmapped
// entries are reported in `skipped` (never thrown, never silently dropped).

export interface MonoTarget {
  monoId: string;
  kind: 'card' | 'jar';
  label: string; // for logs
  accountId: string; // resolved Actual account
}

export function last4(pan: string | undefined): string {
  return (pan ?? '').replace(/\D/g, '').slice(-4);
}

export function mapMonoTargets(
  info: MonoClientInfo,
  accounts: AccountRef[],
): { targets: MonoTarget[]; skipped: string[] } {
  const targets: MonoTarget[] = [];
  const skipped: string[] = [];

  for (const a of info.accounts) {
    if (a.currencyCode !== UAH) {
      skipped.push(`card ${a.type} (currency ${a.currencyCode})`);
      continue;
    }
    const l4 = last4(a.maskedPan?.[0]);
    const acct = l4 ? accounts.find((x) => normalizeName(x.name).includes(l4)) : undefined;
    if (!acct) {
      skipped.push(`card ****${l4 || '?'} (no Actual match)`);
      continue;
    }
    targets.push({ monoId: a.id, kind: 'card', label: `card ****${l4}`, accountId: acct.id });
  }

  for (const j of info.jars) {
    if (j.currencyCode !== UAH) {
      skipped.push(`jar "${j.title}" (currency ${j.currencyCode})`);
      continue;
    }
    const q = normalizeName(j.title);
    const acct = q ? accounts.find((x) => normalizeName(x.name).includes(q)) : undefined;
    if (!acct) {
      skipped.push(`jar "${j.title}" (no Actual match)`);
      continue;
    }
    targets.push({ monoId: j.id, kind: 'jar', label: `jar "${j.title}"`, accountId: acct.id });
  }

  return { targets, skipped };
}
