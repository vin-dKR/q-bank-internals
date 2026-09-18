import type { SyllabusFile } from '@ingest/contracts';

/** One stored syllabus: the authored file exactly as uploaded, plus when that happened. */
export type StoredSyllabus = { file: SyllabusFile; fileName: string | null; updatedAt: string };

/**
 * PORT: the syllabi an operator has uploaded. One row per exam — uploading an exam again replaces it, so a
 * syllabus is never half-old, half-new. The bundled files are separate (they ship with the app).
 */
export interface SyllabusStore {
  list(): Promise<StoredSyllabus[]>;
  /** Insert or replace each exam's syllabus whole. */
  upsertMany(files: readonly SyllabusFile[], fileName: string | null, at: Date): Promise<void>;
  /** Remove one uploaded syllabus by exam name; false when no row had that name. */
  remove(exam: string): Promise<boolean>;
}
