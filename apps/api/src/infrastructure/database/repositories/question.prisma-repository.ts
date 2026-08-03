import type { PrismaClient } from '@prisma/client';
import type { NewQuestion, QuestionRepository } from '../../../modules/questions/index.js';

/**
 * Production adapter for {@link QuestionRepository}, backed by MongoDB via Prisma. Replaces a
 * document's questions wholesale (delete-then-insert) so re-extracting a document is idempotent.
 */
export class PrismaQuestionRepository implements QuestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceForDocument(documentId: string, questions: NewQuestion[]): Promise<number> {
    await this.prisma.question.deleteMany({ where: { documentId } });
    if (questions.length === 0) return 0;
    await this.prisma.question.createMany({
      data: questions.map((question) => ({
        documentId: question.documentId,
        path: question.path,
        stem: question.stem,
        options: question.options,
        answer: question.answer,
        images: question.images,
        sourceRegion: question.sourceRegion,
      })),
    });
    return questions.length;
  }
}
