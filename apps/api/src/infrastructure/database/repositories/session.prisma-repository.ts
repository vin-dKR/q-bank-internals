import type { PrismaClient } from '@prisma/client';
import type { Exam, Module, SessionListQuery } from '@ingest/contracts';
import type {
  CreateSessionInput,
  SessionRecord,
  SessionRepository,
} from '../../../modules/sessions/index.js';

// Prisma's row shape for a Session, narrowed to what we map. `exam`/`module` are stored as free
// strings in Mongo but are trusted to hold the controlled vocabulary written through the contract.
type SessionRow = {
  id: string;
  label: string;
  exam: string;
  subject: string;
  module: string;
  autoRun: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    label: row.label,
    exam: row.exam as Exam,
    subject: row.subject,
    module: row.module as Module,
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
        label: input.label,
        exam: input.exam,
        subject: input.subject,
        module: input.module,
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

  async setAutoRun(id: string, autoRun: boolean): Promise<SessionRecord> {
    const row = await this.prisma.session.update({ where: { id }, data: { autoRun } });
    return toRecord(row);
  }
}
