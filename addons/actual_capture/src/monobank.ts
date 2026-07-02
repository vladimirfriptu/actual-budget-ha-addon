// Monobank Personal API client (https://api.monobank.ua). Read-only: client-info
// and statement. Thin I/O shell — not unit-tested. Token goes in the X-Token
// header. Amounts are integer minor units (kopecks); negative = outflow.

const MONO_URL = 'https://api.monobank.ua';

export const UAH = 980; // ISO 4217 numeric

export interface MonoDeps {
  token: string;
  fetchImpl?: typeof fetch;
}

export interface MonoAccount {
  id: string;
  type: string;
  currencyCode: number;
  balance: number;
  maskedPan: string[];
}

export interface MonoJar {
  id: string;
  title: string;
  currencyCode: number;
  balance: number;
}

export interface MonoClientInfo {
  accounts: MonoAccount[];
  jars: MonoJar[];
}

export interface MonoStatementItem {
  id: string;
  time: number; // unix seconds
  description: string;
  mcc: number;
  amount: number; // minor units, signed (negative = outflow)
  currencyCode: number;
  balance: number;
  comment?: string;
}

/** Raised on HTTP 429 so the caller can back off until the next tick. */
export class MonoRateLimitError extends Error {
  constructor() {
    super('Monobank rate limit (429)');
    this.name = 'MonoRateLimitError';
  }
}

async function monoGet(path: string, deps: MonoDeps): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(`${MONO_URL}${path}`, {
    headers: { 'X-Token': deps.token },
  });
  if (res.status === 429) throw new MonoRateLimitError();
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Monobank ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function getClientInfo(deps: MonoDeps): Promise<MonoClientInfo> {
  const data = (await monoGet('/personal/client-info', deps)) as MonoClientInfo;
  return { accounts: data.accounts ?? [], jars: data.jars ?? [] };
}

/**
 * Fetch a statement for one account/jar between two unix-second bounds.
 * Monobank caps the window at ~31 days and 500 items per call; hourly polling
 * keeps windows tiny, so we do not paginate (a full 500 is logged by the caller).
 */
export async function getStatement(
  accountId: string,
  fromSec: number,
  toSec: number,
  deps: MonoDeps,
): Promise<MonoStatementItem[]> {
  const data = (await monoGet(`/personal/statement/${accountId}/${fromSec}/${toSec}`, deps)) as MonoStatementItem[];
  return Array.isArray(data) ? data : [];
}
