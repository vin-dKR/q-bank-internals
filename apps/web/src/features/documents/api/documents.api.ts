import type { z } from 'zod';
import { DocumentSchema, paginated } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const DocumentListSchema = paginated(DocumentSchema);
type DocumentList = z.infer<typeof DocumentListSchema>;

/** Feature-scoped calls to the documents endpoints. The only place this feature hits the network. */
export const documentsApi = {
  list: (page = 1, pageSize = 50): Promise<DocumentList> => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return request(`/documents?${query.toString()}`, { schema: DocumentListSchema });
  },
};
