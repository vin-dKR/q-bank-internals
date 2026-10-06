import { useEffect, useRef, useState } from 'react';
import type {
  StructureCropBounds,
  StructureTextCrop,
  StructureExtractedCrop,
  StructureCropRole,
  StructureHierarchyLevel,
} from '@ingest/contracts';
import { DEFAULT_STRUCTURE_HIERARCHY } from '@ingest/contracts';
import type { PdfInput } from '../lib/cut-pdf.js';
import { ingestionApi } from '../api/ingestion.api.js';
import { renderPageToPng } from '../lib/render-page-image.js';
import type { StructureTaskProgress } from '../lib/structure-task-progress.js';
import {
  StructureCropDraftSchema,
  orderStructureCrops,
  movedStructureCrop,
  retypedStructureCrop,
  reviewedStructureText,
  saveStructureCropResults,
  lockStructureCropSize,
  unlockStructureCropSize,
  type StructureCropDraft,
  type StructureCropDraftItem,
  type StructureCropMode,
  type StructureCropSize,
} from '../lib/structure-crops.js';

export type StructureCropsController = {
  mode: StructureCropMode;
  role: StructureCropRole;
  hierarchy: readonly StructureHierarchyLevel[];
  crops: StructureCropDraftItem[];
  lockedSizes: Readonly<Record<string, StructureCropSize>>;
  ready: boolean;
  ordered: boolean;
  busy: boolean;
  status: string | null;
  progress: StructureTaskProgress | null;
  error: string | null;
  textCrops: StructureTextCrop[];
  setMode: (mode: StructureCropMode) => void;
  setRole: (role: StructureCropRole) => void;
  setCropRole: (id: string, role: StructureCropRole) => void;
  lockSize: (id: string) => void;
  unlockSize: (role: StructureCropRole) => void;
  add: (pageNumber: number, bounds: StructureCropBounds) => void;
  remove: (id: string) => void;
  clear: () => void;
  setBounds: (id: string, bounds: StructureCropBounds) => void;
  move: (id: string, direction: -1 | 1) => void;
  sort: () => void;
  saveOrder: () => void;
  runOcr: () => void;
  rerunOcr: (id?: string) => void;
  editText: (id: string, text: string) => void;
  reviewText: () => void;
  saveText: () => void;
  exportText: () => void;
  saveAi: (
    results: readonly StructureExtractedCrop[],
    contextKey: string,
    warnings: string[],
  ) => void;
};

/** Persist coordinates and reviewed text, never PDF or image blobs. Drafts match the PDF hash. */
export function useStructureCrops(input: {
  bytes: PdfInput | null;
  sessionId: string | null;
  onSelectTool: () => void;
  hierarchy?: StructureHierarchyLevel[];
}): StructureCropsController {
  const { bytes, sessionId } = input;
  const storageKey = `ingest:structure-crops:${sessionId ?? 'scratch'}`;
  const [state, setState] = useState<{
    bytes: PdfInput;
    storageKey: string;
    draft: StructureCropDraft;
  } | null>(null);
  const [selection, setSelection] = useState<{ bytes: PdfInput; mode: StructureCropMode } | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<StructureTaskProgress | null>(null);
  const [role, setRole] = useState<StructureCropRole>('combined');
  const hierarchy = input.hierarchy ?? DEFAULT_STRUCTURE_HIERARCHY;
  const activeRole =
    role === 'combined' || hierarchy.some((level) => level.id === role) ? role : 'combined';
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const latest = useRef({ bytes, storageKey });
  latest.current = { bytes, storageKey };
  const current = state?.bytes === bytes && state.storageKey === storageKey ? state.draft : null;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (!bytes) return;
    let active = true;
    const isActive = (): boolean => active;
    void (async () => {
      try {
        const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
        const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
        const fingerprint = Array.from(new Uint8Array(hash), (value) =>
          value.toString(16).padStart(2, '0'),
        ).join('');
        let restored: StructureCropDraft | null = null;
        try {
          const stored = localStorage.getItem(`${storageKey}:${fingerprint}`);
          if (stored) {
            const checked = StructureCropDraftSchema.safeParse(JSON.parse(stored) as unknown);
            if (checked.success && checked.data.fingerprint === fingerprint)
              restored = checked.data;
            else if (isActive())
              setError('The saved OCR draft is invalid. Create a new draft from this PDF.');
          }
        } catch {
          if (isActive())
            setError('The saved OCR draft could not be read. You can create a new draft.');
        }
        if (isActive())
          setState({
            bytes,
            storageKey,
            draft: restored ?? { version: 1, fingerprint, ordered: false, crops: [] },
          });
      } catch {
        if (isActive()) setError('Could not prepare this PDF for heading crops. Reload the PDF.');
      }
    })();
    return () => {
      active = false;
    };
  }, [bytes, storageKey]);

  useEffect(() => {
    if (!current) return;
    try {
      localStorage.setItem(`${storageKey}:${current.fingerprint}`, JSON.stringify(current));
    } catch {
      setError(
        'Browser storage is full or unavailable. Use Download OCR draft to keep your text before leaving.',
      );
    }
  }, [current, storageKey]);

  const update = (transform: (draft: StructureCropDraft) => StructureCropDraft): void => {
    setState((previous) =>
      previous?.bytes === latest.current.bytes && previous.storageKey === latest.current.storageKey
        ? { ...previous, draft: transform(previous.draft) }
        : previous,
    );
  };
  const isCurrent = (): boolean =>
    latest.current.bytes === bytes && latest.current.storageKey === storageKey;
  const extractText = (pending: StructureCropDraftItem[]): void => {
    if (!bytes || !current?.ordered || running.current) return;
    if (!pending.length) return;
    running.current = true;
    setError(null);
    setProgress({ completed: 0, total: pending.length });
    const selected = new Set(pending.map((crop) => crop.id));
    // Keep the previous text until OCR succeeds, but require review even when a rerun fails.
    update((draft) => ({
      ...draft,
      crops: draft.crops.map((crop) =>
        selected.has(crop.id)
          ? { ...crop, reviewedText: null, ocrDone: false, error: null, ai: null }
          : crop,
      ),
    }));
    void (async () => {
      try {
        for (const [index, crop] of pending.entries()) {
          if (!isCurrent()) break;
          setStatus(
            `OCR crop ${String(index + 1)} / ${String(pending.length)} · page ${String(crop.pageNumber)}`,
          );
          try {
            const png = await renderPageToPng(bytes, crop.pageNumber, 3, crop.bounds);
            if (!isCurrent()) break;
            const result = await ingestionApi.readStructureCrop(png, crop.id);
            if (!isCurrent()) break;
            if (result.cropId !== crop.id)
              throw new Error('The OCR response did not match this crop. Run OCR again.');
            update((draft) => ({
              ...draft,
              crops: draft.crops.map((item) =>
                item.id === crop.id
                  ? {
                      ...item,
                      text: result.text,
                      reviewedText: null,
                      ocrDone: true,
                      confidence: result.confidence,
                      warnings: result.warnings,
                      error: null,
                    }
                  : item,
              ),
            }));
          } catch (err) {
            if (isCurrent())
              update((draft) => ({
                ...draft,
                crops: draft.crops.map((item) =>
                  item.id === crop.id
                    ? {
                        ...item,
                        ocrDone: false,
                        error: err instanceof Error ? err.message : String(err),
                      }
                    : item,
                ),
              }));
          } finally {
            if (isCurrent()) setProgress({ completed: index + 1, total: pending.length });
          }
        }
      } finally {
        running.current = false;
        setStatus(null);
        setProgress(null);
      }
    })();
  };
  return {
    saveAi: (results, contextKey, warnings) => {
      update((draft) => saveStructureCropResults(draft, results, contextKey, warnings));
    },
    mode: selection?.bytes === bytes ? selection.mode : 'none',
    role: activeRole,
    hierarchy,
    crops: current?.crops ?? [],
    lockedSizes: current?.lockedSizes ?? {},
    ready: current !== null,
    ordered: current?.ordered ?? false,
    busy: status !== null,
    status,
    progress,
    error,
    textCrops: current?.crops.every(
      (crop) =>
        (crop.role ?? 'combined') === 'combined' ||
        hierarchy.some((level) => level.id === crop.role),
    )
      ? reviewedStructureText(current)
      : [],
    setRole: (next) => {
      if (!running.current) setRole(next);
    },
    setCropRole: (id, next) => {
      if (running.current) return;
      update((draft) => ({
        ...draft,
        crops: draft.crops.map((crop) =>
          crop.id === id ? retypedStructureCrop(crop, next) : crop,
        ),
      }));
    },
    lockSize: (id) => {
      if (running.current || !bytes) return;
      const crop = current?.crops.find((item) => item.id === id);
      if (!crop) return;
      const cropRole = crop.role ?? 'combined';
      if (cropRole !== 'combined' && !hierarchy.some((level) => level.id === cropRole)) return;
      update((draft) => lockStructureCropSize(draft, id));
      setRole(cropRole);
      input.onSelectTool();
      setSelection({ bytes, mode: 'rectangle' });
    },
    unlockSize: (cropRole) => {
      if (!running.current) update((draft) => unlockStructureCropSize(draft, cropRole));
    },
    setMode: (mode) => {
      if (!bytes || running.current) return;
      if (mode !== 'none') input.onSelectTool();
      setSelection({ bytes, mode });
    },
    add: (pageNumber, bounds) => {
      if (running.current) return;
      if ((current?.crops.length ?? 0) >= 1000) {
        setError('Use at most 1,000 heading crops per PDF.');
        return;
      }
      update((draft) => ({
        ...draft,
        ordered: false,
        crops: orderStructureCrops([
          ...draft.crops,
          {
            id: crypto.randomUUID(),
            pageNumber,
            bounds,
            role: activeRole,
            text: '',
            reviewedText: null,
            ocrDone: false,
            confidence: null,
            warnings: [],
            error: null,
          },
        ]),
      }));
    },
    remove: (id) => {
      if (!running.current)
        update((draft) => ({
          ...draft,
          ordered: false,
          crops: draft.crops.filter((crop) => crop.id !== id),
        }));
    },
    move: (id, direction) => {
      if (running.current) return;
      update((draft) => {
        const crops = [...draft.crops];
        const index = crops.findIndex((crop) => crop.id === id);
        const other = crops[index + direction];
        const selected = crops[index];
        if (other && selected) {
          crops[index] = other;
          crops[index + direction] = selected;
        }
        return { ...draft, ordered: false, crops };
      });
    },
    clear: () => {
      if (running.current) return;
      update((draft) => ({ ...draft, ordered: false, crops: [] }));
      setError(null);
    },
    setBounds: (id, bounds) => {
      if (running.current) return;
      update((draft) => {
        const crops = draft.crops.map((crop) =>
          crop.id === id ? movedStructureCrop(crop, bounds) : crop,
        );
        return crops.some((crop, index) => crop !== draft.crops[index])
          ? { ...draft, ordered: false, crops }
          : draft;
      });
    },
    sort: () => {
      if (!running.current)
        update((draft) => ({ ...draft, ordered: false, crops: orderStructureCrops(draft.crops) }));
    },
    saveOrder: () => {
      if (!running.current) {
        update((draft) => ({ ...draft, ordered: true }));
        if (bytes) setSelection({ bytes, mode: 'none' });
      }
    },
    runOcr: () => {
      extractText(current?.crops.filter((crop) => !crop.ocrDone) ?? []);
    },
    rerunOcr: (id) => {
      extractText(current?.crops.filter((crop) => id === undefined || crop.id === id) ?? []);
    },
    editText: (id, text) => {
      if (!running.current)
        update((draft) => ({
          ...draft,
          crops: draft.crops.map((crop) =>
            crop.id === id
              ? { ...crop, text, reviewedText: null, ocrDone: true, error: null, ai: null }
              : crop,
          ),
        }));
    },
    reviewText: () => {
      if (!running.current)
        update((draft) => ({
          ...draft,
          crops: draft.crops.map((crop) => ({ ...crop, reviewedText: null })),
        }));
    },
    saveText: () => {
      if (!running.current)
        update((draft) => ({
          ...draft,
          crops: draft.crops.map((crop) =>
            crop.ocrDone ? { ...crop, reviewedText: crop.text } : crop,
          ),
        }));
    },
    exportText: () => {
      const draft = currentRef.current;
      if (!draft) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'structure-ocr-draft.json';
      link.click();
      URL.revokeObjectURL(url);
    },
  };
}
