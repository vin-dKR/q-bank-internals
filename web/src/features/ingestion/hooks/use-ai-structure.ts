import { useRef, useState } from 'react';
import type {
  DetectStructureResult,
  StructureDetectionContext,
  StructureHierarchyLevel,
} from '@ingest/contracts';
import {
  StructureDetectionErrorDetailsSchema,
  StructureEstimateRequestSchema,
  structureHierarchy,
} from '@ingest/contracts';
import { ApiError } from '../../../shared/api/http-client.js';
import type { PdfInput } from '../lib/cut-pdf.js';
import type { StructureNode } from '../types/structure-node.js';
import { ingestionApi } from '../api/ingestion.api.js';
import { materializeStructureQuestions } from '../lib/materialize-structure-questions.js';
import { useStructureCost, type StructureCostController } from './use-structure-cost.js';
import { useStructureCrops, type StructureCropsController } from './use-structure-crops.js';
import { reviewedStructureCropResults } from '../lib/structure-crops.js';
import { useResolvedStructureRule } from '../../structure-rules/index.js';
import type { StructureTaskProgress } from '../lib/structure-task-progress.js';

type Proposal = {
  result: DetectStructureResult;
  bytes: PdfInput;
  contextKey: string;
  textKey: string;
};
type StructureAiTask = 'extract-crop' | 'generate-json' | 'apply-structure';
export type AiStructureController = {
  busy: boolean;
  status: string | null;
  task: StructureAiTask | null;
  progress: StructureTaskProgress | null;
  error: string | null;
  proposal: DetectStructureResult | null;
  cost: StructureCostController;
  crops: StructureCropsController;
  contextKey: string;
  extractCrop: (id: string) => void;
  detect: () => void;
  apply: () => void;
  discard: () => void;
};

/** Keep proposals tied to their PDF and manual context so stale headings cannot replace the tree. */
export function useAiStructure(input: {
  bytes: PdfInput | null;
  pageCount: number;
  context: StructureDetectionContext;
  sessionId: string | null;
  replaceNodes: (nodes: StructureNode[], hierarchy?: StructureHierarchyLevel[]) => void;
  onApplied: () => void;
  onSelectTool: () => void;
  hierarchy?: StructureHierarchyLevel[];
}): AiStructureController {
  const rule = useResolvedStructureRule(input.context);
  const crops = useStructureCrops({
    ...input,
    hierarchy:
      rule.data === undefined
        ? (input.hierarchy ?? structureHierarchy())
        : structureHierarchy(rule.data),
  });
  const contextKey = JSON.stringify({
    context: input.context,
    // Applying the tree snapshot does not change the source rules used by the server.
    rule: rule.data,
  });
  const savedCrops = reviewedStructureCropResults(crops.crops, contextKey);
  // Saving an AI receipt must not invalidate the proposal generated from the same reviewed text.
  const textKey = JSON.stringify(crops.textCrops);
  const cost = useStructureCost({ ...input, crops: crops.textCrops, savedCrops });
  const [status, setStatus] = useState<string | null>(null);
  const [task, setTask] = useState<StructureAiTask | null>(null);
  const [progress, setProgress] = useState<StructureTaskProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  // Ref lock also covers two clicks in the same render, before the busy state reaches the button.
  const running = useRef(false);
  const latest = useRef({ bytes: input.bytes, contextKey, pageCount: input.pageCount, textKey });
  latest.current = { bytes: input.bytes, contextKey, pageCount: input.pageCount, textKey };
  const isCurrent = (value: Proposal): boolean =>
    latest.current.bytes === value.bytes &&
    latest.current.contextKey === value.contextKey &&
    latest.current.pageCount === value.result.pageCount &&
    latest.current.textKey === value.textKey;
  const visibleProposal = proposal && isCurrent(proposal) ? proposal : null;

  const recordFailureUsage = (err: unknown): void => {
    if (err instanceof ApiError) {
      const details = StructureDetectionErrorDetailsSchema.safeParse(err.details);
      if (details.success) cost.recordReceipt(details.data.usage);
    }
  };
  const extractCrop = (id: string): void => {
    const bytes = input.bytes;
    const crop = crops.crops.find((item) => item.id === id);
    if (!bytes || !crop?.ocrDone || !crop.text.trim() || running.current || crops.busy) return;
    const checked = StructureEstimateRequestSchema.safeParse({
      pageCount: input.pageCount,
      context: input.context,
      crops: [
        {
          id: crop.id,
          pageNumber: crop.pageNumber,
          text: crop.text,
          role: crop.role ?? 'combined',
        },
      ],
    });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? 'Invalid crop settings.');
      return;
    }
    running.current = true;
    setError(null);
    setProposal(null);
    setStatus(`Extracting headings with AI · page ${String(crop.pageNumber)}…`);
    setTask('extract-crop');
    void (async (): Promise<void> => {
      try {
        const result = await ingestionApi.detectStructure({
          ...checked.data,
          cropOnly: true,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        });
        if (result.aiCallCount !== 0) cost.recordReceipt(result.usage);
        if (!isCurrent({ result, bytes, contextKey, textKey }))
          throw new Error('The PDF, text or chapter settings changed. Extract this crop again.');
        const extracted = result.cropResults?.find((item) => item.cropId === id);
        if (!extracted)
          throw new Error(
            result.warnings.join(' ') || 'No valid crop result was returned. Try extraction again.',
          );
        crops.saveAi([extracted], contextKey, result.warnings);
      } catch (err) {
        recordFailureUsage(err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        running.current = false;
        setStatus(null);
        setTask(null);
      }
    })();
  };

  const detect = (): void => {
    const bytes = input.bytes;
    if (!bytes || input.pageCount < 1 || running.current || crops.busy) return;
    const checked = StructureEstimateRequestSchema.safeParse({
      pageCount: input.pageCount,
      context: input.context,
      crops: crops.textCrops,
    });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? 'Invalid chapter settings.');
      return;
    }
    running.current = true;
    setError(null);
    setProposal(null);
    crops.setMode('none');
    setStatus('Building JSON from reviewed text…');
    setTask('generate-json');
    setProgress({ completed: 0, total: checked.data.crops.length, awaitingResult: true });
    void (async (): Promise<void> => {
      try {
        const result = await ingestionApi.detectStructure(
          {
            pageCount: input.pageCount,
            context: input.context,
            crops: crops.textCrops,
            savedCrops,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          },
          (update) => {
            if (
              latest.current.bytes !== bytes ||
              latest.current.contextKey !== contextKey ||
              latest.current.textKey !== textKey ||
              latest.current.pageCount !== input.pageCount
            )
              return;
            setProgress((previous) => ({
              completed: Math.max(previous?.completed ?? 0, update.completed),
              total: update.total,
              awaitingResult: true,
            }));
            setStatus(
              update.phase === 'building'
                ? 'Validating the final structure JSON…'
                : `Processed ${String(update.completed)} / ${String(update.total)} crops…`,
            );
          },
        );
        if (result.aiCallCount !== 0) cost.recordReceipt(result.usage);
        const next = { result, bytes, contextKey, textKey };
        if (!isCurrent(next))
          throw new Error(
            'The PDF, reviewed text or chapter settings changed during detection. Generate JSON again.',
          );
        crops.saveAi(result.cropResults ?? [], contextKey, result.warnings);
        setProposal(next);
      } catch (err) {
        recordFailureUsage(err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        running.current = false;
        setStatus(null);
        setTask(null);
        setProgress(null);
      }
    })();
  };

  const apply = (): void => {
    if (!visibleProposal || running.current) return;
    const selected = visibleProposal;
    running.current = true;
    setError(null);
    setStatus('Attaching question pages…');
    setTask('apply-structure');
    void (async (): Promise<void> => {
      try {
        if (!isCurrent(selected))
          throw new Error('The PDF or chapter settings changed. Detect again before applying.');
        const nodes = await materializeStructureQuestions(selected.bytes, selected.result.nodes);
        if (!isCurrent(selected))
          throw new Error(
            'The PDF, text or chapter settings changed. Generate JSON again before applying.',
          );
        // Labels and page ownership are already validated; apply every attachment atomically.
        input.replaceNodes(nodes, structureHierarchy(selected.result.rule));
        setProposal(null);
        input.onApplied();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        running.current = false;
        setStatus(null);
        setTask(null);
      }
    })();
  };
  const visibleError =
    error ??
    (proposal && !visibleProposal
      ? 'The PDF, reviewed text or chapter settings changed. Generate JSON again to update the proposal.'
      : null);
  return {
    busy: status !== null || crops.busy,
    status: status ?? crops.status,
    task,
    progress,
    error: visibleError ?? crops.error,
    proposal: visibleProposal?.result ?? null,
    cost,
    crops,
    contextKey,
    extractCrop,
    detect,
    apply,
    discard: () => {
      setProposal(null);
      setError(null);
    },
  };
}
