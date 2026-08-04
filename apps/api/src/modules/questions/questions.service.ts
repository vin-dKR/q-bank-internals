import type { Question, UpdateQuestion } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { ImageStore } from './image-store.js';
import type { LatexRefiner } from './latex-refiner.js';
import type { QuestionRepository } from './questions.repository.js';

/**
 * Read + verify side of the extracted questions: load a document's questions, apply verify-screen
 * edits, stage cropped images to storage, and refine LaTeX. Depends only on ports (§3).
 */
export class QuestionsService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly images: ImageStore,
    private readonly refiner: LatexRefiner,
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

  /** One-click "Fix LaTeX": wrap the math in `\(...\)`. Empty text is returned unchanged. */
  refineLatex(text: string): Promise<string> {
    if (!text.trim()) return Promise.resolve(text);
    return this.refiner.refine(text);
  }
}
