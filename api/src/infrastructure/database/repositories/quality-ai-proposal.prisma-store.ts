import type { Prisma, PrismaClient, QualityAiProposal as ProposalRow } from '@prisma/client';
import { AiProposalSchema, type AiProposal } from '@ingest/contracts';
import type { AiProposalPageResult, AiProposalStore, NewAiProposal } from '../../../modules/quality/index.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** Map a stored row to the contract shape; a row whose shape no longer parses is skipped, not thrown on. */
function toProposal(row: ProposalRow): AiProposal | null {
  const parsed = AiProposalSchema.safeParse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  });
  return parsed.success ? parsed.data : null;
}

/** Prisma/Mongo {@link AiProposalStore} over `ingest_quality_ai_proposals`. */
export class PrismaAiProposalStore implements AiProposalStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(proposal: NewAiProposal, at: Date): Promise<void> {
    // Every column named, never the proposal spread: a field added to the contract later must not reach Prisma
    // as a column it does not have (which rejects the whole write).
    const data = {
      questionId: proposal.questionId,
      subject: proposal.subject,
      chapter: proposal.chapter,
      questionNumber: proposal.questionNumber,
      preview: proposal.preview,
      fields: proposal.fields,
      topic: proposal.topic,
      answer: proposal.answer,
      solution: proposal.solution,
      level: proposal.level,
      currentTopic: proposal.currentTopic,
      currentAnswer: proposal.currentAnswer,
      currentLevel: proposal.currentLevel,
      confidence: proposal.confidence,
      notes: proposal.notes,
      usedImage: proposal.usedImage,
      model: proposal.model,
      // A parsed structure is plain JSON; the cast only drops zod's optional-key typing.
      structure: proposal.structure as Prisma.InputJsonObject | null,
      status: 'pending',
      createdAt: at,
      decidedAt: null,
    };
    // One row per question: re-running a batch replaces its previous proposal instead of stacking copies.
    await this.prisma.qualityAiProposal.upsert({ where: { questionId: proposal.questionId }, create: data, update: data });
  }

  async list(status: AiProposal['status'], cursor: string | null, limit: number): Promise<AiProposalPageResult> {
    const where = { status };
    const [rows, total] = await Promise.all([
      this.prisma.qualityAiProposal.findMany({
        where,
        orderBy: { id: 'desc' },
        // Over-fetch by one to detect (and produce the cursor for) a next page.
        take: limit + 1,
        ...(cursor && OBJECT_ID.test(cursor) ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.qualityAiProposal.count({ where }),
    ]);
    const page = rows.slice(0, limit);
    return {
      proposals: page.map(toProposal).filter((proposal): proposal is AiProposal => proposal !== null),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async findPending(ids: string[] | null, minConfidence: number | null): Promise<AiProposal[]> {
    const rows = await this.prisma.qualityAiProposal.findMany({
      where: {
        status: 'pending',
        ...(ids ? { id: { in: ids.filter((id) => OBJECT_ID.test(id)) } } : {}),
        ...(minConfidence !== null ? { confidence: { gte: minConfidence } } : {}),
      },
    });
    return rows.map(toProposal).filter((proposal): proposal is AiProposal => proposal !== null);
  }

  async setStatus(ids: string[], status: AiProposal['status'], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.qualityAiProposal.updateMany({
      where: { id: { in: ids } },
      data: { status, decidedAt: at },
    });
  }

  countPending(): Promise<number> {
    return this.prisma.qualityAiProposal.count({ where: { status: 'pending' } });
  }
}
