import type {
  BatchUpdateQuestionsResult,
  DetectedFigures,
  DetectedFiguresBatch,
  DetectedFiguresPage,
  Question,
  QuestionBatchUpdate,
  UpdateQuestion,
} from '@ingest/contracts';
import { mapWithConcurrency } from '../../shared/async/map-with-concurrency.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { readPngSize } from '../../shared/image/png-size.js';
import type { UsageService } from '../usage/index.js';
import type { DiagramDetector } from './diagram-detector.js';
import { matchFiguresToQuestions } from './figure-matcher.js';
import type { ImageStore } from './image-store.js';
import type { LatexRefiner } from './latex-refiner.js';
import type { PageRenderer } from './page-renderer.js';
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
    private readonly images: ImageStore,
    private readonly refiner: LatexRefiner,
    private readonly usage: UsageService,
    private readonly detector: DiagramDetector,
    private readonly pages: PageRenderer,
  ) {}

  /** The questions extracted from a single document, in PDF reading order. */
  listByDocument(documentId: string): Promise<Question[]> {
    return this.questions.findByDocument(documentId);
  }

  /** Apply verify-screen edits (image flags/urls, stem, options, answer) to a question. */
  update(id: string, patch: UpdateQuestion): Promise<Question> {
    return this.questions.update(id, patch);
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
