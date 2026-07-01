import { describe, it, expect } from 'vitest';
import { toMinorUnits, formatMinor } from '../src/money';

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
