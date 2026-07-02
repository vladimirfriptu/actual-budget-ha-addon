import { describe, it, expect } from 'vitest';
import { mapMonoTargets, last4 } from '../src/mono_map';
import type { AccountRef } from '../src/types';
import type { MonoClientInfo } from '../src/monobank';

const accounts: AccountRef[] = [
  { id: 'a-black', name: 'Монобанк чёрная (основная) 2480', offbudget: false },
  { id: 'a-white', name: 'Монобанк белая (зарплатная) 1664', offbudget: false },
  { id: 'a-jar1', name: 'Монобанк: Годовые подписки', offbudget: false },
  { id: 'a-cash', name: 'Наличные', offbudget: false },
];

function info(over: Partial<MonoClientInfo> = {}): MonoClientInfo {
  return {
    accounts: [
      { id: 'm-black', type: 'black', currencyCode: 980, balance: 100, maskedPan: ['537541******2480'] },
      { id: 'm-white', type: 'white', currencyCode: 980, balance: 200, maskedPan: ['531234******1664'] },
    ],
    jars: [{ id: 'm-jar1', title: 'Годовые подписки', currencyCode: 980, balance: 300 }],
    ...over,
  };
}

describe('last4', () => {
  it('extracts the last four digits ignoring masking', () => {
    expect(last4('537541******2480')).toBe('2480');
    expect(last4(undefined)).toBe('');
  });
});

describe('mapMonoTargets', () => {
  it('matches cards by pan last-4 and jars by title', () => {
    const { targets, skipped } = mapMonoTargets(info(), accounts);
    expect(skipped).toEqual([]);
    expect(targets.map((t) => [t.monoId, t.accountId])).toEqual([
      ['m-black', 'a-black'],
      ['m-white', 'a-white'],
      ['m-jar1', 'a-jar1'],
    ]);
  });

  it('skips non-UAH accounts', () => {
    const usd = info({
      accounts: [{ id: 'm-usd', type: 'black', currencyCode: 840, balance: 1, maskedPan: ['5375******9999'] }],
      jars: [],
    });
    const { targets, skipped } = mapMonoTargets(usd, accounts);
    expect(targets).toEqual([]);
    expect(skipped[0]).toContain('currency 840');
  });

  it('skips accounts with no matching Actual account', () => {
    const orphan = info({
      accounts: [{ id: 'm-x', type: 'black', currencyCode: 980, balance: 1, maskedPan: ['5375******0000'] }],
      jars: [],
    });
    const { targets, skipped } = mapMonoTargets(orphan, accounts);
    expect(targets).toEqual([]);
    expect(skipped[0]).toContain('no Actual match');
  });
});
