import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  EmailReportRequest,
  LoginRequest,
  MonitoringCreate,
  MonitoringPatch,
  MonitoringSubscription,
  RegisterRequest,
  ReportPreviewRequest,
  TrackRequest,
  TrackResult,
  User,
} from '@railtrack/shared';
import { useDashboardStore } from '@/stores/dashboard';
import { ApiError, api } from './client';

export const queryKeys = {
  config: ['config'] as const,
  me: ['me'] as const,
  train: (trainNumber: string, journeyDate: string) => ['train', trainNumber, journeyDate] as const,
  route: (trainNumber: string) => ['route', trainNumber] as const,
  snapshots: (trainNumber: string, journeyDate: string) => ['snapshots', trainNumber, journeyDate] as const,
  history: ['history'] as const,
  providerHealth: ['provider-health'] as const,
  providerUsage: (hours: number) => ['provider-usage', hours] as const,
  reports: (kind?: string) => ['reports', kind ?? 'all'] as const,
  shared: (token: string) => ['shared', token] as const,
  monitoring: ['monitoring'] as const,
};

/** Train detail auto-refresh cadence while the tab is visible. */
export const TRAIN_REFETCH_MS = 3 * 60_000;

// ---------------------------------------------------------------- config & auth

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: ({ signal }) => api.config(signal),
    staleTime: 10 * 60_000,
  });
}

export function useMe() {
  return useQuery<User | null>({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }) => {
      try {
        return (await api.me(signal)).user;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED')) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function resetUserScopedQueries(queryClient: QueryClient) {
  for (const key of [queryKeys.history, ['reports'], queryKeys.monitoring, ['provider-usage']]) {
    queryClient.removeQueries({ queryKey: key });
  }
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.login(body),
    onSuccess: ({ user }) => {
      resetUserScopedQueries(queryClient);
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => api.register(body),
    onSuccess: ({ user }) => {
      resetUserScopedQueries(queryClient);
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => {
      queryClient.setQueryData(queryKeys.me, null);
      resetUserScopedQueries(queryClient);
    },
  });
}

// ---------------------------------------------------------------- tracking

export function useTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TrackRequest) => api.track(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

export function useUpload() {
  return useMutation({
    mutationFn: ({ file, journeyDate }: { file: File; journeyDate?: string }) => api.upload(file, journeyDate),
  });
}

export function useTrainStatus(
  trainNumber: string,
  journeyDate: string,
  options: { enabled?: boolean; placeholder?: TrackResult } = {},
) {
  return useQuery({
    queryKey: queryKeys.train(trainNumber, journeyDate),
    queryFn: ({ signal }) => api.train(trainNumber, journeyDate, false, signal),
    enabled: options.enabled ?? true,
    placeholderData: options.placeholder,
    staleTime: 60_000,
    refetchInterval: TRAIN_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
}

/** Force a provider refresh (`refresh=true`) and write the result into the cache and the dashboard. */
export function useRefreshTrain() {
  const queryClient = useQueryClient();
  const upsert = useDashboardStore((s) => s.upsertResults);
  return useMutation({
    mutationFn: ({ trainNumber, journeyDate }: { trainNumber: string; journeyDate: string }) =>
      api.train(trainNumber, journeyDate, true),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.train(result.trainNumber, result.journeyDate), result);
      upsert([result], { onlyExisting: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(result.trainNumber, result.journeyDate) });
    },
  });
}

export function useTrainRoute(trainNumber: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.route(trainNumber),
    queryFn: ({ signal }) => api.route(trainNumber, signal),
    enabled,
    staleTime: 60 * 60_000,
  });
}

export function useSnapshots(trainNumber: string, journeyDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.snapshots(trainNumber, journeyDate),
    queryFn: ({ signal }) => api.snapshots(trainNumber, journeyDate, 50, signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useTrackingHistory(enabled: boolean, pageSize = 5) {
  return useInfiniteQuery({
    queryKey: queryKeys.history,
    queryFn: ({ pageParam, signal }) => api.history({ limit: pageSize, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

// ---------------------------------------------------------------- providers

export function useProviderHealth() {
  return useQuery({
    queryKey: queryKeys.providerHealth,
    queryFn: ({ signal }) => api.providerHealth(signal),
    staleTime: 60_000,
  });
}

export function useProviderUsage(hours: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.providerUsage(hours),
    queryFn: ({ signal }) => api.providerUsage(hours, signal),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------- reports & sharing

export function useReportPreview() {
  return useMutation({ mutationFn: (body: ReportPreviewRequest) => api.reportPreview(body) });
}

export function useSendReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EmailReportRequest) => api.sendReport(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useReports(kind: 'REPORT' | 'ALERT' | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports(kind),
    queryFn: ({ signal }) => api.reports({ limit: 20, kind }, signal),
    enabled,
  });
}

export function useSharedReport(token: string) {
  return useQuery({
    queryKey: queryKeys.shared(token),
    queryFn: ({ signal }) => api.shared(token, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------- monitoring

export function useMonitoring(enabled = true) {
  return useQuery({
    queryKey: queryKeys.monitoring,
    queryFn: ({ signal }) => api.monitoring(signal),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

function replaceSubscription(queryClient: QueryClient, sub: MonitoringSubscription) {
  queryClient.setQueryData<{ items: MonitoringSubscription[] }>(queryKeys.monitoring, (old) => {
    if (!old) return { items: [sub] };
    const exists = old.items.some((s) => s.id === sub.id);
    return { items: exists ? old.items.map((s) => (s.id === sub.id ? sub : s)) : [sub, ...old.items] };
  });
}

export function useCreateMonitoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MonitoringCreate) => api.createMonitoring(body),
    onSuccess: (sub) => replaceSubscription(queryClient, sub),
  });
}

export function usePatchMonitoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MonitoringPatch }) => api.patchMonitoring(id, patch),
    onSuccess: (sub) => replaceSubscription(queryClient, sub),
  });
}

export function useStopMonitoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.stopMonitoring(id),
    onSuccess: (sub) => replaceSubscription(queryClient, sub),
  });
}
