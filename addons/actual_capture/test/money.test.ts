import { describe, it, expect } from 'vitest';
import { toMinorUnits, formatMinor, parseAmount } from '../src/money';

describe('toMinorUnits', () => {
  it('scales major units by 100 and rounds', () => {
    expect(toMinorUnits(120.3)).toBe(12030);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(5)).toBe(500);
  });

  it('avoids binary float drift', () => {
    expect(toMinorUnits(1.1)).toBe(110);
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });

  it('honors a custom decimals count', () => {
    expect(toMinorUnits(5, 0)).toBe(5);
    expect(toMinorUnits(1.234, 3)).toBe(1234);
  });

  it('throws on non-finite input', () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow();
  });
});

describe('formatMinor', () => {
  it('renders minor units back to a fixed-decimal string', () => {
    expect(formatMinor(12030)).toBe('120.30');
    expect(formatMinor(-1999)).toBe('-19.99');
  });
});

describe('parseAmount', () => {
  it('extracts the first number from the message', () => {
    expect(parseAmount('3000 с белой карты на банку годовые подписки')).toBe(3000);
    expect(parseAmount('снял 500 с монобанка')).toBe(500);
  });

  it('handles thousands spaces and decimal comma/dot', () => {
    expect(parseAmount('3 000 на еду')).toBe(3000);
    expect(parseAmount('кофе 12,50')).toBe(12.5);
    expect(parseAmount('такси 199.99')).toBe(199.99);
  });

  it('returns null when there is no number or it is non-positive', () => {
    expect(parseAmount('перевёл жене с карты')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});
