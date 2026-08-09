import { errors } from '../../shared/errors/error-catalog.js';
import type { QuestionReExtraction, QuestionReExtractor } from '../../modules/questions/index.js';

/** Null-object {@link QuestionReExtractor} used when no OpenAI key is set — fails loudly on use. */
export class UnconfiguredQuestionReExtractor implements QuestionReExtractor {
  reExtract(): Promise<QuestionReExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }
}
