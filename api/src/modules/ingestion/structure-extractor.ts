import type {
  StructureDetectionContext,
  StructureDetectionUsage,
  StructureEstimate,
  StructureEstimateRequest,
  StructureRule,
  StructureTextCrop,
  StructureExtractedCrop,
} from '@ingest/contracts';

export interface StructureExtractor {
  /** Local planning estimate; never invokes the model. */
  estimate(input: StructureEstimateRequest & { rule?: StructureRule | null }): StructureEstimate;
  /** Ordered, reviewed OCR text only; code maintains hierarchy between batches. */
  extract(input: {
    crops: StructureTextCrop[];
    pageCount: number;
    context: StructureDetectionContext;
    rule?: StructureRule | null;
    savedCrops?: StructureExtractedCrop[];
    onUsage: (usage: StructureDetectionUsage) => Promise<void>;
    beforeBatch?: () => Promise<void>;
  }): Promise<unknown>;
}
