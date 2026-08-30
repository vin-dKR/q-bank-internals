import { errors } from '../../shared/errors/error-catalog.js';
import type { PaperMetadataExtraction, PaperMetadataExtractor } from '../../modules/questions/index.js';

/** Null-object {@link PaperMetadataExtractor} used when no OpenAI key is set — fails loudly on use. */
export class UnconfiguredPaperMetadataExtractor implements PaperMetadataExtractor {
  extract(): Promise<PaperMetadataExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }
}
