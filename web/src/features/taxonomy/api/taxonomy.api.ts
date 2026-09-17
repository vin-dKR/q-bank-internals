import { z } from 'zod';
import type {
  CreateDictionaryEntry,
  DictionaryEntry,
  DictionaryList,
  DictionaryQuery,
  SeedDictionary,
  TaxonomyDimension,
  UpdateDictionaryEntry,
} from '@ingest/contracts';
import { DictionaryEntrySchema, DictionaryListSchema, SeedDictionarySchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const RemovedSchema = z.object({ ok: z.boolean() });

/** Feature-scoped calls to the masters (question-taxonomy) endpoints — the only network seam here. */
export const taxonomyApi = {
  list: (dimension: TaxonomyDimension, query: DictionaryQuery): Promise<DictionaryList> => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.subjectId) params.set('subjectId', query.subjectId);
    if (query.chapterId) params.set('chapterId', query.chapterId);
    const qs = params.toString();
    return request(`/masters/${dimension}${qs ? `?${qs}` : ''}`, { schema: DictionaryListSchema });
  },

  create: (dimension: TaxonomyDimension, body: CreateDictionaryEntry): Promise<DictionaryEntry> => {
    return request(`/masters/${dimension}`, { method: 'POST', body, schema: DictionaryEntrySchema });
  },

  update: (dimension: TaxonomyDimension, id: string, body: UpdateDictionaryEntry): Promise<DictionaryEntry> => {
    return request(`/masters/${dimension}/${id}`, { method: 'PUT', body, schema: DictionaryEntrySchema });
  },

  remove: (dimension: TaxonomyDimension, id: string): Promise<{ ok: boolean }> => {
    return request(`/masters/${dimension}/${id}`, { method: 'DELETE', schema: RemovedSchema });
  },

  seed: (dimension: TaxonomyDimension): Promise<SeedDictionary> => {
    return request(`/masters/${dimension}/seed`, { method: 'POST', schema: SeedDictionarySchema });
  },
};
