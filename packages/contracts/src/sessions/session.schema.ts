import { z } from 'zod';
import { ExamSchema, ModuleSchema } from '../common/vocabulary.js';
import { PaginationQuerySchema } from '../common/pagination.js';

/**
 * Lifecycle of an ingest session (one operator's Phase-1 upload run, e.g. a whole module). Derived
 * from the statuses of the documents filed under it — the web dashboard filters and badges on this.
 */
export const SessionStatusSchema = z.enum([
  'open', // accepting uploads; nothing extracted yet
  'extracting', // at least one document is being extracted
  'partially_extracted', // some documents extracted, some still pending
  'completed', // every document extracted (or published)
  'failed', // at least one document failed and none are still in flight
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * A session groups the files an operator uploads in one Phase-1 run. It is the durable, resumable
 * unit: Phase 1 fills it fast and never waits on Phase 2, which drains it later (manually or, when
 * {@link SessionSchema.autoRun} is set, automatically).
 */
export const SessionSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  exam: ExamSchema.nullable(),
  subject: z.string().nullable(),
  module: ModuleSchema.nullable(),
  status: SessionStatusSchema,
  autoRun: z.boolean(), // enqueue extraction automatically as each file is uploaded
  documentCount: z.number().int().nonnegative(),
  extractedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Body accepted when opening a new session — everything is optional so the app can auto-create a
 * session with a generated label the moment Phase 1 starts. `exam`/`subject`/`module` are backfilled
 * from the first uploaded document if omitted. `autoRun` defaults to off (breakable by default).
 */
export const CreateSessionSchema = z.object({
  label: z.string().min(1).optional(),
  exam: ExamSchema.optional(),
  subject: z.string().min(1).optional(),
  module: ModuleSchema.optional(),
  autoRun: z.boolean().default(false),
});
export type CreateSession = z.infer<typeof CreateSessionSchema>;

/** Patch accepted when editing a session (rename, retarget, or flip pipeline mode). */
export const UpdateSessionSchema = z
  .object({
    label: z.string().min(1),
    exam: ExamSchema,
    subject: z.string().min(1),
    module: ModuleSchema,
    autoRun: z.boolean(),
  })
  .partial();
export type UpdateSession = z.infer<typeof UpdateSessionSchema>;

/** Query for listing sessions, optionally narrowed to one lifecycle status. */
export const SessionListQuerySchema = PaginationQuerySchema.extend({
  status: SessionStatusSchema.optional(),
});
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;
