import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  SessionUsageDetail,
  SessionUsageList,
  TokenLimit,
  UpdateTokenLimit,
  UsageAnalytics,
} from '@ingest/contracts';
import { usageApi } from '../api/usage.api.js';

/** Loads token-usage analytics for the trailing `days` window, refreshed on a slow interval. */
export function useUsageAnalytics(days: number): UseQueryResult<UsageAnalytics> {
  return useQuery({
    queryKey: ['usage', 'analytics', days],
    queryFn: () => usageApi.analytics(days),
    refetchInterval: 15000,
  });
}

/** Loads per-session token spend (biggest eater first) plus unattributed spend. */
export function useSessionUsage(): UseQueryResult<SessionUsageList> {
  return useQuery({
    queryKey: ['usage', 'sessions'],
    queryFn: () => usageApi.sessions(),
    refetchInterval: 15000,
  });
}

/** Loads one session's per-document spend, only once its row is expanded. */
export function useSessionUsageDetail(
  sessionId: string | null,
): UseQueryResult<SessionUsageDetail> {
  return useQuery({
    queryKey: ['usage', 'sessions', sessionId],
    queryFn: () => usageApi.sessionDetail(sessionId ?? ''),
    enabled: sessionId !== null,
  });
}

/** Loads the current global token budget. */
export function useTokenLimit(): UseQueryResult<TokenLimit> {
  return useQuery({
    queryKey: ['usage', 'limit'],
    queryFn: () => usageApi.getLimit(),
  });
}

/** Saves the token budget, then refreshes the budget + analytics views. */
export function useSetTokenLimit(): UseMutationResult<TokenLimit, Error, UpdateTokenLimit> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTokenLimit) => usageApi.setLimit(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}
