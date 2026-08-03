import type { Exam, Module, SessionListQuery } from '@ingest/contracts';

/**
 * The stored shape of a session — base fields only. The lifecycle status and document/extracted
 * counts are NOT stored; the service derives them from the session's documents at read time so
 * they can never drift (see {@link SessionsService}).
 */
export type SessionRecord = {
  id: string;
  label: string;
  exam: Exam;
  subject: string;
  module: Module;
  autoRun: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Everything needed to open a new session. */
export type CreateSessionInput = {
  label: string;
  exam: Exam;
  subject: string;
  module: Module;
  autoRun: boolean;
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
  setAutoRun(id: string, autoRun: boolean): Promise<SessionRecord>;
}
