import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { MapPinOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TrainMapProps } from './TrainMap';

export type { MapTrain, TrainMapProps } from './TrainMap';

const TrainMapImpl = lazy(() => import('./TrainMap'));

class MapErrorBoundary extends Component<{ children: ReactNode; heightClass?: string }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[railtrack] map failed to render', error, info.componentStack);
  }
  override render() {
    if (this.state.failed) {
      return (
        <div
          role="status"
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground',
            this.props.heightClass ?? 'h-80',
          )}
        >
          <MapPinOff aria-hidden className="size-6" />
          The map could not be displayed. Train details below are unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}

/** Code-split Leaflet map with a skeleton while it loads. */
export function TrainMap(props: TrainMapProps) {
  return (
    <MapErrorBoundary heightClass={props.heightClass}>
      <Suspense
        fallback={
          <div className={props.className}>
            <Skeleton className={cn('w-full rounded-lg', props.heightClass ?? 'h-80')} />
          </div>
        }
      >
        <TrainMapImpl {...props} />
      </Suspense>
    </MapErrorBoundary>
  );
}
