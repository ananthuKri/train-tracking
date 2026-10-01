import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Tracks whether any rendered train data came from a demo provider, so the global
 * "DEMO DATA" banner shows even if /api/config hasn't flagged demo mode.
 */
interface DemoSignalState {
  sources: Record<string, true>;
  mark: (id: string) => void;
  unmark: (id: string) => void;
}

export const useDemoSignalStore = create<DemoSignalState>()((set) => ({
  sources: {},
  mark: (id) => set((s) => (s.sources[id] ? s : { sources: { ...s.sources, [id]: true } })),
  unmark: (id) =>
    set((s) => {
      if (!s.sources[id]) return s;
      const next = { ...s.sources };
      delete next[id];
      return { sources: next };
    }),
}));

/** Call from a view that renders train data: raises the global demo banner while mounted. */
export function useReportDemo(id: string, isDemo: boolean): void {
  const mark = useDemoSignalStore((s) => s.mark);
  const unmark = useDemoSignalStore((s) => s.unmark);
  useEffect(() => {
    if (!isDemo) return;
    mark(id);
    return () => unmark(id);
  }, [id, isDemo, mark, unmark]);
}
