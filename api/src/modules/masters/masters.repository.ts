import type { TaxonomyDimension } from '@ingest/contracts';

/** One dictionary row as stored in the shared bank; per-dimension extras are null when not applicable. */
export type DictionaryRow = {
  id: string;
  key: string;
  name: string;
  aliases: string[];
  kind: string | null;
  rank: number | null;
  subjectId: string | null;
  chapterId: string | null;
  /** Section only — the independent publisher/module this section is filed under. */
  moduleId: string | null;
  /** Subject only — optional compatible exams. Empty means the subject remains global. */
  examIds: string[];
};

/** Parsed list filters: a name substring + parent-scope narrowing (chapters by subject, sections by module, topics by chapter). */
export type DictionaryFilter = {
  q?: string | undefined;
  subjectId?: string | undefined;
  chapterId?: string | undefined;
  moduleId?: string | undefined;
};

/** A new row to insert. `key` is already canonicalised by the service; `createdAt`/`updatedAt` are set by the store. */
export type NewDictionaryRow = {
  key: string;
  name: string;
  aliases: string[];
  kind: string | null;
  rank: number | null;
  subjectId: string | null;
  chapterId: string | null;
  moduleId: string | null;
  examIds: string[];
};

/** A `$set` patch. Only the keys present are written; `null` clears a scope link. */
export type DictionaryPatch = {
  name?: string;
  aliases?: string[];
  kind?: string;
  rank?: number;
  subjectId?: string | null;
  chapterId?: string | null;
  moduleId?: string | null;
  examIds?: string[];
};

/**
 * PORT (§3) for Masters → Question taxonomy: reads and writes the shared bank's dictionary collections
 * (Exam / Subject / Chapter / Section / QuestionType / Level / Topic). Like the bank/exam-access stores
 * these have no Prisma model here, so the mongo implementation uses raw commands; the dev driver is a
 * null-object. The service canonicalises keys and enforces vocabulary rules BEFORE calling any writer.
 */
export interface TaxonomyStore {
  /** Rows for one dimension, matching the filter, sorted for display. */
  list(dimension: TaxonomyDimension, filter: DictionaryFilter): Promise<DictionaryRow[]>;
  /** The row whose canonical `key` matches, or null — the duplicate check on create. */
  findByKey(dimension: TaxonomyDimension, key: string): Promise<DictionaryRow | null>;
  /** The row with this Mongo `_id`, or null. */
  findById(dimension: TaxonomyDimension, id: string): Promise<DictionaryRow | null>;
  /** Insert a canonical row; returns it read back (with its generated id). */
  create(dimension: TaxonomyDimension, row: NewDictionaryRow): Promise<DictionaryRow>;
  /** `$set` the patch on one row by id; returns the updated row. */
  update(dimension: TaxonomyDimension, id: string, patch: DictionaryPatch): Promise<DictionaryRow>;
  /** Delete one row by id. The service guards usage + closed vocabularies first. */
  remove(dimension: TaxonomyDimension, id: string): Promise<void>;
  /** How many bank `Question` rows reference each id via this dimension's FK column. */
  usageCounts(dimension: TaxonomyDimension, ids: string[]): Promise<Map<string, number>>;
}
