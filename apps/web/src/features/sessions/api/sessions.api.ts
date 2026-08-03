import { z } from 'zod';
import type { CreateSession, Session, SessionStatus } from '@ingest/contracts';
import { CreateSessionSchema, SessionSchema, paginated } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const SessionListSchema = paginated(SessionSchema);
type SessionList = z.infer<typeof SessionListSchema>;

const EnqueueResultSchema = z.object({ enqueued: z.number().int().nonnegative() });
type EnqueueResult = z.infer<typeof EnqueueResultSchema>;

/** Feature-scoped calls to the sessions endpoints. The only place this feature hits the network. */
export const sessionsApi = {
  list: (status?: SessionStatus): Promise<SessionList> => {
    const query = new URLSearchParams({ page: '1', pageSize: '100' });
    if (status) query.set('status', status);
    return request(`/sessions?${query.toString()}`, { schema: SessionListSchema });
  },

  create: (body: CreateSession): Promise<Session> => {
    return request('/sessions', {
      method: 'POST',
      body: CreateSessionSchema.parse(body),
      schema: SessionSchema,
    });
  },

  setAutoRun: (id: string, autoRun: boolean): Promise<Session> => {
    return request(`/sessions/${id}`, { method: 'PATCH', body: { autoRun }, schema: SessionSchema });
  },

  /** Queue extraction for every not-yet-extracted question document in the session. */
  runExtraction: (id: string): Promise<EnqueueResult> => {
    return request(`/extraction/sessions/${id}`, { method: 'POST', schema: EnqueueResultSchema });
  },
};
