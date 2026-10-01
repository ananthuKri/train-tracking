import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/** Retry only transient transport/server faults — never provider/rate-limit errors (that would burn quota). */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'INTERNAL_ERROR');
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: { retry: false },
    },
  });
}
