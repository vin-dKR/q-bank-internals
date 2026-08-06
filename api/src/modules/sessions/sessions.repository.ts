import type { Exam, Module, SessionListQuery } from '@ingest/contracts';

/**
 * The stored shape of a session — base fields only. The lifecycle status and document/extracted
 * counts are NOT stored; the service derives them from the session's documents at read time so
 * they can never drift (see {@link SessionsService}). `exam`/`subject`/`module` are nullable because
 * a session is auto-created before those are known, then backfilled from its first document.
 */
export type SessionRecord = {
  id: string;
  label: string;
  exam: Exam | null;
  subject: string | null;
  module: Module | null;
  autoRun: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Fields accepted when opening a session — all optional; the repo fills a label + defaults. */
export type CreateSessionInput = {
  label?: string | undefined;
  exam?: Exam | undefined;
  subject?: string | undefined;
  module?: Module | undefined;
  autoRun: boolean;
};

/** Fields editable on an existing session. */
export type UpdateSessionInput = {
  label?: string | undefined;
  exam?: Exam | undefined;
  subject?: string | undefined;
  module?: Module | undefined;
  autoRun?: boolean | undefined;
};

/**
 * Persistence PORT for sessions (§3). Implemented in-memory (dev) and via Prisma (prod). Listing is
 * kept simple (all rows, newest first) because sessions are low-cardinality — the service applies
 * the status filter + pagination after enriching each row with its derived summary.
 */
export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  list(query: SessionListQuery): Promise<SessionRecord[]>;
  update(id: string, patch: UpdateSessionInput): Promise<SessionRecord>;
  delete(id: string): Promise<void>;
}
