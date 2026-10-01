import { FlaskConical } from 'lucide-react';
import { useConfig } from '@/api/hooks';
import { useDashboardStore } from '@/stores/dashboard';
import { useDemoSignalStore } from '@/stores/demo';

/** True when the server runs in demo mode or any train data on screen/in the dashboard is simulated. */
export function useIsDemo(): boolean {
  const { data: config } = useConfig();
  const dashboardDemo = useDashboardStore(
    (s) => s.provider?.isDemo === true || s.results.some((r) => r.status?.provider.isDemo === true),
  );
  const signalled = useDemoSignalStore((s) => Object.keys(s.sources).length > 0);
  return config?.demoMode === true || config?.activeProvider.isDemo === true || dashboardDemo || signalled;
}

/** Persistent, high-contrast global banner — never let simulated data look live. */
export function DemoBanner() {
  const isDemo = useIsDemo();
  if (!isDemo) return null;
  return (
    <div
      data-testid="demo-banner"
      role="note"
      aria-label="Demo data notice"
      className="border-b-2 border-amber-600 bg-amber-300 text-slate-950"
    >
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1.5 text-center text-sm font-semibold">
        <FlaskConical aria-hidden className="size-4 shrink-0" />
        DEMO DATA — simulated trains, not live railway data
      </p>
    </div>
  );
}
