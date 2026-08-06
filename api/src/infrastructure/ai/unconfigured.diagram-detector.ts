import { errors } from '../../shared/errors/error-catalog.js';
import type { DiagramDetectionResult, DiagramDetector } from '../../modules/questions/index.js';

/**
 * Null-object {@link DiagramDetector} used when `OPENAI_API_KEY` is absent, so the app still boots.
 * Any real detection fails loudly with a clear, catalogued error instead of a silent no-op.
 */
export class UnconfiguredDiagramDetector implements DiagramDetector {
  detect(): Promise<DiagramDetectionResult> {
    return Promise.reject(errors.detectionFailed('OPENAI_API_KEY is not configured.'));
  }
}
