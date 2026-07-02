// Money conversion. Actual stores amounts as integer minor units (e.g. €120.30
// => 12030). One budget = one currency in the MVP, so a fixed decimals count is
// enough. All functions are pure.

const DEFAULT_DECIMALS = 2;

/** Convert a major-unit amount (e.g. 120.3) to integer minor units (12030). */
export function toMinorUnits(major: number, decimals = DEFAULT_DECIMALS): number {
  if (!Number.isFinite(major)) throw new Error(`amount is not finite: ${major}`);
  const factor = 10 ** decimals;
  // Round on the scaled value to avoid float drift (1.1*100 = 110.00000000000001).
  return Math.round(major * factor);
}

/** Format integer minor units back to a major-unit string for user feedback. */
export function formatMinor(minor: number, decimals = DEFAULT_DECIMALS): string {
  const factor = 10 ** decimals;
  return (minor / factor).toFixed(decimals);
}

/**
 * Extract the first positive amount from free text, in major units. Tolerates
 * thousands spaces ("3 000") and a comma/dot decimal ("12,50"). Used as a
 * deterministic fallback when the LLM leaves `amount` null but the number is
 * plainly in the user's message. Returns null when no number is present.
 */
export function parseAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const SP = ' \\u00a0\\u202f\\u2009'; // regular, non-breaking, narrow, thin spaces
  const m = text.match(new RegExp(`\\d[\\d${SP}]*(?:[.,]\\d{1,2})?`));
  if (!m) return null;
  const cleaned = m[0].replace(new RegExp(`[${SP}]`, 'g'), '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
