import type { JSX } from 'react';
import { StructureEstimateRequestSchema, structureHierarchy } from '@ingest/contracts';
import { IconSparkle, InfoButton, Spinner } from '../../../shared/ui/index.js';
import type { AiStructureController } from '../hooks/use-ai-structure.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';
import { StructureCostSummary } from './structure-cost-summary.js';
import { StructureRulesNotice } from '../../structure-rules/index.js';
import { StructureCropReview } from './structure-crop-review.js';
import { StructureTaskLoader } from './structure-task-loader.js';

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
  // Older saved proposals do not have this field. Only an explicit incomplete result blocks apply;
  // ordinary extraction warnings remain reviewable and applicable.
  const proposalIncomplete =
    proposal !== null && (proposal as { complete?: boolean }).complete === false;
  const hasPreviousRun = proposal !== null || controller.cost.receipts.length > 0 || hasNodes;
  const generateLabel = hasPreviousRun
    ? 'Regenerate JSON with AI'
    : controller.error && !controller.crops.error
      ? 'Retry JSON with AI'
      : 'Generate JSON with AI';
  return (
    <div
      className="relative flex flex-col gap-2 rounded-lg border border-brand/20 bg-brand/5 p-3"
      aria-busy={busy}
    >
      <span className="text-[13px] font-semibold text-ink">Build structure from heading crops</span>
      <StructureCropReview
        controller={controller.crops}
        disabled={busy || !canDetect}
        aiReady={controller.rulesReady}
        aiError={controller.rulesError}
        contextKey={controller.contextKey}
        onExtract={controller.extractCrop}
        rules={<StructureRulesNotice context={metadata} />}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand/20 pt-2">
        <div className="flex items-center gap-1">
          <span className="text-[13px] font-semibold text-ink">4. Build structure JSON</span>
          <InfoButton label="Building structure JSON">
            <p>
              AI reads saved OCR text using your source examples and hierarchy. JSON generation
              reuses unchanged crop results and requests any remaining crops.
            </p>
            <p className="mt-2">
              Code retains preceding parents and clears deeper levels when a parent changes. Nodes
              are added only for printed headings. Missing or ambiguous question types stay blank.
            </p>
            <p className="mt-2">
              Review the JSON before applying it. Question types and page attachments belong to the
              last node in each branch. Code assigns the split question PDF's pages to final
              children; answer and solution attachments remain manual.
            </p>
          </InfoButton>
          <StructureCostSummary cost={controller.cost} hasPdf={canDetect} />
        </div>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={
            !canDetect ||
            busy ||
            !controller.rulesReady ||
            !controller.crops.textCrops.some((crop) => crop.text.trim()) ||
            !StructureEstimateRequestSchema.safeParse({
              pageCount,
              context: metadata,
              crops: controller.crops.textCrops,
            }).success
          }
          onClick={controller.detect}
        >
          {controller.task === 'generate-json' ? <Spinner /> : <IconSparkle />}
          {controller.task === 'generate-json' ? 'Generating JSON…' : generateLabel}
        </button>
      </div>
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
      {!controller.rulesReady && canDetect && !busy ? (
        <p role="status" className="text-[12px] text-ink-3">
          {controller.rulesError ??
            'Loading heading rules before AI extraction. You can continue OCR and review text.'}
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
          {proposalIncomplete ? (
            <p role="alert" className="error text-[13px]">
              This result is incomplete. Resolve the reported crop issues and generate JSON again
              before applying the structure.
            </p>
          ) : null}
          <details className="text-[12px] text-ink-2">
            <summary className="cursor-pointer">Review generated JSON</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-surface-1 p-2 text-[11px]">
              {JSON.stringify(
                {
                  version: 1,
                  metadata,
                  hierarchy: structureHierarchy(proposal.rule),
                  nodes: proposal.nodes,
                },
                null,
                2,
              )}
            </pre>
          </details>
          {hasNodes ? (
            <p className="text-[12px] text-ink-2">
              Applying replaces your current nodes and attaches the assigned question pages.
              Existing answer and solution attachments are cleared; bind those manually.
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn--primary btn--xs"
              disabled={busy || !canDetect || proposalIncomplete}
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
      {controller.task ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-lg bg-surface/90 p-4">
          <StructureTaskLoader
            {...(controller.task === 'generate-json' && controller.progress
              ? { progress: controller.progress, progressLabel: 'JSON generation completion' }
              : {})}
            label={
              controller.task === 'generate-json'
                ? 'Building structure JSON'
                : controller.task === 'extract-crop'
                  ? 'Extracting headings with AI'
                  : 'Attaching question pages'
            }
            {...(controller.status ? { detail: controller.status } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
