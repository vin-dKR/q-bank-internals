import { errors } from '../../shared/errors/error-catalog.js';
import type { AnswerSheet, ExtractedQuestion, VisionExtractor } from '../../modules/extraction/index.js';

/**
 * Null-object {@link VisionExtractor} used when `OPENAI_API_KEY` is absent, so the worker still
 * boots. Any real extraction fails loudly with a clear, catalogued error instead of a silent no-op.
 */
export class UnconfiguredVisionExtractor implements VisionExtractor {
  extractQuestions(): Promise<ExtractedQuestion[]> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }

  extractAnswers(): Promise<AnswerSheet[]> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }
}
