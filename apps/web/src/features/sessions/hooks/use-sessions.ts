import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type {
  CreateSession,
  ExtractionJob,
  Session,
  SessionStatus,
  UpdateSession,
} from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
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

/** Loads one session, polling while it is extracting so the header/KPIs stay live. */
export function useSession(id: string | null): UseQueryResult<Session> {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => sessionsApi.get(id ?? ''),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'extracting' ? 2000 : false),
  });
}

/** Opens a new session and refreshes the list so it appears immediately. */
export function useCreateSession(): UseMutationResult<Session, Error, CreateSession> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (body: CreateSession) => sessionsApi.create(body),
    onError: (err) => { error('Could not create session', err.message); },
    onSuccess: (session) => {
      success('Session created', session.label);
      // Seed the new session into every cached list up front so a component that selects it as the
      // active session sees it as valid *before* the refetch lands — otherwise the gap invites a
      // duplicate-create race.
      queryClient.setQueriesData<SessionList>({ queryKey: ['sessions'] }, (old) =>
        old && !old.items.some((item) => item.id === session.id)
          ? { ...old, items: [session, ...old.items], total: old.total + 1 }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/** Edits a session (rename / retarget / auto-run) and refreshes the session + list views. */
export function useUpdateSession(): UseMutationResult<
  Session,
  Error,
  { id: string; patch: UpdateSession }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateSession }) =>
      sessionsApi.update(input.id, input.patch),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });
}

/** Deletes a session (and all its documents + questions), then refreshes the list. */
export function useDeleteSession(): UseMutationResult<{ deleted: boolean }, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (id: string) => sessionsApi.remove(id),
    onSuccess: () => {
      success('Session deleted');
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => { error('Could not delete session', err.message); },
  });
}

/** Deletes many sessions at once (bulk selection / delete-all-filtered), then refreshes the list. */
export function useBulkDeleteSessions(): UseMutationResult<{ deleted: number }, Error, string[]> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (ids: string[]) => sessionsApi.bulkRemove(ids),
    onSuccess: (result) => {
      success(`${String(result.deleted)} session${result.deleted === 1 ? '' : 's'} deleted`);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => { error('Could not delete sessions', err.message); },
  });
}

/** Queues extraction for a whole session, then refreshes views to show progress. */
export function useRunSessionExtraction(): UseMutationResult<{ enqueued: number }, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (sessionId: string) => sessionsApi.runExtraction(sessionId),
    onSuccess: (result) => {
      success('Extraction queued', `${String(result.enqueued)} file(s) sent to the extractor.`);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => { error('Could not start extraction', err.message); },
  });
}

/** Queues extraction for a single document (per-file Run), then refreshes views. */
export function useRunDocumentExtraction(): UseMutationResult<ExtractionJob, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (documentId: string) => sessionsApi.runDocument(documentId),
    onSuccess: () => {
      success('Extraction queued');
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => { error('Could not start extraction', err.message); },
  });
}
