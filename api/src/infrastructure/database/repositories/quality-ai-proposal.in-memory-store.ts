import type { AiProposal } from '@ingest/contracts';
import type { AiProposalPageResult, AiProposalStore, NewAiProposal } from '../../../modules/quality/index.js';

/** In-memory {@link AiProposalStore} (dev). Proposals live for the process lifetime only. */
export class InMemoryAiProposalStore implements AiProposalStore {
  private readonly rows = new Map<string, AiProposal>();
  private sequence = 0;

  save(proposal: NewAiProposal, at: Date): Promise<void> {
    const existing = [...this.rows.values()].find((row) => row.questionId === proposal.questionId);
    this.sequence += 1;
    // Zero-padded so ids sort like the Mongo ObjectIds they stand in for (and pass the cursor format).
    const id = existing?.id ?? this.sequence.toString(16).padStart(24, '0');
    this.rows.set(id, { ...proposal, id, status: 'pending', createdAt: at.toISOString(), decidedAt: null, questionType: null, answerWarnings: [], structureWarnings: [] });
    return Promise.resolve();
  }

  list(status: AiProposal['status'], cursor: string | null, limit: number): Promise<AiProposalPageResult> {
    const matching = [...this.rows.values()]
      .filter((row) => row.status === status)
      .sort((a, b) => b.id.localeCompare(a.id));
    const start = cursor ? matching.findIndex((row) => row.id === cursor) + 1 : 0;
    const page = matching.slice(start, start + limit);
    return Promise.resolve({
      proposals: page,
      nextCursor: start + limit < matching.length ? (page[page.length - 1]?.id ?? null) : null,
      total: matching.length,
    });
  }

  findPending(ids: string[] | null, minConfidence: number | null): Promise<AiProposal[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) =>
          row.status === 'pending' &&
          (ids === null || ids.includes(row.id)) &&
          (minConfidence === null || row.confidence >= minConfidence),
      ),
    );
  }

  setStatus(ids: string[], status: AiProposal['status'], at: Date): Promise<void> {
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, status, decidedAt: at.toISOString() });
    }
    return Promise.resolve();
  }

  countPending(): Promise<number> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.status === 'pending').length);
  }
}
