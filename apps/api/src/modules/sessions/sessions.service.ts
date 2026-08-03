import type {
  CreateSession,
  DocumentStatus,
  Session,
  SessionListQuery,
  SessionStatus,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
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
  ) {}

  async create(input: CreateSession): Promise<Session> {
    const record = await this.sessions.create(input);
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

  async setAutoRun(id: string, autoRun: boolean): Promise<Session> {
    const existing = await this.sessions.findById(id);
    if (!existing) throw errors.sessionNotFound(id);
    const record = await this.sessions.setAutoRun(id, autoRun);
    return this.enrich(record);
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
