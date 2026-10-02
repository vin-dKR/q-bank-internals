import type {
  ExtractionDraftStore,
  QuestionDraftProgress,
  QuestionPageDraft,
  SheetPageDraft,
} from '../../../modules/extraction/index.js';

type StoredDraft = {
  jobId: string;
  documentId: string;
  phase: 'question' | 'answer' | 'solution' | 'companion';
  pageNumber: number;
  scopeKey: string;
  questions?: QuestionPageDraft['questions'];
  sheets?: SheetPageDraft['sheets'];
};

function key(draft: Pick<StoredDraft, 'jobId' | 'documentId' | 'phase' | 'pageNumber' | 'scopeKey'>): string {
  return [draft.jobId, draft.documentId, draft.phase, String(draft.pageNumber), draft.scopeKey].join(':');
}

/** In-memory checkpoint store for local development and unit tests. */
export class InMemoryExtractionDraftStore implements ExtractionDraftStore {
  private readonly store = new Map<string, StoredDraft>();

  saveQuestionPage(input: {
    jobId: string;
    documentId: string;
    pageNumber: number;
    questions: QuestionPageDraft['questions'];
  }): Promise<void> {
    const draft: StoredDraft = { ...input, phase: 'question', scopeKey: 'question' };
    this.store.set(key(draft), draft);
    return Promise.resolve();
  }

  findQuestionPages(jobId: string): Promise<QuestionPageDraft[]> {
    return Promise.resolve(
      [...this.store.values()]
        .filter((draft) => draft.jobId === jobId && draft.phase === 'question')
        .sort((a, b) => a.pageNumber - b.pageNumber)
        .map((draft) => ({ pageNumber: draft.pageNumber, questions: draft.questions ?? [] })),
    );
  }

  questionProgress(jobId: string): Promise<QuestionDraftProgress> {
    const pages = [...this.store.values()].filter((draft) => draft.jobId === jobId && draft.phase === 'question');
    return Promise.resolve({
      pagesDone: pages.length,
      questionsFound: pages.reduce((total, draft) => total + (draft.questions?.length ?? 0), 0),
    });
  }

  saveSheetPage(input: SheetPageDraft & { jobId: string }): Promise<void> {
    const draft: StoredDraft = { ...input };
    this.store.set(key(draft), draft);
    return Promise.resolve();
  }

  findSheetPages(jobId: string): Promise<SheetPageDraft[]> {
    return Promise.resolve(
      [...this.store.values()]
        .filter((draft) => draft.jobId === jobId && draft.phase !== 'question')
        .sort((a, b) => a.pageNumber - b.pageNumber)
        .map((draft) => ({
          documentId: draft.documentId,
          phase: draft.phase as SheetPageDraft['phase'],
          pageNumber: draft.pageNumber,
          scopeKey: draft.scopeKey,
          sheets: draft.sheets ?? [],
        })),
    );
  }

  deleteByJob(jobId: string): Promise<void> {
    for (const [draftKey, draft] of this.store) {
      if (draft.jobId === jobId) this.store.delete(draftKey);
    }
    return Promise.resolve();
  }
}
