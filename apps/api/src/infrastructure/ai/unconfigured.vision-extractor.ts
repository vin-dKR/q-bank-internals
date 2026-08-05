import { errors } from '../../shared/errors/error-catalog.js';
import type {
  AnswerExtraction,
  QuestionExtraction,
  VisionExtractor,
} from '../../modules/extraction/index.js';

/**
 * Null-object {@link VisionExtractor} used when `OPENAI_API_KEY` is absent, so the worker still
 * boots. Any real extraction fails loudly with a clear, catalogued error instead of a silent no-op.
 */
export class UnconfiguredVisionExtractor implements VisionExtractor {
  extractQuestions(): Promise<QuestionExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }

  extractAnswers(): Promise<AnswerExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }

  extractSolutions(): Promise<AnswerExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }
}
