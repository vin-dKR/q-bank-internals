import type {
  BatchUpdateQuestionsResult,
  DetectedFigures,
  DetectedFiguresBatch,
  DetectedFiguresPage,
  PaperMetadata,
  Passage,
  Question,
  QuestionBatchUpdate,
  QuestionListResponse,
  ReExtractedGroup,
  ReExtractedQuestion,
  ReExtractedSubQuestion,
  ReExtractSource,
  UpdatePassage,
  UpdateQuestion,
} from '@ingest/contracts';
import { createHash } from 'node:crypto';
import type { ReExtractedSubDraft } from './question-reextractor.js';
import { mapWithConcurrency } from '../../shared/async/map-with-concurrency.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { readPngSize } from '../../shared/image/png-size.js';
import type { UsageService } from '../usage/index.js';
import type { DocumentRepository } from '../documents/index.js';
import type { BankQuestionStore } from '../bank/index.js';
import type { DiagramDetector } from './diagram-detector.js';
import { matchFiguresToQuestions } from './figure-matcher.js';
import type { ImageStore } from './image-store.js';
import type { LatexRefiner } from './latex-refiner.js';
import type { PageRenderer } from './page-renderer.js';
import type { PaperMetadataExtractor } from './paper-metadata-extractor.js';
import type { QuestionReExtractor } from './question-reextractor.js';
import type { QuestionRepository } from './questions.repository.js';

/**
 * How many pages a whole-document detection pass sends to the vision model at once. Rendering is
 * cache-backed, so this bounds only the AI fan-out — high enough to keep a 10-page batch inside a
 * serverless window, low enough not to trip provider rate limits.
 */
const DETECT_PAGE_CONCURRENCY = 3;

/**
 * Read + verify side of the extracted questions: load a document's questions, apply verify-screen
 * edits, stage cropped images to storage, detect figures for auto-crop, and refine LaTeX. Depends
 * only on ports (§3).
 */
export class QuestionsService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly documents: DocumentRepository,
    private readonly bank: BankQuestionStore,
    private readonly images: ImageStore,
    private readonly refiner: LatexRefiner,
    private readonly usage: UsageService,
    private readonly detector: DiagramDetector,
    private readonly pages: PageRenderer,
    private readonly reExtractor: QuestionReExtractor,
    private readonly paperMetadata: PaperMetadataExtractor,
  ) {}

  /** The questions extracted from a single document (PDF reading order) + the passages they reference. */
  async listByDocument(documentId: string): Promise<QuestionListResponse> {
    const [questions, passages] = await Promise.all([
      this.questions.findByDocument(documentId),
      this.questions.findPassagesByDocument(documentId),
    ]);
    return { questions, passages };
  }

  /** Apply verify-screen edits (image flags/urls, stem, options, answer) to a question. */
  update(id: string, patch: UpdateQuestion): Promise<Question> {
    return this.questions.update(id, patch);
  }

  /**
   * Delete ONE question everywhere it lives (the verify "Delete" action): remove the staged row
   * (pruning its comprehension passage when it was the group's last member), refresh the document's
   * denormalized question count so the unit list stays honest, then drop its published bank copy if it
   * had been promoted. Idempotent — a double-click / retry whose staged row is already gone is a no-op
   * on staging yet still clears any bank row a partial earlier failure could have stranded (Mongo has
   * no cross-collection transaction here). The count is refreshed BEFORE the bank delete so a bank
   * failure leaves the count correct and only the bank row to reclaim on retry.
   */
  async delete(id: string): Promise<void> {
    const deleted = await this.questions.deleteById(id);
    if (deleted) {
      const remaining = await this.questions.countByDocument(deleted.documentId);
      await this.documents.setQuestionCount(deleted.documentId, remaining);
    }
    await this.bank.deleteByQuestionId(id);
  }

  /** Apply verify-screen edits (text / shared image) to one comprehension passage — fixed in ONE place. */
  updatePassage(id: string, patch: UpdatePassage): Promise<Passage> {
    return this.questions.updatePassage(id, patch);
  }

  /**
   * Manually group already-extracted questions into a new comprehension (the verify "group" action, for
   * a page whose passage the extractor missed). Creates the shared passage and links the questions; the
   * operator then re-extracts the group to read the passage off the page.
   */
  groupQuestions(documentId: string, questionIds: string[]): Promise<Passage> {
    return this.questions.groupQuestions(documentId, makePassageId(documentId, questionIds), questionIds);
  }

  /** Dissolve a comprehension group back into standalone questions (the verify "ungroup" action). */
  ungroupPassage(passageId: string): Promise<void> {
    return this.questions.ungroupPassage(passageId);
  }

  /**
   * Apply verify-screen edits to several questions in one call — the local-first verify panel
   * sends only its dirty questions here. Each update is applied independently: one bad question
   * never blocks the rest, and every failure is reported back by id so the client can keep just
   * those marked dirty.
   */
  async batchUpdate(updates: QuestionBatchUpdate[]): Promise<BatchUpdateQuestionsResult> {
    const updated: Question[] = [];
    const failed: BatchUpdateQuestionsResult['failed'] = [];
    for (const { id, patch } of updates) {
      try {
        updated.push(await this.questions.update(id, patch));
      } catch (caught) {
        failed.push({ id, message: caught instanceof Error ? caught.message : String(caught) });
      }
    }
    return { updated, failed };
  }

  /** Upload one cropped image to storage under `name`, returning its public URL. */
  uploadImage(input: { name: string; bytes: Buffer; contentType: string }): Promise<string> {
    if (!input.name.trim()) throw errors.validation({ message: 'Image name is required.' });
    return this.images.upload(input.name, input.bytes, input.contentType);
  }

  /**
   * Locate the figures on one page of a document and map each back to the question it belongs to.
   * Detection only — the client crops the returned bboxes out of the same page image and uploads
   * them via {@link uploadImage}, so cropping stays in exactly one place (the browser canvas). Each
   * figure is attached by printed number, then by text snippet ({@link matchFiguresToQuestions}); a
   * figure whose question is not on this page is dropped.
   */
  async detectFigures(documentId: string, page: number): Promise<DetectedFigures> {
    const questions = await this.questions.findByDocument(documentId);
    return this.detectOnPage(documentId, page, questions);
  }

  /**
   * The whole-document detect: run {@link detectFigures}'s pipeline over several pages in one
   * request. Only pages that actually have extracted questions are detected (a figure on any other
   * page has nothing to attach to), and the vision calls run with bounded concurrency. The first
   * page is rendered up front so the rasterizer warms its per-document cache once instead of every
   * worker re-rasterizing the PDF on a cold start. One page's failure (a transient provider 429/500)
   * is returned as that page's `ok: false` entry, never as a failure of the whole request — the
   * other pages' detections are already paid for and must reach the client.
   */
  async detectFiguresBatch(documentId: string, pages: number[]): Promise<DetectedFiguresBatch> {
    const questions = await this.questions.findByDocument(documentId);
    const questionPages = new Set(questions.map((question) => question.sourceRegion.page));
    const wanted = [...new Set(pages)].sort((a, b) => a - b).filter((page) => questionPages.has(page));
    const first = wanted[0];
    if (first !== undefined) await this.pages.renderPage(documentId, first);
    const results = await mapWithConcurrency(
      wanted,
      DETECT_PAGE_CONCURRENCY,
      async (page): Promise<DetectedFiguresPage> => {
        try {
          return { ok: true, page, ...(await this.detectOnPage(documentId, page, questions)) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn({ documentId, page, err: message }, 'figure detection failed for one page of a batch');
          return { ok: false, page, error: message };
        }
      },
    );
    return { pages: results };
  }

  /** Detect + match one page's figures against the document's already-loaded questions. */
  private async detectOnPage(
    documentId: string,
    page: number,
    questions: Question[],
  ): Promise<DetectedFigures> {
    const png = await this.pages.renderPage(documentId, page);
    const { width, height } = readPngSize(png);
    const { detections, questionTops, usage } = await this.detector.detect({ png, width, height });
    try {
      await this.usage.recordUsage({ source: 'detection', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record figure-detection token usage');
    }

    const onPage = questions.filter((question) => question.sourceRegion.page === page);
    const figures = matchFiguresToQuestions(detections, questionTops, onPage, width);
    logger.info(
      { documentId, page, detected: detections.length, matched: figures.length },
      'figure detection matched to questions',
    );
    return { imageWidth: width, imageHeight: height, figures };
  }

  /**
   * Re-read one already-extracted question's source page and return its fields afresh (stem,
   * options, answer, explanation) — the verify screen's "read the page again" action. The question
   * is resolved from its document (which also gives its identity: number/stem/type). By default the
   * page read is the question's own source page; `source` redirects it to another document + page —
   * the sibling answer/solution PDF for this topic — so an answer/explanation re-read reads from that
   * sheet, not the question paper. Answer/explanation are best-effort, since a paper rarely prints them.
   */
  async reExtractQuestion(
    documentId: string,
    questionId: string,
    source?: ReExtractSource,
    questionTypeOverride?: string | null,
  ): Promise<ReExtractedQuestion> {
    const questions = await this.questions.findByDocument(documentId);
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question) throw errors.questionNotFound(questionId);
    const sourceDocumentId = source?.documentId ?? documentId;
    const sourcePage = source?.page ?? question.sourceRegion.page;
    const png = await this.pages.renderPage(sourceDocumentId, sourcePage);
    // When the operator has changed the type in verify (not yet saved), honour that choice so the
    // model extracts the right shape for it; otherwise fall back to the question's stored type.
    const questionType = questionTypeOverride ?? question.questionType;
    const { stem, options, answer, explanation, match, usage } = await this.reExtractor.reExtract({
      png,
      questionNumber: question.questionNumber,
      stemHint: question.stem,
      questionType,
    });
    try {
      await this.usage.recordUsage({ source: 'reextract', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record question re-extract token usage');
    }
    return { stem, options, answer, explanation, match };
  }

  /**
   * Re-read a whole COMPREHENSION GROUP off its source page (BLA-125): the shared passage plus every
   * sub-question at once. The group is resolved from its `groupId` within the document (its rows,
   * their source page, and their printed numbers). Each re-extracted sub-question is matched back to
   * the existing row it should update — by printed number, then by position — so the client can drop
   * each straight onto the right card's draft; the passage applies to every row. `source` redirects
   * the page read exactly as {@link reExtractQuestion} (e.g. read the sibling solution PDF); best-effort
   * answer/explanation, since a question paper rarely prints them.
   */
  async reExtractGroup(
    documentId: string,
    passageId: string,
    source?: ReExtractSource,
    questionTypeOverride?: string | null,
  ): Promise<ReExtractedGroup> {
    const [questions, passages] = await Promise.all([
      this.questions.findByDocument(documentId),
      this.questions.findPassagesByDocument(documentId),
    ]);
    // findByDocument returns PDF reading order, which orders a group by groupOrder — so the group's
    // rows arrive in the same order the model reads its sub-questions down the page.
    const group = questions.filter((candidate) => candidate.passageId === passageId);
    const first = group[0];
    if (!first) throw errors.comprehensionGroupNotFound(passageId);
    const passageRow = passages.find((candidate) => candidate.id === passageId);
    const sourceDocumentId = source?.documentId ?? documentId;
    const sourcePage = source?.page ?? first.sourceRegion.page;
    const png = await this.pages.renderPage(sourceDocumentId, sourcePage);
    const { passage, subQuestions, usage } = await this.reExtractor.reExtractGroup({
      png,
      questionNumbers: group.map((question) => question.questionNumber),
      passageHint: passageRow?.text ?? first.stem,
      questionType: questionTypeOverride ?? first.questionType,
    });
    try {
      await this.usage.recordUsage({ source: 'reextract', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record comprehension group re-extract token usage');
    }
    // Fall back to the group's existing passage if the model somehow returned an empty one. The client
    // applies this passage to the group's Passage record (a single PATCH), not to every sub-question.
    const resolvedPassage = passage || (passageRow?.text ?? '');
    return {
      passage: resolvedPassage,
      subQuestions: matchGroupSubQuestions(group, subQuestions),
    };
  }

  /**
   * AI-fill the PYQ paper-details form: read the whole-paper metadata off a rendered header-page
   * image (rasterized in the browser before upload) and return the fields the page prints. Records
   * the token spend like the other vision reads; a blank field simply means the page did not show it.
   */
  async extractPaperMetadata(png: Buffer): Promise<PaperMetadata> {
    const { paper, usage } = await this.paperMetadata.extract({ png });
    try {
      await this.usage.recordUsage({ source: 'paper-metadata', ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record paper-metadata token usage');
    }
    return paper;
  }

  /** One-click "Fix LaTeX": wrap the math in `\(...\)`. Empty text is returned unchanged. */
  async refineLatex(text: string): Promise<string> {
    if (!text.trim()) return text;
    const { text: refined, usage } = await this.refiner.refine(text);
    try {
      await this.usage.recordUsage({ source: 'latex', ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record LaTeX refiner token usage');
    }
    return refined;
  }
}

/**
 * Match a group's freshly re-extracted sub-questions back to the existing rows they should update. A
 * row is paired with the re-read entry that carries its printed number; failing that (an unnumbered
 * sub-question, or a number the model did not return) it takes the entry at the same position. Each
 * pairing is consumed once, so two rows never claim the same entry. Rows with no matching entry are
 * omitted — the client keeps their current draft rather than wiping it. The shared passage is applied
 * separately to the group's Passage record, so sub-questions no longer each carry a passage copy.
 */
/**
 * A stable id for a manually-created comprehension passage, derived from the document + its member
 * question ids (sorted, so it is order-independent and re-grouping the same set is idempotent). Distinct
 * from the extraction path's text-derived id — a manual group has no passage text until it is re-read.
 */
function makePassageId(documentId: string, questionIds: string[]): string {
  const seed = [...questionIds].sort().join(',');
  return createHash('sha1').update(`${documentId}\n${seed}`).digest('hex').slice(0, 24);
}

function matchGroupSubQuestions(
  group: Question[],
  drafts: ReExtractedSubDraft[],
): ReExtractedSubQuestion[] {
  const used = new Set<number>();
  const result: ReExtractedSubQuestion[] = [];
  group.forEach((row, index) => {
    let draftIndex = -1;
    if (row.questionNumber !== null) {
      draftIndex = drafts.findIndex(
        (draft, i) => !used.has(i) && draft.questionNumber === row.questionNumber,
      );
    }
    if (draftIndex === -1 && index < drafts.length && !used.has(index)) draftIndex = index;
    const draft = draftIndex === -1 ? undefined : drafts[draftIndex];
    if (!draft) return;
    used.add(draftIndex);
    result.push({
      questionId: row.id,
      stem: draft.stem,
      options: draft.options,
      answer: draft.answer,
      explanation: draft.explanation,
      match: draft.match,
    });
  });
  return result;
}
