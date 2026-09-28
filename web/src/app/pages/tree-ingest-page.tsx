import {
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChapterKind, ChapterTopic, ChapterUploadMetadata } from '@ingest/contracts';
import {
  type CutMode,
  type LoadedPdf,
  type PreviewView,
  type ReadingOrder,
  PdfModeSelector,
  PdfPagesToolbar,
  PdfPreviewer,
  PdfUploader,
  ReflowBlocksPanel,
  StructureTreePanel,
  type ParsedConfig,
  DEFAULT_GRID_COLUMNS,
  MAX_GRID_COLUMNS,
  MIN_GRID_COLUMNS,
  applyGridSplit,
  applyReflow,
  assembleChapterUpload,
  configPageBindings,
  deletePage,
  deletePages,
  ingestionApi,
  materializePages,
  mergePdfs,
  renderPageToPng,
  useChapterVocabulary,
  useReflowBlocks,
  useSplitPoints,
  useStructureTree,
  useUploadChapter,
  useWorkingDocument,
} from '../../features/ingestion/index.js';
import { SessionBar } from '../../features/sessions/index.js';
import { useCurrentSession } from '../../shared/lib/current-session.js';
import { bytesToBlob, saveBlob } from '../../shared/lib/files.js';
import {
  IconButton,
  IconChevronDown,
  IconDownload,
  IconGripVertical,
  PageHeader,
  Spinner,
  useToast,
} from '../../shared/ui/index.js';

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1000;
const ZOOM_STEP = 80;

/** Right-panel width persistence — the operator drags the split to give the topic tree more room. */
const PANEL_KEY = 'ingest:cutterPanelWidth';
const DEFAULT_PANEL = 420;
const MIN_PANEL = 320;
const MAX_PANEL = 720;

/** Read the persisted panel width, clamped to the allowed range; defaults if storage is unreadable. */
function readPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(PANEL_KEY));
    return Number.isFinite(raw) && raw >= MIN_PANEL && raw <= MAX_PANEL ? raw : DEFAULT_PANEL;
  } catch {
    // Storage unavailable (private mode / disabled) — fall back to the default width.
    return DEFAULT_PANEL;
  }
}

/** Persist the panel width; silently no-ops if storage is unavailable. */
function writePanelWidth(width: number): void {
  try {
    localStorage.setItem(PANEL_KEY, String(width));
  } catch {
    // Storage unavailable — the choice just won't survive this reload; nothing to recover.
    return;
  }
}

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
  const [mergedSources, setMergedSources] = useState<{ name: string; from: number; to: number }[]>(
    [],
  );
  // The individual uploaded PDFs are kept (not just the merged bytes) so the operator can reorder
  // them and we can re-merge in the new order. Only populated when more than one file is loaded.
  const [loadedFiles, setLoadedFiles] = useState<LoadedPdf[]>([]);
  const [mergeExpanded, setMergeExpanded] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [cutMode, setCutMode] = useState<CutMode>('none');
  const [readingOrder, setReadingOrder] = useState<ReadingOrder>('column');
  const [reflowFragmentFirst, setReflowFragmentFirst] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [anchorPage, setAnchorPage] = useState<number | null>(null);
  const [view, setView] = useState<PreviewView>('list');
  const [gridColumns, setGridColumns] = useState(DEFAULT_GRID_COLUMNS);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const panelWidthRef = useRef(panelWidth);
  const [bindingSlot, setBindingSlot] = useState<string | null>(null);
  const [aiFillingPaper, setAiFillingPaper] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [didUpload, setDidUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ kind: ChapterKind; pct: number } | null>(
    null,
  );

  const splitPoints = useSplitPoints();
  const reflow = useReflowBlocks();
  const workingDoc = useWorkingDocument();
  const upload = useUploadChapter();
  const tree = useStructureTree();
  const vocabulary = useChapterVocabulary();
  const { toast, success, error: toastError } = useToast();
  const { undo, redo } = splitPoints;

  const isReflow = cutMode === 'reflow';
  const activeBytes: ArrayBuffer | Uint8Array | null = workingDoc.current ?? pdfBytes;
  const pendingCount = isReflow ? reflow.totalCrops : splitPoints.totalSplits;

  // The lowest-numbered page carrying cut lines is the source "Apply to all pages" replicates from
  // (numeric keys iterate ascending), so a single-page setup fans out to the whole document.
  const sourceCutPage = Object.entries(splitPoints.splitPoints).find(
    ([, splits]) => splits.length > 0,
  )?.[0];

  /** Drop the whole page selection (and its range anchor) — used after any edit that repaginates. */
  const clearSelection = useCallback((): void => {
    setSelectedPages(new Set());
    setAnchorPage(null);
  }, []);

  const setPanel = useCallback((width: number): void => {
    const clamped = Math.min(MAX_PANEL, Math.max(MIN_PANEL, width));
    panelWidthRef.current = clamped;
    setPanelWidth(clamped);
  }, []);

  // Drag the split: moving the handle left widens the right panel (the topic tree), shrinking the
  // preview so long topic names fit. The chosen width persists on release; double-click resets it.
  const onResizeStart = useCallback(
    (event: ReactMouseEvent): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidthRef.current;
      const move = (moveEvent: MouseEvent): void => {
        setPanel(startWidth - (moveEvent.clientX - startX));
      };
      const up = (): void => {
        writePanelWidth(panelWidthRef.current);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('is-col-resizing');
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      document.body.classList.add('is-col-resizing');
    },
    [setPanel],
  );

  const resetPanel = useCallback((): void => {
    setPanel(DEFAULT_PANEL);
    writePanelWidth(DEFAULT_PANEL);
  }, [setPanel]);

  /** Clear only the working-document scratch — never the tree (that decoupling is the whole point). */
  const resetDoc = useCallback((): void => {
    setPdfBytes(null);
    setFileName(null);
    setMergedSources([]);
    setLoadedFiles([]);
    setMergeExpanded(false);
    setDragIndex(null);
    setNumPages(0);
    clearSelection();
    setPageWidth(DEFAULT_WIDTH);
    splitPoints.reset();
    reflow.clear();
    workingDoc.clear();
  }, [splitPoints, reflow, workingDoc, clearSelection]);

  /**
   * Load the selected PDFs: a single file loads as-is; several concatenate (in selection order)
   * into one continuous document so cut/structure/upload work over the merged preview. The source
   * order and each file's page span are kept so the operator sees where each file starts.
   */
  /** Merge the given ordered files into one working document and record each file's page span. */
  const mergeInto = useCallback(
    async (files: LoadedPdf[]): Promise<void> => {
      const merged = await mergePdfs(files.map((file) => new Uint8Array(file.bytes)));
      setPdfBytes(merged.bytes);
      setFileName(`${String(files.length)} PDFs merged`);
      setMergedSources(
        merged.spans.map((span, index) => ({
          name: files[index]?.name ?? `PDF ${String(index + 1)}`,
          from: span.from,
          to: span.to,
        })),
      );
      workingDoc.reset(merged.bytes);
    },
    [workingDoc],
  );

  const loadFiles = useCallback(
    async (files: LoadedPdf[]): Promise<void> => {
      resetDoc();
      const first = files[0];
      if (!first) return;
      if (files.length === 1) {
        setPdfBytes(first.bytes);
        setFileName(first.name);
        workingDoc.reset(new Uint8Array(first.bytes));
        return;
      }
      setLoadedFiles(files);
      await mergeInto(files);
    },
    [resetDoc, workingDoc, mergeInto],
  );

  /**
   * Reorder the merged files (drag or keyboard) and re-merge in the new order so the preview follows.
   * Reordering repaginates the document, so the cut/reflow scratch is dropped (the tree is untouched).
   */
  const reorderFiles = useCallback(
    (from: number, to: number): void => {
      setDragIndex(null);
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= loadedFiles.length ||
        to >= loadedFiles.length
      )
        return;
      const next = [...loadedFiles];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      setLoadedFiles(next);
      splitPoints.reset();
      reflow.clear();
      clearSelection();
      void mergeInto(next);
    },
    [loadedFiles, mergeInto, splitPoints, reflow, clearSelection],
  );

  /** Materialize the mode's edits into a fresh version so modes chain. The tree is untouched. */
  const applyMode = async (): Promise<void> => {
    // None is a passive view mode — it never applies anything.
    if (!activeBytes || cutMode === 'none') return;
    setApplying(true);
    try {
      const next = isReflow
        ? await applyReflow(activeBytes, reflow.blocks, reflowFragmentFirst)
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
          const [lo, hi] =
            anchorPage <= pageNumber ? [anchorPage, pageNumber] : [pageNumber, anchorPage];
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

  /** Download the current working document (the latest applied version, else the loaded original). */
  const downloadWorking = useCallback((): void => {
    if (!activeBytes) return;
    const bytes = activeBytes instanceof Uint8Array ? activeBytes : new Uint8Array(activeBytes);
    const base = fileName?.trim() ? fileName.replace(/\.pdf$/i, '') : 'working';
    saveBlob(bytesToBlob(bytes), `${base}.pdf`);
  }, [activeBytes, fileName]);

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

  /**
   * Load an imported config: rebuild the tree, then re-bind its exported page assignments against
   * the current working document. Assignments that point past this PDF's last page are left empty
   * (the config came from a different or longer document) and reported, never bound wrong.
   */
  const onImportConfig = useCallback(
    (parsed: ParsedConfig): void => {
      const fresh = tree.loadConfig(parsed);
      const bindings = configPageBindings(parsed.nodes, fresh);
      const inRange = bindings.filter((binding) => binding.pages.every((page) => page <= numPages));
      for (const binding of inRange) onBindPages(binding.leafId, binding.kind, binding.pages);
      const skipped = bindings.length - inRange.length;
      if (skipped > 0) {
        toast({
          title: 'Structure imported, some pages skipped',
          description: `${String(skipped)} page binding${skipped === 1 ? '' : 's'} point past this ${String(numPages)}-page PDF and were left empty.`,
        });
      }
    },
    [tree, numPages, onBindPages, toast],
  );

  /**
   * AI-fill the PYQ paper-details form: render the working document's first page to a PNG, send it to
   * the vision endpoint, and merge the fields it read into the chapter metadata (only overwriting a
   * field the model actually filled, so an operator's manual edits to other fields survive). Best-
   * effort — a failed read toasts and leaves the form untouched.
   */
  const handleAiFillPaper = useCallback((): void => {
    if (!activeBytes || aiFillingPaper) return;
    setAiFillingPaper(true);
    void (async (): Promise<void> => {
      try {
        const png = await renderPageToPng(activeBytes, 1);
        const paper = await ingestionApi.extractPaperMetadata(png);
        const current = tree.tree.metadata.paper;
        const merged = { ...current };
        for (const key of Object.keys(paper) as (keyof typeof paper)[]) {
          if (paper[key].trim()) merged[key] = paper[key].trim();
        }
        tree.setMetadata({
          paper: merged,
          // The paper's exam name also fills the document's main exam (a PYQ paper files under it).
          ...(merged.pyqExamName.trim() ? { exam: merged.pyqExamName.trim() } : {}),
        });
        success(
          'Paper details filled',
          'Review the fields and correct anything the reader missed.',
        );
      } catch (err) {
        toastError('Couldn’t read the paper header', errorMessage(err));
      } finally {
        setAiFillingPaper(false);
      }
    })();
  }, [activeBytes, aiFillingPaper, tree, success, toastError]);

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
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) a.redo();
          else a.undo();
        } else if (key === 'a') {
          event.preventDefault();
          a.selectAll();
        } else if (key === 'enter' && a.canApply) {
          event.preventDefault();
          void a.applyMode();
        }
        return;
      }
      switch (key) {
        case 'n':
          event.preventDefault();
          a.setCutMode('none');
          break;
        case 'h':
          event.preventDefault();
          a.setCutMode('horizontal');
          break;
        case 'v':
          event.preventDefault();
          a.setCutMode('vertical');
          break;
        case 'r':
          event.preventDefault();
          a.setCutMode('reflow');
          break;
        case 'l':
          event.preventDefault();
          a.setView('list');
          break;
        case 'g':
          event.preventDefault();
          a.setView('grid');
          break;
        case 'escape':
          a.clearSelection();
          break;
        case 'delete':
        case 'backspace':
          if (a.hasSelection) {
            event.preventDefault();
            void a.handleDeleteSelected();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
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
    // One id per upload action, shared by this chapter's question/supporting parts — so they are
    // matched to each other during extraction, yet a fresh click (even of the same file) mints a new
    // id and becomes a distinct document. Kept out of the tree/exported config so it never leaks reuse.
    const uploadGroupId = crypto.randomUUID();
    // One unit for the whole chapter: question (primary, carries per-section topics) plus the
    // layout-specific supporting source(s). `combined` uploads one companion rather than separate
    // answer and solution documents; never one file per leaf.
    const parts: { kind: ChapterKind; bytes: Uint8Array; topics?: ChapterTopic[] }[] = [
      { kind: 'question', bytes: assembled.question.bytes, topics: assembled.question.topics },
      ...(assembled.answer ? [{ kind: 'answer' as const, bytes: assembled.answer }] : []),
      ...(assembled.solution ? [{ kind: 'solution' as const, bytes: assembled.solution }] : []),
      ...(assembled.companion ? [{ kind: 'companion' as const, bytes: assembled.companion }] : []),
    ];
    const lines: string[] = [];
    let failed = false;
    for (const part of parts) {
      const metadata: ChapterUploadMetadata = {
        ...assembled.base,
        sessionId,
        uploadGroupId,
        kind: part.kind,
        ...(part.topics ? { topics: part.topics } : {}),
      };
      setUploadProgress({ kind: part.kind, pct: 0 });
      try {
        const result = await upload.mutateAsync({
          pdfBytes: part.bytes,
          metadata,
          onProgress: (fraction) => {
            setUploadProgress({ kind: part.kind, pct: Math.round(fraction * 100) });
          },
        });
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
      success(
        'Uploaded to the session',
        `${String(parts.length)} file${parts.length === 1 ? '' : 's'} filed to Drive.`,
      );
    }
    setUploadProgress(null);
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
            onLoad={(files) => {
              void loadFiles(files);
            }}
            onClear={resetDoc}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="workspace">
      <div
        className="cutter-layout"
        style={{ '--cutter-panel-w': `${String(panelWidth)}px` } as CSSProperties}
      >
        <div className="cutter-layout__preview">
          <PdfModeSelector
            mode={cutMode}
            onModeChange={setCutMode}
            lineCount={pendingCount}
            onApply={() => {
              void applyMode();
            }}
            onResetLines={isReflow ? reflow.clear : splitPoints.clearAll}
            onNewBlock={reflow.newBlock}
            order={readingOrder}
            onOrderChange={setReadingOrder}
            onApplyToAllPages={() => {
              if (sourceCutPage !== undefined)
                splitPoints.applyToAllPages(Number(sourceCutPage), numPages);
            }}
            canApplyToAllPages={sourceCutPage !== undefined && numPages > 1}
            cutFragmentFirst={reflowFragmentFirst}
            onCutFragmentFirstChange={setReflowFragmentFirst}
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
            onZoomIn={() => {
              setPageWidth((w) => Math.min(MAX_WIDTH, w + ZOOM_STEP));
            }}
            onZoomOut={() => {
              setPageWidth((w) => Math.max(MIN_WIDTH, w - ZOOM_STEP));
            }}
            onZoomReset={() => {
              setPageWidth(DEFAULT_WIDTH);
            }}
            gridColumns={gridColumns}
            onGridColumnsChange={(columns) => {
              setGridColumns(Math.min(MAX_GRID_COLUMNS, Math.max(MIN_GRID_COLUMNS, columns)));
            }}
            cutCount={pendingCount}
            cutNoun={isReflow ? 'crops' : 'cuts'}
            numPages={numPages}
            onGoToPage={goToPage}
            selectedCount={selectedPages.size}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onDeleteSelected={() => {
              void handleDeleteSelected();
            }}
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
              onHoverSlice={() => {
                /* no per-slice tagging in the tree flow */
              }}
              onToggleTag={() => {
                /* tagging happens by dropping onto the tree */
              }}
              onNumPages={setNumPages}
              onDeletePage={(pageNumber) => {
                void handleDeletePage(pageNumber);
              }}
              taggable={false}
              bindable
              view={view}
              gridColumns={gridColumns}
              selectedPages={selectedPages}
              onToggleSelect={toggleSelect}
            />
          </div>
        </div>

        <div
          className="cutter-layout__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the preview and panel"
          title="Drag to resize · double-click to reset"
          onMouseDown={onResizeStart}
          onDoubleClick={resetPanel}
        >
          <span className="cutter-layout__grip" aria-hidden />
        </div>

        <aside className="cutter-layout__panel stack">
          <div className="panel-head">
            <SessionBar compact />
            <div className="panel-file">
              {mergedSources.length > 0 ? (
                <button
                  type="button"
                  className="panel-file__name panel-file__toggle"
                  aria-expanded={mergeExpanded}
                  onClick={() => {
                    setMergeExpanded((open) => !open);
                  }}
                  title="Show merged files — drag to reorder"
                >
                  <IconChevronDown
                    className={mergeExpanded ? 'panel-file__caret is-open' : 'panel-file__caret'}
                  />
                  <span className="truncate">{fileName}</span>
                </button>
              ) : (
                <span className="panel-file__name" title={fileName ?? undefined}>
                  {fileName ?? 'Loaded PDF'}
                </span>
              )}
              <span className="panel-file__meta">
                {numPages > 0 ? (
                  <span>
                    {numPages} page{numPages === 1 ? '' : 's'}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  onClick={downloadWorking}
                  title="Download the current working PDF"
                >
                  <IconDownload /> Download PDF
                </button>
                <button type="button" className="btn btn--ghost btn--xs" onClick={resetDoc}>
                  Change file
                </button>
              </span>
            </div>
          </div>

          {mergedSources.length > 0 && mergeExpanded ? (
            <ul className="merge-list" aria-label="Merged PDFs — drag to reorder">
              {mergedSources.map((source, index) => (
                <li
                  key={index}
                  className={
                    dragIndex === index ? 'merge-list__item is-dragging' : 'merge-list__item'
                  }
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null) reorderFiles(dragIndex, index);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                  }}
                >
                  <IconButton
                    className="merge-list__grip"
                    icon={<IconGripVertical />}
                    label={`Reorder ${source.name} — drag, or use the arrow keys`}
                    size="sm"
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        reorderFiles(index, index - 1);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        reorderFiles(index, index + 1);
                      }
                    }}
                  />
                  <span className="merge-list__pos" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="merge-list__name truncate" title={source.name}>
                    {source.name}
                  </span>
                  <span className="merge-list__span text-ink-2">
                    page
                    {source.from === source.to
                      ? ` ${String(source.from)}`
                      : `s ${String(source.from)}–${String(source.to)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {isReflow ? <ReflowBlocksPanel controller={reflow} /> : null}

          <StructureTreePanel
            controller={tree}
            vocabulary={vocabulary}
            onBindPages={onBindPages}
            bindingSlot={bindingSlot}
            maxPages={numPages}
            onImport={onImportConfig}
            onImportError={(message) => {
              toastError('Couldn’t import config', message);
            }}
            onAiFillPaper={handleAiFillPaper}
            aiFillingPaper={aiFillingPaper}
          />

          {uploadError ? <p className="error">{uploadError}</p> : null}

          {tree.hasNodes ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={uploading || !sessionId}
              onClick={() => {
                void handleUpload();
              }}
            >
              {uploading ? (
                <>
                  <Spinner /> Uploading…
                </>
              ) : (
                'Upload all units'
              )}
            </button>
          ) : null}

          {uploading && uploadProgress ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-[13px] font-medium">
                <span className="min-w-0 truncate text-ink">
                  Uploading {uploadProgress.kind} PDF…
                </span>
                <span className="flex-none text-ink-3">{uploadProgress.pct}%</span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuenow={uploadProgress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${String(uploadProgress.pct)}%` }}
                />
              </div>
            </div>
          ) : null}

          {!sessionId ? (
            <p className="muted">Select or create a session above before uploading.</p>
          ) : null}

          {results.length > 0 ? (
            <ul className="results">
              {results.map((line, index) => (
                <li key={index} className="note">
                  {line}
                </li>
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
                onClick={() => {
                  if (sessionId) void navigate(`/sessions/${sessionId}`);
                }}
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
