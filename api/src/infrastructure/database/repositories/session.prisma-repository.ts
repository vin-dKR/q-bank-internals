import type { PrismaClient } from '@prisma/client';
import type { SessionListQuery } from '@ingest/contracts';
import type {
  CreateSessionInput,
  SessionRecord,
  SessionRepository,
  UpdateSessionInput,
} from '../../../modules/sessions/index.js';

// Prisma's row shape for a Session, narrowed to what we map. `exam`/`module` are free nullable
// strings, matching the open Exam/Module vocabulary written via the contract.
type SessionRow = {
  id: string;
  label: string;
  exam: string | null;
  subject: string | null;
  module: string | null;
  autoRun: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    label: row.label,
    exam: row.exam,
    subject: row.subject,
    module: row.module,
    autoRun: row.autoRun,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Production adapter for {@link SessionRepository}, backed by MongoDB via Prisma. */
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const row = await this.prisma.session.create({
      data: {
        label: input.label ?? `Session · ${new Date().toISOString()}`,
        exam: input.exam ?? null,
        subject: input.subject ?? null,
        module: input.module ?? null,
        autoRun: input.autoRun,
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async list(_query: SessionListQuery): Promise<SessionRecord[]> {
    const rows = await this.prisma.session.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toRecord);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.session.delete({ where: { id } });
  }

  async update(id: string, patch: UpdateSessionInput): Promise<SessionRecord> {
    const row = await this.prisma.session.update({
      where: { id },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.exam !== undefined ? { exam: patch.exam } : {}),
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
        ...(patch.module !== undefined ? { module: patch.module } : {}),
        ...(patch.autoRun !== undefined ? { autoRun: patch.autoRun } : {}),
      },
    });
    return toRecord(row);
  }
}
