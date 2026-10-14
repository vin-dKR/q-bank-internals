export { ExtractionService } from './extraction.service.js';
export { ExtractionWorker } from './extraction.worker.js';
export { ExtractionVisualsService } from './extraction-visuals.service.js';
export { isChemistryDocument } from './chemistry-document.js';
export { nativeChoiceSheet } from './native-choice-key.js';
export type { ImageCropper } from './image-cropper.js';
export { ExtractionRunRegistry, type ExtractionAbortReason } from './extraction-run-registry.js';
export { createExtractionRouter } from './extraction.routes.js';
export type { ExtractionJobPatch, ExtractionJobStore } from './extraction.repository.js';
export type {
  ExtractionDraftStore,
  QuestionDraftProgress,
  QuestionPageDraft,
  SheetPageDraft,
} from './extraction-draft.repository.js';
export type { JobQueue, ExtractionJobPayload } from './job-queue.js';
export { topicBindingForPage, type TopicBinding } from './topic-lookup.js';
export { normalizePrintedQuestionLabel, questionNumberFromPrintedLabel } from './question-identity.js';
export type { PdfRasterizer } from './pdf-rasterizer.js';
export type { SourceBox, SourceOptionAnchor, SourceQuestionAnchor, SourcePageLayout } from './source-page-layout.js';
export type {
  AnswerEntry,
  AnswerExtraction,
  AnswerExtractionScope,
  AnswerSheet,
  ExtractedQuestion,
  ExtractionProgress,
  MasterOption,
  MastersSnapshot,
  PageImage,
  QuestionExtraction,
  VisionExtractor,
} from './vision-extractor.js';
