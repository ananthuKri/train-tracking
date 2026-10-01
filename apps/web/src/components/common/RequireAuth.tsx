import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '@/api/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import { isApiError } from '@/api/client';

/** Renders children only for signed-in users; otherwise redirects to /login?next=<current path>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading, error, refetch, isFetching } = useMe();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Checking your session">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <TrainErrorState
        code={isApiError(error) ? error.code : null}
        message={error.message}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
