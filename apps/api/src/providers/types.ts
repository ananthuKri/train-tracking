import type { NormalizedRoute, NormalizedTrainStatus, ProviderHealth, ProviderId, ProviderInfo } from '@railtrack/shared';

/** Provider-safe call limits. Keep these at or below the provider's documented quotas. */
export interface ProviderLimits {
  maxConcurrent: number;
  minIntervalMs: number;
  maxPerMinute?: number;
  /** How long a live result may be reused. */
  liveCacheSeconds: number;
  /** How long static route/timetable data may be reused. */
  routeCacheSeconds: number;
  /** Lowest monitoring interval allowed for this provider. */
  minPollMinutes: number;
}

/**
 * Every data source implements this interface. The rest of the system only sees the normalised
 * model, so swapping providers never touches the frontend.
 */
export interface TrainDataProvider {
  readonly id: ProviderId;
  readonly info: ProviderInfo;
  readonly limits: ProviderLimits;
  readonly docsUrl: string | null;
  /** True when credentials required by the provider are present. */
  isConfigured(): boolean;
  getLiveStatus(trainNumber: string, journeyDate: string): Promise<NormalizedTrainStatus>;
  getTrainRoute(trainNumber: string): Promise<NormalizedRoute>;
  healthCheck(): Promise<ProviderHealth>;
}
