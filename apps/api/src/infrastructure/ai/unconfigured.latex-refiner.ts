import { errors } from '../../shared/errors/error-catalog.js';
import type { LatexRefiner } from '../../modules/questions/index.js';

/** Null-object {@link LatexRefiner} used when no OpenAI key is set — fails loudly on use. */
export class UnconfiguredLatexRefiner implements LatexRefiner {
  refine(): Promise<string> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }
}
