import type { PrismaClient } from '@prisma/client';
import type { Question, UpdateQuestion } from '@ingest/contracts';
import type { NewQuestion, QuestionRepository } from '../../../modules/questions/index.js';

// Prisma's row shape for a Question, narrowed to what we map back to the contract shape.
type QuestionRow = {
  id: string;
  documentId: string;
  questionNumber: number | null;
  path: { module: string; chapter: string; section: string };
  stem: string;
  options: { label: string; body: string; isCorrect: boolean }[];
  answer: string;
  explanation: string | null;
  images: { driveFileId: string; alt: string }[];
  isQuestionImage: boolean;
  questionImage: string | null;
  isOptionImage: boolean;
  optionImages: string[];
  questionType: string | null;
  sectionName: string | null;
  topic: string | null;
  sourceRegion: { page: number; bbox: number[] };
  createdAt: Date;
  updatedAt: Date;
};

function toQuestion(row: QuestionRow): Question {
  const [x0, y0, x1, y1] = row.sourceRegion.bbox;
  return {
    id: row.id,
    documentId: row.documentId,
    questionNumber: row.questionNumber,
    path: row.path,
    stem: row.stem,
    options: row.options,
    answer: row.answer,
    explanation: row.explanation,
    images: row.images,
    isQuestionImage: row.isQuestionImage,
    questionImage: row.questionImage,
    isOptionImage: row.isOptionImage,
    optionImages: row.optionImages,
    questionType: row.questionType,
    sectionName: row.sectionName,
    topic: row.topic,
    sourceRegion: { page: row.sourceRegion.page, bbox: [x0 ?? 0, y0 ?? 0, x1 ?? 0, y1 ?? 0] },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
        questionNumber: question.questionNumber,
        path: question.path,
        stem: question.stem,
        options: question.options,
        answer: question.answer,
        explanation: question.explanation,
        images: question.images,
        questionType: question.questionType,
        sectionName: question.sectionName,
        topic: question.topic,
        sourceRegion: question.sourceRegion,
      })),
    });
    return questions.length;
  }

  async findByDocument(documentId: string): Promise<Question[]> {
    const rows = await this.prisma.question.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toQuestion);
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.prisma.question.deleteMany({ where: { documentId } });
  }

  async update(id: string, patch: UpdateQuestion): Promise<Question> {
    const row = await this.prisma.question.update({
      where: { id },
      data: {
        ...(patch.stem !== undefined ? { stem: patch.stem } : {}),
        ...(patch.options !== undefined ? { options: patch.options } : {}),
        ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
        ...(patch.images !== undefined ? { images: patch.images } : {}),
        ...(patch.isQuestionImage !== undefined ? { isQuestionImage: patch.isQuestionImage } : {}),
        ...(patch.questionImage !== undefined ? { questionImage: patch.questionImage } : {}),
        ...(patch.isOptionImage !== undefined ? { isOptionImage: patch.isOptionImage } : {}),
        ...(patch.optionImages !== undefined ? { optionImages: patch.optionImages } : {}),
        ...(patch.questionType !== undefined ? { questionType: patch.questionType } : {}),
        ...(patch.sectionName !== undefined ? { sectionName: patch.sectionName } : {}),
        ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
      },
    });
    return toQuestion(row);
  }
}
