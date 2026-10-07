import type { StructureExtractor } from '../../modules/ingestion/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { StructureEstimate } from '@ingest/contracts';
import { estimateStructure } from './structure-cost.js';

export class UnconfiguredStructureExtractor implements StructureExtractor {
  estimate(input: Parameters<StructureExtractor['estimate']>[0]): StructureEstimate {
    return estimateStructure('AI not configured', input);
  }
  extract(): Promise<never> {
    return Promise.reject(
      errors.structureDetectionFailed('Set OPENAI_API_KEY to detect PDF structure with AI.'),
    );
  }
}
