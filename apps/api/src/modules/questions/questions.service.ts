import type { DetectedFigures, Question, UpdateQuestion } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { readPngSize } from '../../shared/image/png-size.js';
import type { UsageService } from '../usage/index.js';
import type { DiagramDetector } from './diagram-detector.js';
import type { ImageStore } from './image-store.js';
import type { LatexRefiner } from './latex-refiner.js';
import type { PageRenderer } from './page-renderer.js';
import type { QuestionRepository } from './questions.repository.js';

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

  /** The questions extracted from a single document, in extraction order. */
  listByDocument(documentId: string): Promise<Question[]> {
    return this.questions.findByDocument(documentId);
  }

  /** Apply verify-screen edits (image flags/urls, stem, options, answer) to a question. */
  update(id: string, patch: UpdateQuestion): Promise<Question> {
    return this.questions.update(id, patch);
  }

  /** Upload one cropped image to storage under `name`, returning its public URL. */
  uploadImage(input: { name: string; bytes: Buffer; contentType: string }): Promise<string> {
    if (!input.name.trim()) throw errors.validation({ message: 'Image name is required.' });
    return this.images.upload(input.name, input.bytes, input.contentType);
  }

  /**
   * Locate the figures on one page of a document and map each back to the question it belongs to.
   * Detection only — the client crops the returned bboxes out of the same page image and uploads
   * them via {@link uploadImage}, so cropping stays in exactly one place (the browser canvas).
   * A detected figure is dropped when no extracted question on that page carries its printed number.
   */
  async detectFigures(documentId: string, page: number): Promise<DetectedFigures> {
    const png = await this.pages.renderPage(documentId, page);
    const { width, height } = readPngSize(png);
    const { detections, usage } = await this.detector.detect({ png, width, height });
    try {
      await this.usage.recordUsage({ source: 'detection', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record figure-detection token usage');
    }

    const onPage = (await this.questions.findByDocument(documentId)).filter(
      (question) => question.sourceRegion.page === page,
    );
    const figures = detections.flatMap((detection) => {
      const question = onPage.find((candidate) => candidate.questionNumber === detection.qNo);
      return question ? [{ questionId: question.id, bbox: detection.bbox }] : [];
    });
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
