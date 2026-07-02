import { readFile, writeFile, rename } from 'node:fs/promises';
import type { MonoStatementItem } from './monobank';

// Persisted state for the Monobank poller: a per-account watermark (last seen
// transaction time), a bounded ring of recently-seen ids for boundary dedup, and
// a buffer of items awaiting categorization/flush. The reducers are pure; only
// loadState/saveState touch the filesystem.

export interface BufferedItem {
  monoId: string;
  accountId: string; // Actual account id
  item: MonoStatementItem;
}

export interface MonoState {
  version: 1;
  lastSeen: Record<string, number>; // monoId → unix seconds
  seenIds: string[];
  buffer: BufferedItem[];
}

const SEEN_CAP = 500;

export function emptyState(): MonoState {
  return { version: 1, lastSeen: {}, seenIds: [], buffer: [] };
}

/** Set a start watermark for any mono account we have not tracked yet. */
export function initWatermarks(state: MonoState, monoIds: string[], startSec: number): MonoState {
  const lastSeen = { ...state.lastSeen };
  for (const id of monoIds) if (lastSeen[id] === undefined) lastSeen[id] = startSec;
  return { ...state, lastSeen };
}

/** Add freshly-fetched items for one mono account: dedup by id, advance the
 *  watermark, buffer the new ones. Returns the next state and how many were new. */
export function ingest(
  state: MonoState,
  monoId: string,
  accountId: string,
  items: MonoStatementItem[],
): { state: MonoState; added: number } {
  const seen = new Set(state.seenIds);
  const fresh = items.filter((it) => !seen.has(it.id));
  const buffer = [...state.buffer, ...fresh.map((item) => ({ monoId, accountId, item }))];
  const seenIds = [...state.seenIds, ...fresh.map((it) => it.id)].slice(-SEEN_CAP);
  const maxTime = items.reduce((m, it) => Math.max(m, it.time), state.lastSeen[monoId] ?? 0);
  const lastSeen = { ...state.lastSeen, [monoId]: maxTime };
  return { state: { ...state, buffer, seenIds, lastSeen }, added: fresh.length };
}

/** Replace the buffer (e.g. keep only items that failed to post). */
export function setBuffer(state: MonoState, buffer: BufferedItem[]): MonoState {
  return { ...state, buffer };
}

export async function loadState(path: string): Promise<MonoState> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MonoState>;
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: MonoState): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, path);
}
