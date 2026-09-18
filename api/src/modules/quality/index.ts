// Public surface of the quality module (§4). Tracks data-quality anomalies on the published bank.
export { QualityService } from './quality.service.js';
export { createQualityRouter } from './quality.routes.js';
export { answerLabels, optionBody, optionLabel } from './option-labels.js';
export type {
  AiFixInput,
  AiFixOutput,
  AiProposalPageResult,
  AiProposalStore,
  AiUsage,
  ChapterChoiceInput,
  ChapterChoiceOutput,
  ChapterOption,
  NewAiProposal,
  QuestionAiFixer,
  SyllabusCatalog,
  TopicOption,
  AnomalyFilters,
  AnomalyListPage,
  AnomalyPlaceCount,
  AnomalyStore,
  AnomalyTotals,
  QualityScanStore,
  QuestionAuditSource,
  QuestionFixStore,
  QuestionFixWrite,
  ReviewStatus,
  ScanCounts,
  TrackedAnomaly,
} from './quality.repository.js';
export type { AuditMatchColumn, AuditQuestion, DetectedAnomaly } from './quality.types.js';
