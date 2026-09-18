import { Router } from 'express';
import type { QualityService } from './quality.service.js';
import { createQualityController } from './quality.controller.js';

/**
 * Path table for data-quality tracking over the published bank:
 *   GET   /quality/summary                          — status totals, per-rule counts, last scan
 *   GET   /quality/anomalies?status=&group=&kind=&severity=&exam=&subject=&chapter=&q=&cursor=&limit=
 *   GET   /quality/filter-options?…              — exam/subject/chapter values for the current selection
 *   PATCH /quality/anomalies/:id   { status }       — ignore or reopen one anomaly
 *   GET   /quality/fix-queue?…                      — the same filtered set, one row per question
 *   GET   /quality/fix/:questionId                  — one question with its open anomalies (the fix panel)
 *   PATCH /quality/fix/:questionId { fix, ai? }     — save a correction (ai: fields the AI filled), re-checked
 *   POST  /quality/fix/:questionId/ai { fields, respectType? } — ask the AI for topic/answer/solution/level (no write)
 *   POST  /quality/ai-batch { fields, filters, … }  — AI over the next slice of a selection → proposals
 *   GET   /quality/ai-proposals?status=&cursor=     — proposals awaiting review
 *   POST  /quality/ai-proposals/decide              — approve (writes the bank) or decline proposals
 *   POST  /quality/ai-proposals/:id/retry           — re-ask the AI with the question type confirmed
 *   GET   /quality/bulk-fixes                       — rule-only fixes with counts + before/after samples
 *   POST  /quality/bulk-fixes/:plan                 — apply one bulk plan to every affected question
 *   POST  /quality/scans                            — run a scan now (synchronous)
 *   GET   /quality/scans                            — recent scan runs
 *   GET   /quality/ai-filled                        — how many live questions hold AI-written data, per field
 */
export function createQualityRouter(service: QualityService): Router {
  const controller = createQualityController(service);
  const router = Router();
  router.get('/summary', controller.summary);
  router.get('/anomalies', controller.listAnomalies);
  router.get('/filter-options', controller.filterOptions);
  router.patch('/anomalies/:id', controller.updateAnomaly);
  router.get('/fix-queue', controller.fixQueue);
  router.get('/fix/:questionId', controller.fixTarget);
  router.patch('/fix/:questionId', controller.applyFix);
  router.post('/fix/:questionId/ai', controller.aiFix);
  router.post('/ai-batch', controller.aiBatch);
  router.get('/ai-proposals', controller.listProposals);
  router.post('/ai-proposals/decide', controller.decideProposals);
  router.post('/ai-proposals/:id/retry', controller.retryProposal);
  router.get('/bulk-fixes', controller.bulkFixes);
  router.post('/bulk-fixes/:plan', controller.applyBulkFix);
  router.post('/scans', controller.runScan);
  router.get('/scans', controller.listScans);
  router.get('/ai-filled', controller.aiFilledSummary);
  return router;
}
