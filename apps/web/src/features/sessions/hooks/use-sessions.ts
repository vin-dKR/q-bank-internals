import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type { CreateSession, Session, SessionStatus } from '@ingest/contracts';
import { sessionsApi } from '../api/sessions.api.js';

type SessionList = Awaited<ReturnType<typeof sessionsApi.list>>;

/** Loads the sessions list (optionally narrowed to one lifecycle status), polling while any extract. */
export function useSessions(status?: SessionStatus): UseQueryResult<SessionList> {
  return useQuery({
    queryKey: ['sessions', status ?? null],
    queryFn: () => sessionsApi.list(status),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((session) => session.status === 'extracting') ? 2000 : false;
    },
  });
}

/** Opens a new session and refreshes the list so it appears immediately. */
export function useCreateSession(): UseMutationResult<Session, Error, CreateSession> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSession) => sessionsApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/** Toggles a session's auto-run pipeline mode and refreshes the list. */
export function useSetAutoRun(): UseMutationResult<Session, Error, { id: string; autoRun: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; autoRun: boolean }) =>
      sessionsApi.setAutoRun(input.id, input.autoRun),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/** Queues extraction for a whole session, then refreshes sessions + documents to show progress. */
export function useRunSessionExtraction(): UseMutationResult<{ enqueued: number }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => sessionsApi.runExtraction(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
