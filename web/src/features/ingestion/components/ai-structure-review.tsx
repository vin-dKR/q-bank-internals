import type { JSX } from 'react';
import { StructureEstimateRequestSchema } from '@ingest/contracts';
import { IconSparkle, Spinner } from '../../../shared/ui/index.js';
import type { AiStructureController } from '../hooks/use-ai-structure.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';
import { StructureCostSummary } from './structure-cost-summary.js';
import { StructureRulesNotice } from '../../structure-rules/index.js';
import { StructureCropReview } from './structure-crop-review.js';

export function AiStructureReview({
  controller,
  canDetect,
  hasNodes,
  metadata,
  pageCount,
}: {
  controller: AiStructureController;
  canDetect: boolean;
  hasNodes: boolean;
  metadata: ChapterMetadataDraft;
  pageCount: number;
}): JSX.Element {
  const { proposal, busy } = controller;
  const hasPreviousRun = proposal !== null || controller.cost.receipts.length > 0 || hasNodes;
  const generateLabel = hasPreviousRun
    ? 'Regenerate JSON with AI'
    : controller.error && !controller.crops.error
      ? 'Retry JSON with AI'
      : 'Generate JSON with AI';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand/20 bg-brand/5 p-3">
      <span className="text-[13px] font-semibold text-ink">Build structure from heading crops</span>
      <StructureCropReview
        controller={controller.crops}
        disabled={busy || !canDetect}
        contextKey={controller.contextKey}
        onExtract={controller.extractCrop}
      />
      <StructureRulesNotice context={metadata} />
      <StructureCostSummary cost={controller.cost} hasPdf={canDetect} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand/20 pt-2">
        <span className="text-[13px] font-semibold text-ink">4. Build structure JSON</span>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={
            !canDetect ||
            busy ||
            !controller.crops.textCrops.some((crop) => crop.text.trim()) ||
            !StructureEstimateRequestSchema.safeParse({
              pageCount,
              context: metadata,
              crops: controller.crops.textCrops,
            }).success
          }
          onClick={controller.detect}
        >
          {busy ? <Spinner /> : <IconSparkle />}
          {busy ? 'Working…' : generateLabel}
        </button>
      </div>
      <p className="text-[12px] text-ink-3">
        Saving text prepares the input. JSON generation reuses unchanged crop AI results and
        requests any remaining crops. Review the JSON before applying it.
      </p>
      <p className="text-[12px] text-ink-3">
        AI reads only saved OCR text, using your source examples. Code carries preceding Exercise
        and Part headings, resets children when a parent changes, and leaves unnamed Topics blank.
        Printed question types are added to Topics; missing or ambiguous types stay blank. Review
        the JSON and bind PDF pages manually after applying.
      </p>
      {controller.status ? (
        <p role="status" className="text-[12px] font-medium text-brand">
          {controller.status}
        </p>
      ) : null}
      {!canDetect && !busy ? (
        <p className="text-[12px] text-ink-3">
          Load a PDF and apply pending page cuts before selecting heading crops.
        </p>
      ) : null}
      {controller.error ? (
        <p role="alert" className="error text-[13px]">
          {controller.error}
        </p>
      ) : null}
      {proposal ? (
        <>
          <p className="text-[13px] text-ink">
            Ready to review · {proposal.pageCount} PDF pages ·{' '}
            {proposal.answerLayout === 'combined'
              ? 'Companion PDF'
              : proposal.answerLayout === 'inline'
                ? 'Inline answers'
                : 'Grouped separately'}
          </p>
          <p className="text-[12px] text-ink-3">
            {proposal.rule
              ? `Rules used: ${proposal.rule.provider} · ${proposal.rule.source}`
              : 'Rules used: general heading rules'}
          </p>
          {proposal.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-ink-2">
              {proposal.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <details className="text-[12px] text-ink-2">
            <summary className="cursor-pointer">Review generated JSON</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-surface-1 p-2 text-[11px]">
              {JSON.stringify({ version: 1, metadata, nodes: proposal.nodes }, null, 2)}
            </pre>
          </details>
          {hasNodes ? (
            <p className="text-[12px] text-ink-2">
              Applying replaces your current nodes and clears their attachments. Rebind pages
              manually.
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn--primary btn--xs"
              disabled={busy || !canDetect}
              onClick={controller.apply}
            >
              {hasNodes ? 'Replace structure' : 'Apply structure'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              disabled={busy}
              onClick={controller.discard}
            >
              Discard
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
