import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ExtractionDraftStore,
  QuestionDraftProgress,
  QuestionPageDraft,
  SheetPageDraft,
} from '../../../modules/extraction/index.js';

type DraftRow = {
  documentId: string;
  phase: string;
  pageNumber: number;
  scopeKey: string;
  data: Prisma.JsonValue;
  questionCount: number;
};

/** Mongo/Prisma adapter for durable page checkpoints. */
export class PrismaExtractionDraftStore implements ExtractionDraftStore {
  constructor(private readonly prisma: PrismaClient) {}

  async saveQuestionPage(input: {
    jobId: string;
    documentId: string;
    pageNumber: number;
    questions: QuestionPageDraft['questions'];
  }): Promise<void> {
    await this.prisma.extractionPageDraft.upsert({
      where: {
        jobId_documentId_phase_pageNumber_scopeKey: {
          jobId: input.jobId,
          documentId: input.documentId,
          phase: 'question',
          pageNumber: input.pageNumber,
          scopeKey: 'question',
        },
      },
      create: {
        jobId: input.jobId,
        documentId: input.documentId,
        phase: 'question',
        pageNumber: input.pageNumber,
        scopeKey: 'question',
        data: input.questions,
        questionCount: input.questions.length,
      },
      update: {},
    });
  }

  async findQuestionPages(jobId: string): Promise<QuestionPageDraft[]> {
    const rows = await this.prisma.extractionPageDraft.findMany({
      where: { jobId, phase: 'question' },
      orderBy: { pageNumber: 'asc' },
    });
    return rows.map((row) => ({
      pageNumber: row.pageNumber,
      questions: row.data as unknown as QuestionPageDraft['questions'],
    }));
  }

  async questionProgress(jobId: string): Promise<QuestionDraftProgress> {
    const result = await this.prisma.extractionPageDraft.aggregate({
      where: { jobId, phase: 'question' },
      _count: { _all: true },
      _sum: { questionCount: true },
    });
    return {
      pagesDone: result._count._all,
      questionsFound: result._sum.questionCount ?? 0,
    };
  }

  async saveSheetPage(input: SheetPageDraft & { jobId: string }): Promise<void> {
    await this.prisma.extractionPageDraft.upsert({
      where: {
        jobId_documentId_phase_pageNumber_scopeKey: {
          jobId: input.jobId,
          documentId: input.documentId,
          phase: input.phase,
          pageNumber: input.pageNumber,
          scopeKey: input.scopeKey,
        },
      },
      create: {
        jobId: input.jobId,
        documentId: input.documentId,
        phase: input.phase,
        pageNumber: input.pageNumber,
        scopeKey: input.scopeKey,
        data: input.sheets,
      },
      update: {},
    });
  }

  async findSheetPages(jobId: string): Promise<SheetPageDraft[]> {
    const rows = await this.prisma.extractionPageDraft.findMany({
      where: { jobId, phase: { in: ['answer', 'solution', 'companion'] } },
      orderBy: [{ documentId: 'asc' }, { phase: 'asc' }, { pageNumber: 'asc' }, { scopeKey: 'asc' }],
    });
    return rows.map((row) => this.toSheetPage(row));
  }

  deleteByJob(jobId: string): Promise<void> {
    return this.prisma.extractionPageDraft.deleteMany({ where: { jobId } }).then(() => undefined);
  }

  private toSheetPage(row: DraftRow): SheetPageDraft {
    if (row.phase !== 'answer' && row.phase !== 'solution' && row.phase !== 'companion') {
      throw new Error(`Invalid persisted sheet-draft phase: ${row.phase}`);
    }
    return {
      documentId: row.documentId,
      phase: row.phase,
      pageNumber: row.pageNumber,
      scopeKey: row.scopeKey,
      sheets: row.data as unknown as SheetPageDraft['sheets'],
    };
  }
}
