import type { Syllabus, SyllabusFormats, SyllabusList, SyllabusUpload, SyllabusUploadResult } from '@ingest/contracts';
import { SyllabusFormatsSchema, SyllabusListSchema, SyllabusSchema, SyllabusUploadResultSchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

/** Feature-scoped calls to the syllabi endpoints. The only place this feature hits the network. */
export const syllabiApi = {
  list: (): Promise<SyllabusList> => request('/syllabi', { schema: SyllabusListSchema }),

  formats: (): Promise<SyllabusFormats> => request('/syllabi/formats', { schema: SyllabusFormatsSchema }),

  detail: (exam: string): Promise<Syllabus> =>
    request(`/syllabi/${encodeURIComponent(exam)}`, { schema: SyllabusSchema }),

  upload: (body: SyllabusUpload): Promise<SyllabusUploadResult> =>
    request('/syllabi', { method: 'POST', body, schema: SyllabusUploadResultSchema }),

  remove: (exam: string): Promise<SyllabusList> =>
    request(`/syllabi/${encodeURIComponent(exam)}`, { method: 'DELETE', schema: SyllabusListSchema }),
};
