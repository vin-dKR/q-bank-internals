import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChapterKind, ChapterTopic, ChapterUploadMetadata } from '@ingest/contracts';
import {
  type CutMode,
  type PreviewView,
  type ReadingOrder,
  PdfModeSelector,
  PdfPagesToolbar,
  PdfPreviewer,
  PdfUploader,
  ReflowBlocksPanel,
  StructureTreePanel,
  applyGridSplit,
  applyReflow,
  assembleChapterUpload,
  deletePage,
  deletePages,
  materializePages,
  useChapterVocabulary,
  useReflowBlocks,
  useSplitPoints,
  useStructureTree,
  useUploadChapter,
  useWorkingDocument,
} from '../../features/ingestion/index.js';
import { SessionBar } from '../../features/sessions/index.js';
import { useCurrentSession } from '../../shared/lib/current-session.js';
import { PageHeader, Spinner, useToast } from '../../shared/ui/index.js';

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1000;
const ZOOM_STEP = 80;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cut & upload — the two-pane workbench. Left: the PDF editor (cut / reflow / delete), pure scratch.
 * Right: the durable structure tree the operator builds and drops finalized slices onto. Editing the
 * PDF on the left never touches the tree — dropping a slice materializes an immutable copy, so there
 * are no page references left to invalidate. On upload each leaf becomes its own unit under today's
 * pipeline (frontend-first: the backend is unchanged).
 */
export function TreeIngestPage(): JSX.Element {
  const navigate = useNavigate();
  const [sessionId] = useCurrentSession();
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [cutMode, setCutMode] = useState<CutMode>('horizontal');
  const [readingOrder, setReadingOrder] = useState<ReadingOrder>('column');
  const [applying, setApplying] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [anchorPage, setAnchorPage] = useState<number | null>(null);
  const [view, setView] = useState<PreviewView>('list');
  const [bindingSlot, setBindingSlot] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [didUpload, setDidUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);

  const splitPoints = useSplitPoints();
  const reflow = useReflowBlocks();
  const workingDoc = useWorkingDocument();
  const upload = useUploadChapter();
  const tree = useStructureTree();
  const vocabulary = useChapterVocabulary();
  const { success, error: toastError } = useToast();
  const { undo, redo } = splitPoints;

  const isReflow = cutMode === 'reflow';
  const activeBytes: ArrayBuffer | Uint8Array | null = workingDoc.current ?? pdfBytes;
  const pendingCount = isReflow ? reflow.totalCrops : splitPoints.totalSplits;

  /** Drop the whole page selection (and its range anchor) — used after any edit that repaginates. */
  const clearSelection = useCallback((): void => {
    setSelectedPages(new Set());
    setAnchorPage(null);
  }, []);

  /** Clear only the working-document scratch — never the tree (that decoupling is the whole point). */
  const resetDoc = useCallback((): void => {
    setPdfBytes(null);
    setFileName(null);
    setNumPages(0);
    clearSelection();
    setPageWidth(DEFAULT_WIDTH);
    splitPoints.reset();
    reflow.clear();
    workingDoc.clear();
  }, [splitPoints, reflow, workingDoc, clearSelection]);

  /** Materialize the mode's edits into a fresh version so modes chain. The tree is untouched. */
  const applyMode = async (): Promise<void> => {
    if (!activeBytes) return;
    setApplying(true);
    try {
      const next = isReflow
        ? await applyReflow(activeBytes, reflow.blocks)
        : await applyGridSplit(activeBytes, splitPoints.splitPoints, readingOrder);
      workingDoc.apply(next, isReflow ? 'reflow' : `${cutMode} cut`);
      splitPoints.reset();
      reflow.clear();
      clearSelection();
    } finally {
      setApplying(false);
    }
  };

  const handleDeletePage = async (pageNumber: number): Promise<void> => {
    if (!activeBytes) return;
    const next = await deletePage(activeBytes, pageNumber);
    workingDoc.apply(next, `delete page ${String(pageNumber)}`);
    splitPoints.reset();
    reflow.clear();
    clearSelection();
  };

  /** Delete every selected page in one pass (page numbers reindex, so the selection is dropped). */
  const handleDeleteSelected = async (): Promise<void> => {
    if (!activeBytes || selectedPages.size === 0) return;
    const pages = [...selectedPages];
    const next = await deletePages(activeBytes, pages);
    workingDoc.apply(next, `delete ${String(pages.length)} pages`);
    splitPoints.reset();
    reflow.clear();
    clearSelection();
  };

  /**
   * Toggle a page's selection. Shift-click extends a contiguous range from the last-clicked anchor —
   * the fast path for grabbing a serial run of pages to drop as one batch.
   */
  const toggleSelect = useCallback(
    (pageNumber: number, options?: { range?: boolean }): void => {
      setSelectedPages((prev) => {
        const next = new Set(prev);
        if (options?.range && anchorPage !== null) {
          const [lo, hi] = anchorPage <= pageNumber ? [anchorPage, pageNumber] : [pageNumber, anchorPage];
          for (let page = lo; page <= hi; page += 1) next.add(page);
        } else if (next.has(pageNumber)) {
          next.delete(pageNumber);
        } else {
          next.add(pageNumber);
        }
        return next;
      });
      // A plain click re-anchors; a shift-range keeps the original anchor for further extension.
      if (!options?.range) setAnchorPage(pageNumber);
    },
    [anchorPage],
  );

  const selectAll = useCallback((): void => {
    setSelectedPages(new Set(Array.from({ length: numPages }, (_, i) => i + 1)));
    setAnchorPage(numPages > 0 ? 1 : null);
  }, [numPages]);

  /** Scroll a page into view — the go-to-page jump and (later) any deep-link to a page. */
  const goToPage = useCallback((pageNumber: number): void => {
    document
      .getElementById(`cut-page-${String(pageNumber)}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  /** Drop → materialize an immutable copy of the dragged pages and bind it to the leaf's part. */
  const onBindPages = useCallback(
    (leafId: string, kind: ChapterKind, pages: number[]): void => {
      if (!activeBytes) return;
      const slot = `${leafId}:${kind}`;
      setBindingSlot(slot);
      void (async (): Promise<void> => {
        try {
          const artifact = await materializePages(activeBytes, pages);
          tree.bindArtifact(leafId, kind, artifact);
          clearSelection();
        } finally {
          setBindingSlot((current) => (current === slot ? null : current));
        }
      })();
    },
    [activeBytes, tree, clearSelection],
  );

  // The keyboard handler reads the latest state/handlers through a ref, so it never re-subscribes and
  // never sees a stale closure (applyMode / handleDeleteSelected are re-created every render).
  const keys = useRef({
    setCutMode,
    setView,
    selectAll,
    clearSelection,
    applyMode,
    handleDeleteSelected,
    undo,
    redo,
    hasSelection: false,
    canApply: false,
  });
  keys.current = {
    setCutMode,
    setView,
    selectAll,
    clearSelection,
    applyMode,
    handleDeleteSelected,
    undo,
    redo,
    hasSelection: selectedPages.size > 0,
    canApply: pendingCount > 0,
  };

  // Power-user shortcuts for the whole workbench, ignored while typing in a field. Cut modes H/V/R,
  // views L/G, ⌘Z / ⌘⇧Z undo-redo, ⌘A select all, ⌘↵ apply, Esc deselect, Del delete selected.
  useEffect(() => {
    if (!activeBytes) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const a = keys.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod) {
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) a.redo(); else a.undo(); }
        else if (key === 'a') { event.preventDefault(); a.selectAll(); }
        else if (key === 'enter' && a.canApply) { event.preventDefault(); void a.applyMode(); }
        return;
      }
      switch (key) {
        case 'h': event.preventDefault(); a.setCutMode('horizontal'); break;
        case 'v': event.preventDefault(); a.setCutMode('vertical'); break;
        case 'r': event.preventDefault(); a.setCutMode('reflow'); break;
        case 'l': event.preventDefault(); a.setView('list'); break;
        case 'g': event.preventDefault(); a.setView('grid'); break;
        case 'escape': a.clearSelection(); break;
        case 'delete':
        case 'backspace':
          if (a.hasSelection) { event.preventDefault(); void a.handleDeleteSelected(); }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [activeBytes]);

  const handleUpload = async (): Promise<void> => {
    if (!sessionId) return;
    const assembled = await assembleChapterUpload(tree.tree);
    if (!assembled.question) {
      setUploadError(assembled.problems[0] ?? 'Add a leaf with a bound question slice first.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    // One unit for the whole chapter: question (primary, carries per-section topics) + optional
    // answer / solution as bound context. Three uploads at most, never one-per-leaf.
    const parts: { kind: ChapterKind; bytes: Uint8Array; topics?: ChapterTopic[] }[] = [
      { kind: 'question', bytes: assembled.question.bytes, topics: assembled.question.topics },
      ...(assembled.answer ? [{ kind: 'answer' as const, bytes: assembled.answer }] : []),
      ...(assembled.solution ? [{ kind: 'solution' as const, bytes: assembled.solution }] : []),
    ];
    const lines: string[] = [];
    let failed = false;
    for (const part of parts) {
      const metadata: ChapterUploadMetadata = {
        ...assembled.base,
        sessionId,
        kind: part.kind,
        ...(part.topics ? { topics: part.topics } : {}),
      };
      try {
        const result = await upload.mutateAsync({ pdfBytes: part.bytes, metadata });
        setDidUpload(true);
        lines.push(`${part.kind} → ${result.document.status}`);
      } catch (err) {
        // Storage is Drive-only: any failure (Drive unreachable, quota, network) surfaces as a toast.
        failed = true;
        const message = errorMessage(err);
        lines.push(`${part.kind} failed: ${message}`);
        toastError(`Couldn’t upload the ${part.kind} PDF`, message);
      }
      setResults([...lines]);
    }
    for (const problem of assembled.problems) lines.push(problem);
    setResults([...lines]);
    if (!failed) {
      success('Uploaded to the session', `${String(parts.length)} file${parts.length === 1 ? '' : 's'} filed to Drive.`);
    }
    setUploading(false);
  };

  if (!activeBytes) {
    return (
      <section className="page">
        <PageHeader
          title="Cut & upload"
          subtitle="Load a PDF to edit on the left, build the chapter structure on the right, then drop slices onto it."
        />
        <SessionBar />
        <div className="card stack">
          <PdfUploader
            fileName={fileName}
            onLoad={(bytes, name) => {
              resetDoc();
              setPdfBytes(bytes);
              setFileName(name);
              workingDoc.reset(new Uint8Array(bytes));
            }}
            onClear={resetDoc}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="workspace">
      <div className="cutter-layout">
        <div className="cutter-layout__preview">
          <PdfModeSelector
            mode={cutMode}
            onModeChange={setCutMode}
            lineCount={pendingCount}
            onApply={() => { void applyMode(); }}
            onResetLines={isReflow ? reflow.clear : splitPoints.clearAll}
            onNewBlock={reflow.newBlock}
            order={readingOrder}
            onOrderChange={setReadingOrder}
            applying={applying}
            steps={workingDoc.steps}
            stepIndex={workingDoc.stepIndex}
            canRevert={workingDoc.canRevert}
            canRedo={workingDoc.canRedo}
            onRevert={workingDoc.revert}
            onRedo={workingDoc.redo}
          />
          <PdfPagesToolbar
            view={view}
            onViewChange={setView}
            zoomPercent={Math.round((pageWidth / DEFAULT_WIDTH) * 100)}
            onZoomIn={() => { setPageWidth((w) => Math.min(MAX_WIDTH, w + ZOOM_STEP)); }}
            onZoomOut={() => { setPageWidth((w) => Math.max(MIN_WIDTH, w - ZOOM_STEP)); }}
            onZoomReset={() => { setPageWidth(DEFAULT_WIDTH); }}
            cutCount={pendingCount}
            cutNoun={isReflow ? 'crops' : 'cuts'}
            numPages={numPages}
            onGoToPage={goToPage}
            selectedCount={selectedPages.size}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onDeleteSelected={() => { void handleDeleteSelected(); }}
          />
          <div className="cutter-layout__scroll">
            <PdfPreviewer
              pdfBytes={activeBytes}
              mode={cutMode}
              order={readingOrder}
              controller={splitPoints}
              reflow={reflow}
              groups={[]}
              pageWidth={pageWidth}
              hoveredSliceId={null}
              onHoverSlice={() => { /* no per-slice tagging in the tree flow */ }}
              onToggleTag={() => { /* tagging happens by dropping onto the tree */ }}
              onNumPages={setNumPages}
              onDeletePage={(pageNumber) => { void handleDeletePage(pageNumber); }}
              taggable={false}
              bindable
              view={view}
              selectedPages={selectedPages}
              onToggleSelect={toggleSelect}
            />
          </div>
        </div>

        <aside className="cutter-layout__panel stack">
          <div className="panel-head">
            <SessionBar compact />
            <div className="panel-file">
              <span className="panel-file__name" title={fileName ?? undefined}>{fileName ?? 'Loaded PDF'}</span>
              <span className="panel-file__meta">
                {numPages > 0 ? <span>{numPages} page{numPages === 1 ? '' : 's'}</span> : null}
                <button type="button" className="btn btn--ghost btn--xs" onClick={resetDoc}>Change file</button>
              </span>
            </div>
          </div>

          {isReflow ? <ReflowBlocksPanel controller={reflow} /> : null}

          <StructureTreePanel
            controller={tree}
            vocabulary={vocabulary}
            onBindPages={onBindPages}
            bindingSlot={bindingSlot}
          />

          {uploadError ? <p className="error">{uploadError}</p> : null}

          {tree.hasNodes ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={uploading || !sessionId}
              onClick={() => { void handleUpload(); }}
            >
              {uploading ? <><Spinner /> Uploading…</> : 'Upload all units'}
            </button>
          ) : null}
          {!sessionId ? <p className="muted">Select or create a session above before uploading.</p> : null}

          {results.length > 0 ? (
            <ul className="results">
              {results.map((line, index) => (
                <li key={index} className="note">{line}</li>
              ))}
            </ul>
          ) : null}

          {didUpload ? (
            <div className="phase-actions">
              <span className="muted">Filed to the session.</span>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!sessionId}
                onClick={() => { if (sessionId) void navigate(`/sessions/${sessionId}`); }}
              >
                Continue to extraction →
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
