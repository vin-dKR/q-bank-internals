import { useEffect, useState } from 'react';
import type {
  StructureDetectionUsage,
  StructureEstimate,
  StructureDetectionContext,
  StructureTextCrop,
  StructureExtractedCrop,
} from '@ingest/contracts';
import { ingestionApi } from '../api/ingestion.api.js';
import type { PdfInput } from '../lib/cut-pdf.js';

export type StructureCostController = {
  estimate: StructureEstimate | null;
  estimateError: string | null;
  receipts: (StructureDetectionUsage | null)[];
  recordReceipt: (usage: StructureDetectionUsage | null) => void;
};

/** Estimates follow manual context; billed receipts follow PDF identity and survive apply/discard. */
export function useStructureCost(input: {
  bytes: PdfInput | null;
  pageCount: number;
  context: StructureDetectionContext;
  crops: StructureTextCrop[];
  savedCrops: StructureExtractedCrop[];
}): StructureCostController {
  const { bytes, pageCount, context, crops, savedCrops } = input;
  const contextKey = JSON.stringify(context);
  const cropsKey = JSON.stringify({ crops, savedCrops });
  const [estimateState, setEstimateState] = useState<{
    bytes: PdfInput;
    pageCount: number;
    contextKey: string;
    cropsKey: string;
    estimate: StructureEstimate | null;
    error: string | null;
  } | null>(null);
  const [ledger, setLedger] = useState<{
    bytes: PdfInput;
    receipts: (StructureDetectionUsage | null)[];
  } | null>(null);

  useEffect(() => {
    if (!bytes || pageCount < 1 || crops.length === 0) return;
    let active = true;
    // Typing chapter metadata should not send an HTTP request per keystroke.
    const timer = setTimeout(() => {
      void ingestionApi.estimateStructure({ pageCount, context, crops, savedCrops }).then(
        (estimate) => {
          if (active)
            setEstimateState({ bytes, pageCount, contextKey, cropsKey, estimate, error: null });
        },
        (error: unknown) => {
          if (active)
            setEstimateState({
              bytes,
              pageCount,
              contextKey,
              cropsKey,
              estimate: null,
              error: error instanceof Error ? error.message : String(error),
            });
        },
      );
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bytes, pageCount, context, contextKey, cropsKey]);

  const current =
    estimateState?.bytes === bytes &&
    estimateState.pageCount === pageCount &&
    estimateState.contextKey === contextKey &&
    estimateState.cropsKey === cropsKey &&
    crops.length > 0
      ? estimateState
      : null;
  return {
    estimate: current?.estimate ?? null,
    estimateError: current?.error ?? null,
    receipts: ledger?.bytes === bytes ? ledger.receipts : [],
    recordReceipt: (usage) => {
      if (!bytes) return;
      setLedger((previous) => ({
        bytes,
        receipts: [...(previous?.bytes === bytes ? previous.receipts : []), usage],
      }));
    },
  };
}
