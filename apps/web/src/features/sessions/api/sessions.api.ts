import { z } from 'zod';
import type { CreateSession, ExtractionJob, Session, SessionStatus, UpdateSession } from '@ingest/contracts';
import { CreateSessionSchema, ExtractionJobSchema, SessionSchema, paginated } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const SessionListSchema = paginated(SessionSchema);
type SessionList = z.infer<typeof SessionListSchema>;

const EnqueueResultSchema = z.object({ enqueued: z.number().int().nonnegative() });
type EnqueueResult = z.infer<typeof EnqueueResultSchema>;

/** Feature-scoped calls to the sessions + extraction endpoints. The only place this feature hits the network. */
export const sessionsApi = {
  list: (status?: SessionStatus): Promise<SessionList> => {
    const query = new URLSearchParams({ page: '1', pageSize: '100' });
    if (status) query.set('status', status);
    return request(`/sessions?${query.toString()}`, { schema: SessionListSchema });
  },

  get: (id: string): Promise<Session> => {
    return request(`/sessions/${id}`, { schema: SessionSchema });
  },

  create: (body: CreateSession): Promise<Session> => {
    return request('/sessions', {
      method: 'POST',
      body: CreateSessionSchema.parse(body),
      schema: SessionSchema,
    });
  },

  update: (id: string, patch: UpdateSession): Promise<Session> => {
    return request(`/sessions/${id}`, { method: 'PATCH', body: patch, schema: SessionSchema });
  },

  remove: (id: string): Promise<{ deleted: boolean }> => {
    return request(`/sessions/${id}`, {
      method: 'DELETE',
      schema: z.object({ deleted: z.boolean() }),
    });
  },

  /** Queue extraction for every not-yet-extracted question document in the session. */
  runExtraction: (id: string): Promise<EnqueueResult> => {
    return request(`/extraction/sessions/${id}`, { method: 'POST', schema: EnqueueResultSchema });
  },

  /** Queue extraction for a single document (the per-file "Run" action). */
  runDocument: (documentId: string): Promise<ExtractionJob> => {
    return request('/extraction', {
      method: 'POST',
      body: { documentId },
      schema: ExtractionJobSchema,
    });
  },
};
