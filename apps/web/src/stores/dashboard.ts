import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { ProviderInfo, TrackResponse, TrackResult } from '@railtrack/shared';
import { resultKey } from '@/lib/trainKey';

export type ResultSource = 'manual' | 'upload';
export type DashboardView = 'table' | 'cards';

export interface DashboardState {
  results: TrackResult[];
  source: ResultSource | null;
  provider: ProviderInfo | null;
  trackedAt: string | null;
  requestId: string | null;
  invalid: { input: string; reason: string }[];
  duplicates: string[];
  /** Recipient emails found in an uploaded sheet (memory only — not persisted). */
  uploadEmails: string[];
  selectedKeys: string[];
  focusedKey: string | null;
  view: DashboardView;

  setTracked: (payload: { response: TrackResponse; source: ResultSource; uploadEmails?: string[] }) => void;
  upsertResults: (results: readonly TrackResult[], options?: { onlyExisting?: boolean; provider?: ProviderInfo }) => void;
  removeResult: (key: string) => void;
  clear: () => void;
  toggleSelected: (key: string) => void;
  setSelected: (keys: string[]) => void;
  setFocused: (key: string | null) => void;
  setView: (view: DashboardView) => void;
}

/** localStorage wrapper that never throws (quota exceeded / private mode keeps state in memory). */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.warn('[railtrack] Could not persist dashboard results', error);
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      results: [],
      source: null,
      provider: null,
      trackedAt: null,
      requestId: null,
      invalid: [],
      duplicates: [],
      uploadEmails: [],
      selectedKeys: [],
      focusedKey: null,
      view: 'table',

      setTracked: ({ response, source, uploadEmails }) =>
        set({
          results: response.results,
          source,
          provider: response.provider,
          trackedAt: new Date().toISOString(),
          requestId: response.requestId,
          invalid: response.invalid,
          duplicates: response.duplicates,
          uploadEmails: uploadEmails ?? [],
          selectedKeys: [],
          focusedKey: null,
        }),

      upsertResults: (incoming, options = {}) => {
        const current = get().results;
        const byKey = new Map(incoming.map((r) => [resultKey(r), r]));
        const next = current.map((r) => byKey.get(resultKey(r)) ?? r);
        if (!options.onlyExisting) {
          const existing = new Set(current.map(resultKey));
          for (const r of incoming) if (!existing.has(resultKey(r))) next.push(r);
        }
        if (next.length === current.length && next.every((r, i) => r === current[i])) return;
        set({ results: next, ...(options.provider ? { provider: options.provider } : {}) });
      },

      removeResult: (key) =>
        set((s) => ({
          results: s.results.filter((r) => resultKey(r) !== key),
          selectedKeys: s.selectedKeys.filter((k) => k !== key),
          focusedKey: s.focusedKey === key ? null : s.focusedKey,
        })),

      clear: () =>
        set({
          results: [],
          source: null,
          provider: null,
          trackedAt: null,
          requestId: null,
          invalid: [],
          duplicates: [],
          uploadEmails: [],
          selectedKeys: [],
          focusedKey: null,
        }),

      toggleSelected: (key) =>
        set((s) => ({
          selectedKeys: s.selectedKeys.includes(key) ? s.selectedKeys.filter((k) => k !== key) : [...s.selectedKeys, key],
        })),
      setSelected: (keys) => set({ selectedKeys: keys }),
      setFocused: (key) => set({ focusedKey: key }),
      setView: (view) => set({ view }),
    }),
    {
      name: 'railtrack-dashboard',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({
        results: s.results,
        source: s.source,
        provider: s.provider,
        trackedAt: s.trackedAt,
        requestId: s.requestId,
        invalid: s.invalid,
        duplicates: s.duplicates,
        selectedKeys: s.selectedKeys,
        view: s.view,
      }),
    },
  ),
);

/** Look up a dashboard result by train number + date (used as placeholder data on detail pages). */
export function selectResult(trainNumber: string, journeyDate: string) {
  return (s: DashboardState) => s.results.find((r) => r.trainNumber === trainNumber && r.journeyDate === journeyDate);
}
