import { randomUUID } from 'node:crypto';
import type { SessionListQuery } from '@ingest/contracts';
import type {
  CreateSessionInput,
  SessionRecord,
  SessionRepository,
  UpdateSessionInput,
} from '../../../modules/sessions/index.js';

/**
 * Dev/test adapter for {@link SessionRepository}. Keeps sessions in a Map so the app runs with no
 * database. Swapped for the Prisma adapter in production via DB_DRIVER (wired in the container).
 */
export class InMemorySessionRepository implements SessionRepository {
  private readonly store = new Map<string, SessionRecord>();

  create(input: CreateSessionInput): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      label: input.label ?? `Session · ${now}`,
      exam: input.exam ?? null,
      subject: input.subject ?? null,
      module: input.module ?? null,
      autoRun: input.autoRun,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return Promise.resolve(record);
  }

  findById(id: string): Promise<SessionRecord | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  list(_query: SessionListQuery): Promise<SessionRecord[]> {
    const all = [...this.store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.resolve(all);
  }

  delete(id: string): Promise<void> {
    this.store.delete(id);
    return Promise.resolve();
  }

  update(id: string, patch: UpdateSessionInput): Promise<SessionRecord> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Session ${id} vanished from the in-memory store.`);
    const updated: SessionRecord = {
      ...existing,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.exam !== undefined ? { exam: patch.exam } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.module !== undefined ? { module: patch.module } : {}),
      ...(patch.autoRun !== undefined ? { autoRun: patch.autoRun } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return Promise.resolve(updated);
  }
}
