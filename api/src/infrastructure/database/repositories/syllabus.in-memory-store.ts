import type { SyllabusFile } from '@ingest/contracts';
import { nameKey, type StoredSyllabus, type SyllabusStore } from '../../../modules/syllabi/index.js';

/** In-process {@link SyllabusStore} for the dev driver: uploads last as long as the server does. */
export class InMemorySyllabusStore implements SyllabusStore {
  private readonly rows = new Map<string, StoredSyllabus>();

  list(): Promise<StoredSyllabus[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  upsertMany(files: readonly SyllabusFile[], fileName: string | null, at: Date): Promise<void> {
    for (const file of files) {
      this.rows.set(nameKey(file.exam), { file, fileName, updatedAt: at.toISOString() });
    }
    return Promise.resolve();
  }

  remove(exam: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(nameKey(exam)));
  }
}
