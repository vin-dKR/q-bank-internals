import type { Prisma, PrismaClient } from '@prisma/client';
import { SyllabusFileSchema, type SyllabusFile } from '@ingest/contracts';
import { logger } from '../../../shared/logger/logger.js';
import type { StoredSyllabus, SyllabusStore } from '../../../modules/syllabi/index.js';

/**
 * Prisma/Mongo {@link SyllabusStore}. The authored tree is stored as one JSON column, because it is read and
 * written whole — an exam's syllabus is replaced, never patched field by field.
 */
export class PrismaSyllabusStore implements SyllabusStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<StoredSyllabus[]> {
    const rows = await this.prisma.syllabus.findMany({ orderBy: { exam: 'asc' } });
    return rows.flatMap((row) => {
      // A row written by an older shape must not break the screen (or the AI's vocabulary) for every exam.
      const parsed = SyllabusFileSchema.safeParse({ exam: row.exam, title: row.title, aliases: row.aliases, subjects: row.subjects });
      if (!parsed.success) {
        logger.warn({ exam: row.exam, err: parsed.error.issues[0]?.message }, 'Skipping a stored syllabus that no longer parses');
        return [];
      }
      return [{ file: parsed.data, fileName: row.fileName, updatedAt: row.updatedAt.toISOString() }];
    });
  }

  async upsertMany(files: readonly SyllabusFile[], fileName: string | null, at: Date): Promise<void> {
    for (const file of files) {
      const subjects = file.subjects as unknown as Prisma.InputJsonValue;
      await this.prisma.syllabus.upsert({
        where: { exam: file.exam },
        create: { exam: file.exam, title: file.title, aliases: file.aliases, subjects, fileName, updatedAt: at },
        update: { title: file.title, aliases: file.aliases, subjects, fileName, updatedAt: at },
      });
    }
  }

  async remove(exam: string): Promise<boolean> {
    const { count } = await this.prisma.syllabus.deleteMany({ where: { exam } });
    return count > 0;
  }
}
