import type { z } from 'zod';
import type { DocumentStatus } from '@ingest/contracts';
import { DocumentSchema, paginated } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const DocumentListSchema = paginated(DocumentSchema);
type DocumentList = z.infer<typeof DocumentListSchema>;

/** Narrows the documents list by session and/or status — the operator's "what's left" filter. */
export type DocumentListParams = {
  page?: number;
  pageSize?: number;
  sessionId?: string;
  status?: DocumentStatus[];
};

/** Feature-scoped calls to the documents endpoints. The only place this feature hits the network. */
export const documentsApi = {
  list: (params: DocumentListParams = {}): Promise<DocumentList> => {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 50),
    });
    if (params.sessionId) query.set('sessionId', params.sessionId);
    for (const status of params.status ?? []) query.append('status', status);
    return request(`/documents?${query.toString()}`, { schema: DocumentListSchema });
  },
};
