import type { PrismaClient } from '@prisma/client';
import {
  type ImageCrop,
  ImageCropSchema,
  type MatchData,
  MatchDataSchema,
  type Passage,
  type Question,
  type UpdatePassage,
  type UpdateQuestion,
} from '@ingest/contracts';
import { z } from 'zod';
import {
  type NewPassage,
  type NewQuestion,
  type QuestionRepository,
  sortByPdfOrder,
} from '../../../modules/questions/index.js';
import { type PaperMetadataRow, toContractPaper, toPrismaPaper } from './paper-metadata-row.js';

// Prisma's row shape for a Question, narrowed to what we map back to the contract shape.
type QuestionRow = {
  id: string;
  documentId: string;
  questionNumber: number | null;
  path: { module: string; chapter: string; section: string };
  stem: string;
  options: { label: string; body: string; isCorrect: boolean }[];
  answer: string;
  // Prisma `Json?`: the structured match data, validated back into shape by `toMatch`.
  match: unknown;
  // Comprehension grouping (BLA-125, v2): the shared passage's id (null off a group) + 0-based order.
  passageId: string | null;
  groupOrder: number | null;
  explanation: string | null;
  images: { driveFileId: string; alt: string }[];
  isQuestionImage: boolean;
  questionImage: string | null;
  isOptionImage: boolean;
  optionImages: string[];
  explanationImages: string[];
  // Prisma `Json?`: the persisted crop rects, validated back into shape by `toImageCrops`.
  imageCrops: unknown;
  questionType: string | null;
  level: string | null;
  sectionName: string | null;
  topic: string | null;
  subject: string | null;
  flagged: boolean;
  isPyq: boolean;
  pyqExam: string | null;
  pyqYear: string | null;
  paper: PaperMetadataRow | null;
  sourceRegion: { page: number; bbox: number[] };
  createdAt: Date;
  updatedAt: Date;
};

// Prisma's row shape for a Passage, narrowed to what we map back to the contract shape (contentHash is
// a persistence-only dedup key and is not surfaced on the contract).
type PassageRow = {
  id: string;
  documentId: string;
  text: string;
  passageImage: string | null;
  imageCrops: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Validate a Prisma `Json?` match column into the contract shape; malformed/absent data → null. */
function toMatch(value: unknown): MatchData | null {
  if (value === null || value === undefined) return null;
  const parsed = MatchDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Validate a Prisma `Json?` crop list into the contract shape; malformed/absent data → empty. */
function toImageCrops(value: unknown): ImageCrop[] {
  if (value === null || value === undefined) return [];
  const parsed = z.array(ImageCropSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

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
    match: toMatch(row.match),
    passageId: row.passageId,
    groupOrder: row.groupOrder,
    explanation: row.explanation,
    images: row.images,
    isQuestionImage: row.isQuestionImage,
    questionImage: row.questionImage,
    isOptionImage: row.isOptionImage,
    optionImages: row.optionImages,
    explanationImages: row.explanationImages,
    imageCrops: toImageCrops(row.imageCrops),
    questionType: row.questionType,
    level: row.level,
    sectionName: row.sectionName,
    topic: row.topic,
    subject: row.subject,
    flagged: row.flagged,
    isPyq: row.isPyq,
    pyqExam: row.pyqExam,
    pyqYear: row.pyqYear,
    paper: toContractPaper(row.paper),
    sourceRegion: { page: row.sourceRegion.page, bbox: [x0 ?? 0, y0 ?? 0, x1 ?? 0, y1 ?? 0] },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPassage(row: PassageRow): Passage {
  return {
    id: row.id,
    documentId: row.documentId,
    text: row.text,
    passageImage: row.passageImage,
    imageCrops: toImageCrops(row.imageCrops),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Production adapter for {@link QuestionRepository}, backed by MongoDB via Prisma. Replaces a
 * document's questions + passages wholesale (delete-then-insert) so re-extracting a document is
 * idempotent.
 */
export class PrismaQuestionRepository implements QuestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceDocument(
    documentId: string,
    passages: NewPassage[],
    questions: NewQuestion[],
  ): Promise<number> {
    // Wholesale replace: clear both collections, then write passages BEFORE questions so every
    // question's passageId resolves. Mongo-via-Prisma has no multi-doc transaction, but the whole run
    // is idempotent — a re-extract wholesale-replaces again with the same deterministic passage ids.
    await this.prisma.question.deleteMany({ where: { documentId } });
    await this.prisma.passage.deleteMany({ where: { documentId } });
    if (passages.length > 0) {
      await this.prisma.passage.createMany({
        data: passages.map((passage) => ({
          id: passage.id,
          documentId: passage.documentId,
          text: passage.text,
          contentHash: passage.contentHash,
          passageImage: passage.passageImage,
          imageCrops: passage.imageCrops,
        })),
      });
    }
    if (questions.length === 0) return 0;
    await this.prisma.question.createMany({
      data: questions.map((question) => ({
        documentId: question.documentId,
        questionNumber: question.questionNumber,
        path: question.path,
        stem: question.stem,
        options: question.options,
        answer: question.answer,
        match: question.match,
        passageId: question.passageId,
        groupOrder: question.groupOrder,
        explanation: question.explanation,
        images: question.images,
        questionType: question.questionType,
        level: question.level,
        sectionName: question.sectionName,
        topic: question.topic,
        subject: question.subject,
        isPyq: question.isPyq,
        pyqExam: question.pyqExam,
        pyqYear: question.pyqYear,
        paper: toPrismaPaper(question.paper),
        sourceRegion: question.sourceRegion,
      })),
    });
    return questions.length;
  }

  async findByDocument(documentId: string): Promise<Question[]> {
    // createdAt is only a stable tie-break; the port's contract is PDF reading order.
    const rows = await this.prisma.question.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });
    return sortByPdfOrder(rows.map(toQuestion));
  }

  async findPassagesByDocument(documentId: string): Promise<Passage[]> {
    const rows = await this.prisma.passage.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPassage);
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.prisma.question.deleteMany({ where: { documentId } });
    await this.prisma.passage.deleteMany({ where: { documentId } });
  }

  async deleteById(id: string): Promise<Question | null> {
    const row = await this.prisma.question.findUnique({ where: { id } });
    if (!row) return null;
    await this.prisma.question.delete({ where: { id } });
    // Drop the shared passage if this was its comprehension group's last member (the same cleanup
    // ungroup/regroup do), so no passage is left dangling with no questions.
    if (row.passageId) {
      const members = await this.prisma.question.count({ where: { passageId: row.passageId } });
      if (members === 0) await this.prisma.passage.deleteMany({ where: { id: row.passageId } });
    }
    return toQuestion(row);
  }

  async countByDocument(documentId: string): Promise<number> {
    return this.prisma.question.count({ where: { documentId } });
  }

  async update(id: string, patch: UpdateQuestion): Promise<Question> {
    const row = await this.prisma.question.update({
      where: { id },
      data: {
        ...(patch.stem !== undefined ? { stem: patch.stem } : {}),
        ...(patch.options !== undefined ? { options: patch.options } : {}),
        ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
        ...(patch.match !== undefined ? { match: patch.match } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
        ...(patch.images !== undefined ? { images: patch.images } : {}),
        ...(patch.isQuestionImage !== undefined ? { isQuestionImage: patch.isQuestionImage } : {}),
        ...(patch.questionImage !== undefined ? { questionImage: patch.questionImage } : {}),
        ...(patch.isOptionImage !== undefined ? { isOptionImage: patch.isOptionImage } : {}),
        ...(patch.optionImages !== undefined ? { optionImages: patch.optionImages } : {}),
        ...(patch.explanationImages !== undefined ? { explanationImages: patch.explanationImages } : {}),
        ...(patch.imageCrops !== undefined ? { imageCrops: patch.imageCrops } : {}),
        ...(patch.questionType !== undefined ? { questionType: patch.questionType } : {}),
        ...(patch.level !== undefined ? { level: patch.level } : {}),
        ...(patch.sectionName !== undefined ? { sectionName: patch.sectionName } : {}),
        ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
        ...(patch.pyqExam !== undefined ? { pyqExam: patch.pyqExam } : {}),
        ...(patch.pyqYear !== undefined ? { pyqYear: patch.pyqYear } : {}),
        ...(patch.paper !== undefined ? { paper: toPrismaPaper(patch.paper) } : {}),
        ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      },
    });
    return toQuestion(row);
  }

  async updatePassage(id: string, patch: UpdatePassage): Promise<Passage> {
    const row = await this.prisma.passage.update({
      where: { id },
      data: {
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.passageImage !== undefined ? { passageImage: patch.passageImage } : {}),
        ...(patch.imageCrops !== undefined ? { imageCrops: patch.imageCrops } : {}),
      },
    });
    return toPassage(row);
  }

  async groupQuestions(
    documentId: string,
    passageId: string,
    questionIds: string[],
  ): Promise<Passage> {
    // Create (or reuse) the empty shared passage (text filled later by re-extract), then point each
    // question at it in the given order. Per-question updates because Mongo updateMany can't set a
    // distinct groupOrder. upsert (not create) keeps re-grouping the same set idempotent — the
    // passageId is deterministic, so a retry/double-click must not collide on the unique _id. `update: {}`
    // preserves any passage text/image already read for this group.
    await this.prisma.passage.upsert({
      where: { id: passageId },
      update: {},
      create: { id: passageId, documentId, text: '', contentHash: passageId, passageImage: null, imageCrops: [] },
    });
    let index = 0;
    for (const questionId of questionIds) {
      await this.prisma.question.update({
        where: { id: questionId },
        data: { passageId, groupOrder: index },
      });
      index += 1;
    }
    await this.pruneEmptyPassages(documentId);
    const row = await this.prisma.passage.findUniqueOrThrow({ where: { id: passageId } });
    return toPassage(row);
  }

  async ungroupPassage(passageId: string): Promise<void> {
    await this.prisma.question.updateMany({
      where: { passageId },
      data: { passageId: null, groupOrder: null },
    });
    await this.prisma.passage.deleteMany({ where: { id: passageId } });
  }

  /** Drop passages that no question references any more (e.g. after a regroup emptied an old group). */
  private async pruneEmptyPassages(documentId: string): Promise<void> {
    const passages = await this.prisma.passage.findMany({ where: { documentId }, select: { id: true } });
    for (const passage of passages) {
      const members = await this.prisma.question.count({
        where: { documentId, passageId: passage.id },
      });
      if (members === 0) await this.prisma.passage.delete({ where: { id: passage.id } });
    }
  }
}
