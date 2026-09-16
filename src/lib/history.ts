import type { AnalyzeResponse, HistoryEntry, PatientProfile } from '../types';

// MedGraph has no backend database — every analysis result already lives
// entirely in the browser (it comes back from a single POST /api/analyze
// call). History is therefore persisted the same way: client-side, in
// localStorage, keyed by a versioned key so a future shape change can
// migrate or discard old entries cleanly instead of crashing on parse.
const HISTORY_KEY = 'medgraph_history_v1';
const MAX_HISTORY_ENTRIES = 25;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readAll(): HistoryEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryEntry[];
  } catch (err) {
    // Corrupt or foreign data under this key should never crash the app —
    // treat it as if there were no history yet.
    console.error('[history] Failed to read history from localStorage:', err);
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    return true;
  } catch (err) {
    // Most likely quota exceeded (localStorage is small, and full
    // AnalyzeResponse payloads with evidence quotes add up). Fail soft —
    // the user's current analysis on screen is unaffected either way.
    console.error('[history] Failed to write history to localStorage:', err);
    return false;
  }
}

// Returns entries newest-first.
export function getHistoryEntries(): HistoryEntry[] {
  return readAll().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

export function getHistoryEntry(id: string): HistoryEntry | null {
  return readAll().find((e) => e.id === id) || null;
}

// Saves a new entry at the front, trimming the oldest entries beyond
// MAX_HISTORY_ENTRIES so localStorage usage stays bounded. Returns the
// entry that was saved (with its generated id/timestamp) or null if
// persistence isn't available (SSR, storage disabled, quota exceeded).
export function saveHistoryEntry(input: {
  medications: string[];
  demo: boolean;
  data: AnalyzeResponse;
  patientProfile?: PatientProfile;
}): HistoryEntry | null {
  if (!isBrowser()) return null;

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    medications: input.medications,
    demo: input.demo,
    analysisStatus: input.data.analysisStatus,
    stats: input.data.stats,
    data: input.data,
    patientProfile: input.patientProfile,
  };

  const existing = readAll();
  const next = [entry, ...existing].slice(0, MAX_HISTORY_ENTRIES);
  const ok = writeAll(next);
  return ok ? entry : null;
}

export function deleteHistoryEntry(id: string): void {
  const existing = readAll();
  writeAll(existing.filter((e) => e.id !== id));
}

export function clearHistory(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.error('[history] Failed to clear history:', err);
  }
}
