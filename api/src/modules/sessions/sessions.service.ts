import type {
  CreateSession,
  DocumentStatus,
  Exam,
  Module,
  Session,
  SessionListQuery,
  SessionStatus,
  UpdateSession,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { QuestionRepository } from '../questions/index.js';
import type { ExtractionJobStore } from '../extraction/index.js';
import type { SessionRecord, SessionRepository } from './sessions.repository.js';

type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number };

/** Statuses that count as "the extractor has produced results for this document". */
const EXTRACTED_STATUSES = new Set<DocumentStatus>([
  'extracted',
  'needs_review',
  'approved',
  'published',
  'completed',
]);

/** Statuses that mean extraction is actively in flight. */
const IN_FLIGHT_STATUSES = new Set<DocumentStatus>(['queued', 'extracting']);

/** A friendly default label for an auto-created session, e.g. "Session · Aug 3, 4:30 PM". */
function defaultLabel(): string {
  const now = new Date();
  const stamp = now.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Session · ${stamp}`;
}

/**
 * Derive a session's lifecycle status purely from the statuses of its documents. Keeping this a
 * pure function (no I/O) makes the rule obvious and testable, and means the stored session never
 * carries a status that contradicts its documents.
 */
export function deriveSessionStatus(statuses: DocumentStatus[]): SessionStatus {
  if (statuses.length === 0) return 'open';
  if (statuses.some((status) => IN_FLIGHT_STATUSES.has(status))) return 'extracting';

  const extracted = statuses.filter((status) => EXTRACTED_STATUSES.has(status)).length;
  if (extracted === statuses.length) return 'completed';
  if (extracted > 0) return 'partially_extracted';

  const anyFailed = statuses.some((status) => status === 'failed');
  const anyPending = statuses.some((status) => status === 'uploaded');
  if (anyFailed && !anyPending) return 'failed';
  return 'open';
}

/**
 * Business rules for ingest sessions. Depends on the session PORT plus the document PORT (via the
 * documents barrel) — it reads document statuses to compute each session's live summary, but never
 * sees an HTTP request and never `new`s its dependencies.
 */
export class SessionsService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly documents: DocumentRepository,
    private readonly questions: QuestionRepository,
    private readonly jobs: ExtractionJobStore,
  ) {}

  /** Open a session. All inputs are optional — a missing label is auto-generated (Phase-1 auto-create). */
  async create(input: CreateSession): Promise<Session> {
    const record = await this.sessions.create({
      label: input.label ?? defaultLabel(),
      exam: input.exam,
      subject: input.subject,
      module: input.module,
      autoRun: input.autoRun,
    });
    return this.enrich(record);
  }

  async getById(id: string): Promise<Session> {
    const record = await this.sessions.findById(id);
    if (!record) throw errors.sessionNotFound(id);
    return this.enrich(record);
  }

  async list(query: SessionListQuery): Promise<Paginated<Session>> {
    const records = await this.sessions.list(query);
    const enriched = await Promise.all(records.map((record) => this.enrich(record)));
    const filtered = query.status
      ? enriched.filter((session) => session.status === query.status)
      : enriched;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: filtered.slice(start, start + query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Edit a session (rename / retarget / flip auto-run). */
  async update(id: string, patch: UpdateSession): Promise<Session> {
    const existing = await this.sessions.findById(id);
    if (!existing) throw errors.sessionNotFound(id);
    const record = await this.sessions.update(id, patch);
    return this.enrich(record);
  }

  /** Delete a session and everything under it (its documents + their extracted questions). */
  async delete(id: string): Promise<void> {
    const existing = await this.sessions.findById(id);
    if (!existing) throw errors.sessionNotFound(id);
    await this.purge(id);
  }

  /**
   * Delete several sessions in one call (bulk / delete-all-filtered). Unknown ids are skipped rather
   * than aborting the batch, so a session another operator already removed can't fail the whole
   * request; returns how many were actually purged.
   */
  async deleteMany(ids: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const id of ids) {
      const existing = await this.sessions.findById(id);
      if (!existing) continue;
      await this.purge(id);
      deleted += 1;
    }
    return { deleted };
  }

  /** Cascade-delete one session's documents, their questions, and their extraction jobs, then itself. */
  private async purge(id: string): Promise<void> {
    const documents = await this.documents.listBySession(id);
    for (const document of documents) {
      await this.questions.deleteByDocument(document.id);
      await this.jobs.deleteByDocument(document.id);
    }
    await this.documents.deleteBySession(id);
    await this.sessions.delete(id);
  }

  /**
   * Fill in a session's exam/subject/module from its first uploaded document, but only where they
   * are still blank — so the session summary is informative without the operator setting it twice.
   */
  async backfillContext(
    id: string,
    context: { exam?: Exam; subject?: string; module?: Module },
  ): Promise<void> {
    const existing = await this.sessions.findById(id);
    if (!existing) return;
    const patch: { exam?: Exam; subject?: string; module?: Module } = {};
    if (!existing.exam && context.exam) patch.exam = context.exam;
    if (!existing.subject && context.subject) patch.subject = context.subject;
    if (!existing.module && context.module) patch.module = context.module;
    if (Object.keys(patch).length > 0) await this.sessions.update(id, patch);
  }

  /** Combine a stored session with its derived status + counts to form the contract shape. */
  private async enrich(record: SessionRecord): Promise<Session> {
    const statuses = await this.documents.listStatusesBySession(record.id);
    return {
      id: record.id,
      label: record.label,
      exam: record.exam,
      subject: record.subject,
      module: record.module,
      autoRun: record.autoRun,
      status: deriveSessionStatus(statuses),
      documentCount: statuses.length,
      extractedCount: statuses.filter((status) => EXTRACTED_STATUSES.has(status)).length,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
