// Public surface of the questions module (§4). Others import from here, never from internals.
export { QuestionsService } from './questions.service.js';
export { createQuestionsRouter } from './questions.routes.js';
export type { NewPassage, NewQuestion, QuestionRepository } from './questions.repository.js';
export { sortByPdfOrder } from './question-order.js';
export { aiFilledAfterEdit } from './ai-filled-edits.js';
export type { ImageStore } from './image-store.js';
export type { LatexRefiner, LatexRefinement, LatexIssueHint } from './latex-refiner.js';
export type { PageRenderer } from './page-renderer.js';
export type {
  DetectorPage,
  DiagramDetection,
  DiagramDetectionResult,
  DiagramDetector,
  QuestionTop,
} from './diagram-detector.js';
export type {
  GroupReExtractInput,
  GroupReExtractMember,
  GroupReExtraction,
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractedSubDraft,
  ReExtractInput,
  SourceAreaTranscription,
  SourceAreaTranscriptionInput,
  TranscribeRegionInput,
} from './question-reextractor.js';
export type {
  PaperMetadataExtraction,
  PaperMetadataExtractor,
} from './paper-metadata-extractor.js';
