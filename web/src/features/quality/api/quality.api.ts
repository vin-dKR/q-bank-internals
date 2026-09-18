import type {
  AiBatchRequest,
  AiFillClaim,
  AiFilledSummary,
  AiBatchResult,
  AiFixField,
  AiFixSuggestion,
  AiProposal,
  AiProposalPage,
  Anomaly,
  DecideProposals,
  DecideProposalsResult,
  AnomalyPage,
  BulkFixPlanId,
  BulkFixPreview,
  BulkFixResult,
  FixQueuePage,
  FixResult,
  FixTarget,
  QualityFilterOptions,
  QualityScan,
  QualityScanList,
  QualitySummary,
  QuestionFix,
  UpdateAnomaly,
} from '@ingest/contracts';
import {
  AiBatchResultSchema,
  AiProposalSchema,
  AiFilledSummarySchema,
  AiFixSuggestionSchema,
  AiProposalPageSchema,
  AnomalyPageSchema,
  DecideProposalsResultSchema,
  AnomalySchema,
  BulkFixPreviewSchema,
  BulkFixResultSchema,
  FixQueuePageSchema,
  FixResultSchema,
  FixTargetSchema,
  QualityFilterOptionsSchema,
  QualityScanListSchema,
  QualityScanSchema,
  QualitySummarySchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import type { QualityFilterState, QualitySelection } from '../types.js';

/** Serialise the selection + cursor into the anomaly-list query string, omitting empty filters. */
function toListQuery(filters: QualityFilterState, cursor: string | null): string {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.group) params.set('group', filters.group);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.exam) params.set('exam', filters.exam);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.chapter) params.set('chapter', filters.chapter);
  const keyword = filters.q.trim();
  if (keyword) params.set('q', keyword);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/** Feature-scoped calls to the quality endpoints. The only place this feature hits the network. */
export const qualityApi = {
  fixQueue: (filters: QualityFilterState, cursor: string | null): Promise<FixQueuePage> =>
    request(`/quality/fix-queue?${toListQuery(filters, cursor)}`, { schema: FixQueuePageSchema }),

  fixTarget: (questionId: string): Promise<FixTarget> =>
    request(`/quality/fix/${questionId}`, { schema: FixTargetSchema }),

  /** `ai` names the saved fields whose value is exactly what an AI suggestion produced. */
  applyFix: (questionId: string, fix: QuestionFix, ai?: AiFillClaim): Promise<FixResult> =>
    request(`/quality/fix/${questionId}`, { method: 'PATCH', body: { fix, ...(ai && { ai }) }, schema: FixResultSchema }),

  aiFilledSummary: (): Promise<AiFilledSummary> =>
    request('/quality/ai-filled', { schema: AiFilledSummarySchema }),

  /** `respectType`: the stored question type is confirmed, so the answer must fit it. */
  aiFix: (questionId: string, fields: AiFixField[], respectType = false): Promise<AiFixSuggestion> =>
    request(`/quality/fix/${questionId}/ai`, { method: 'POST', body: { fields, respectType }, schema: AiFixSuggestionSchema }),

  retryProposal: (id: string): Promise<AiProposal> =>
    request(`/quality/ai-proposals/${id}/retry`, { method: 'POST', body: {}, schema: AiProposalSchema }),

  aiBatch: (body: AiBatchRequest): Promise<AiBatchResult> =>
    request('/quality/ai-batch', { method: 'POST', body, schema: AiBatchResultSchema }),

  /** `needsDecision`: only pending proposals whose answer does not fit their question. */
  proposals: (status: AiProposal['status'], cursor: string | null, needsDecision = false): Promise<AiProposalPage> => {
    const params = new URLSearchParams({ status });
    if (cursor) params.set('cursor', cursor);
    if (needsDecision) params.set('needsDecision', 'true');
    return request(`/quality/ai-proposals?${params.toString()}`, { schema: AiProposalPageSchema });
  },

  decideProposals: (body: DecideProposals): Promise<DecideProposalsResult> =>
    request('/quality/ai-proposals/decide', { method: 'POST', body, schema: DecideProposalsResultSchema }),

  bulkFixes: (): Promise<BulkFixPreview> => request('/quality/bulk-fixes', { schema: BulkFixPreviewSchema }),

  applyBulkFix: (plan: BulkFixPlanId): Promise<BulkFixResult> =>
    request(`/quality/bulk-fixes/${plan}`, { method: 'POST', schema: BulkFixResultSchema }),

  summary: (): Promise<QualitySummary> => request('/quality/summary', { schema: QualitySummarySchema }),

  filterOptions: (selection: QualitySelection): Promise<QualityFilterOptions> => {
    const params = new URLSearchParams({ status: selection.status });
    if (selection.group) params.set('group', selection.group);
    if (selection.kind) params.set('kind', selection.kind);
    if (selection.severity) params.set('severity', selection.severity);
    if (selection.exam) params.set('exam', selection.exam);
    if (selection.subject) params.set('subject', selection.subject);
    if (selection.chapter) params.set('chapter', selection.chapter);
    return request(`/quality/filter-options?${params.toString()}`, { schema: QualityFilterOptionsSchema });
  },

  anomalies: (filters: QualityFilterState, cursor: string | null): Promise<AnomalyPage> =>
    request(`/quality/anomalies?${toListQuery(filters, cursor)}`, { schema: AnomalyPageSchema }),

  updateAnomaly: (id: string, body: UpdateAnomaly): Promise<Anomaly> =>
    request(`/quality/anomalies/${id}`, { method: 'PATCH', body, schema: AnomalySchema }),

  runScan: (): Promise<QualityScan> => request('/quality/scans', { method: 'POST', schema: QualityScanSchema }),

  scans: (): Promise<QualityScanList> => request('/quality/scans', { schema: QualityScanListSchema }),
};
