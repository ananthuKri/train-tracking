import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { MapPinOff, TriangleAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <EmptyState
      testId="not-found"
      icon={MapPinOff}
      title="This page isn’t on the route map"
      description="The page you were looking for doesn’t exist. Check the address, or start by tracking a train."
      action={
        <>
          <Button asChild>
            <Link to="/">Track a train</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/results">Open dashboard</Link>
          </Button>
        </>
      }
    />
  );
}

/** Route-level error boundary (unexpected render errors, failed lazy chunks). */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div className="mx-auto max-w-2xl p-6">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description={
          <>
            <p>An unexpected error occurred while showing this page.</p>
            <p className="mt-2 font-mono text-xs">{message}</p>
          </>
        }
        action={
          <>
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button asChild variant="outline">
              <a href="/">Go to Track</a>
            </Button>
          </>
        }
      />
    </div>
  );
}
