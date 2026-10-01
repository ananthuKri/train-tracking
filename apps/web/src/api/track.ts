import { MAX_TRAINS_PER_REQUEST, type TrackResponse } from '@railtrack/shared';
import { chunk } from '@/lib/utils';
import type { TrainRef } from '@/lib/trainKey';
import { ApiError, api } from './client';

export interface BatchTrackResult {
  response: TrackResponse;
  /** Set when a later batch failed after earlier batches succeeded. */
  partialError: ApiError | null;
  /** Items that were not tracked because a batch failed. */
  untracked: TrainRef[];
}

function mergeResponses(responses: TrackResponse[]): TrackResponse {
  const last = responses[responses.length - 1]!;
  return {
    requestId: last.requestId,
    journeyDate: responses[0]!.journeyDate,
    provider: last.provider,
    results: responses.flatMap((r) => r.results),
    invalid: responses.flatMap((r) => r.invalid),
    duplicates: [...new Set(responses.flatMap((r) => r.duplicates))],
    summary: responses.reduce(
      (acc, r) => ({
        requested: acc.requested + r.summary.requested,
        valid: acc.valid + r.summary.valid,
        ok: acc.ok + r.summary.ok,
        failed: acc.failed + r.summary.failed,
      }),
      { requested: 0, valid: 0, ok: 0, failed: 0 },
    ),
  };
}

/**
 * Track (trainNumber, journeyDate) items, `MAX_TRAINS_PER_REQUEST` per call, sequentially
 * (sequential keeps us friendly to provider rate limits).
 */
export async function trackItemsInBatches(
  items: readonly TrainRef[],
  options: { source: 'manual' | 'upload'; forceRefresh?: boolean; onProgress?: (done: number, total: number) => void },
): Promise<BatchTrackResult> {
  const batches = chunk(items, MAX_TRAINS_PER_REQUEST);
  const responses: TrackResponse[] = [];
  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    try {
      responses.push(
        await api.track({
          items: batch.map((b) => ({ trainNumber: b.trainNumber, journeyDate: b.journeyDate })),
          source: options.source,
          forceRefresh: options.forceRefresh ?? false,
        }),
      );
      done += batch.length;
      options.onProgress?.(done, items.length);
    } catch (error) {
      if (responses.length === 0 || !(error instanceof ApiError)) throw error;
      return { response: mergeResponses(responses), partialError: error, untracked: batches.slice(i).flat() };
    }
  }
  if (responses.length === 0) throw new Error('Nothing to track');
  return { response: mergeResponses(responses), partialError: null, untracked: [] };
}
