import type {
  Syllabus,
  SyllabusFile,
  SyllabusFormats,
  SyllabusList,
  SyllabusUpload,
  SyllabusUploadResult,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { SyllabusStore } from './syllabi.repository.js';
import { resolveSyllabus, summarise } from './syllabus-ids.js';
import { nameKey } from './syllabus-names.js';
import { parseSyllabusUpload, CSV_COLUMNS } from './syllabus-parse.js';
import { SAMPLE_CSV, SAMPLE_JSON } from './syllabus-samples.js';

/**
 * How long a loaded set of syllabi is reused. An AI batch resolves the scope of 25 questions in a row and
 * each fix resolves one more, so without this every question would re-read the collection; an upload clears
 * it immediately, so the only staleness is between server instances.
 */
const CACHE_MS = 30_000;

/**
 * The exam → subject → chapter → topic syllabi: the files bundled with the app, overridden per exam by
 * anything uploaded here. This is the vocabulary the quality AI may choose a topic from, so an exam with no
 * syllabus has no topics rather than borrowed ones.
 */
export class SyllabiService {
  private cached: { at: number; syllabi: Syllabus[] } | null = null;

  constructor(
    private readonly store: SyllabusStore,
    private readonly bundled: readonly SyllabusFile[],
  ) {}

  /** Every syllabus, uploaded ones first — the order the list screen shows and the AI's vocabulary. */
  async syllabi(): Promise<readonly Syllabus[]> {
    const fresh = this.cached !== null && Date.now() - this.cached.at < CACHE_MS;
    if (this.cached && fresh) return this.cached.syllabi;

    const stored = await this.store.list();
    const uploaded = stored.map((row) => resolveSyllabus(row.file, 'uploaded', row.updatedAt));
    const overridden = new Set(uploaded.map((syllabus) => nameKey(syllabus.exam)));
    const bundled = this.bundled
      .filter((file) => !overridden.has(nameKey(file.exam)))
      .map((file) => resolveSyllabus(file, 'bundled', null));
    const syllabi = [...uploaded, ...bundled];
    this.cached = { at: Date.now(), syllabi };
    return syllabi;
  }

  async list(): Promise<SyllabusList> {
    const syllabi = await this.syllabi();
    return { syllabi: syllabi.map(summarise) };
  }

  /** One exam's full tree, matched on its name or any of its aliases. */
  async detail(exam: string): Promise<Syllabus> {
    const wanted = nameKey(exam);
    const found = (await this.syllabi()).find(
      (syllabus) => [syllabus.exam, ...syllabus.aliases].some((name) => nameKey(name) === wanted),
    );
    if (!found) throw errors.syllabusNotFound(exam);
    return found;
  }

  /** Read an upload and store each exam it names, replacing that exam's syllabus whole. */
  async upload(upload: SyllabusUpload): Promise<SyllabusUploadResult> {
    const files = parseSyllabusUpload(upload);
    const before = new Set((await this.syllabi()).filter((s) => s.source === 'uploaded').map((s) => nameKey(s.exam)));

    await this.store.upsertMany(files, upload.fileName ?? null, new Date());
    this.cached = null;

    const saved = await this.syllabi();
    const uploadedKeys = new Set(files.map((file) => nameKey(file.exam)));
    return {
      saved: saved.filter((syllabus) => uploadedKeys.has(nameKey(syllabus.exam))).map(summarise),
      replaced: files.filter((file) => before.has(nameKey(file.exam))).map((file) => file.exam),
    };
  }

  /** Delete an uploaded syllabus. The exam's bundled file, if it has one, applies again afterwards. */
  async remove(exam: string): Promise<SyllabusList> {
    const removed = await this.store.remove(exam);
    if (!removed) throw errors.syllabusNotFound(exam);
    this.cached = null;
    return this.list();
  }

  /** The upload formats as documentation: the CSV columns plus a sample file of each format. */
  formats(): SyllabusFormats {
    return { csvColumns: [...CSV_COLUMNS], json: SAMPLE_JSON, csv: SAMPLE_CSV };
  }
}
