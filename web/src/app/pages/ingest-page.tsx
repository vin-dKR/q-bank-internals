import { type JSX, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChapterKind, ChapterUploadMetadata } from '@ingest/contracts';
import {
  ChapterGroupingPanel,
  type ChapterGroup,
  type CutMode,
  type PageKinds,
  type ReadingOrder,
  PdfModeSelector,
  PdfPreviewer,
  PdfToolbar,
  PdfUploader,
  ReflowBlocksPanel,
  type SeparateChapter,
  SeparateFilesPanel,
  aggregateSeparateChapters,
  applyGridSplit,
  applyReflow,
  buildChapterPdfs,
  deletePage,
  emptySeparateChapter,
  useReflowBlocks,
  useSplitPoints,
  useWorkingDocument,
  useUploadChapter,
} from '../../features/ingestion/index.js';
import type { ChapterMetadataDraft } from '../../features/ingestion/types/chapter-group.js';
import { SessionBar } from '../../features/sessions/index.js';
import { useCurrentSession } from '../../shared/lib/current-session.js';
import { PageHeader, Spinner } from '../../shared/ui/index.js';

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const ZOOM_STEP = 80;

/** The two ways to bring PDFs in: three separate files (default) or one combined PDF to cut & tag. */
type UploadMode = 'separate' | 'cut';

/** Separate-files has two steps: collect the PDFs, then crop the aggregated PDF. Cut mode is single-step. */
type Phase = 'upload' | 'crop';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Validate a chapter's metadata; returns a user-facing reason string when incomplete, else null. */
function metadataError(meta: ChapterMetadataDraft): string | null {
  if (
    !meta.exam ||
    !meta.module ||
    !meta.subject.trim() ||
    !meta.chapter.trim() ||
    !meta.sectionName.trim() ||
    !meta.questionType.trim()
  ) {
    return 'Missing metadata — skipped.';
  }
  return null;
}

/** The shared metadata (everything but `kind`) that files every part of a chapter under one unit. */
function baseMetadata(sessionId: string, meta: ChapterMetadataDraft): Omit<ChapterUploadMetadata, 'kind'> {
  return {
    sessionId,
    exam: meta.exam as ChapterUploadMetadata['exam'],
    subject: meta.subject.trim(),
    module: meta.module as ChapterUploadMetadata['module'],
    chapter: meta.chapter.trim(),
    sectionName: meta.sectionName.trim(),
    questionType: meta.questionType.trim(),
  };
}

/**
 * The normalized unit key `(module | chapter | section)`. Two chapters that share it would let the
 * extractor bind one chapter's answers to another's questions (both are the "same unit"), so upload
 * blocks on a collision.
 */
function unitKey(meta: ChapterMetadataDraft): string {
  const norm = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return [norm(meta.module), norm(meta.chapter), norm(meta.sectionName)].join(' | ');
}

/**
 * Phase 1: bring each chapter's question / answer / explanation PDFs in — either as one combined PDF
 * (cut & tag), or as three separate files that are concatenated into one aggregated PDF and then cut &
 * tagged the same way. Slices are tagged question / answer / solution, grouped into chapters, and each
 * chapter's parts are uploaded under its own metadata so extraction maps answers to their questions.
 */
export function IngestPage(): JSX.Element {
  const navigate = useNavigate();
  const [sessionId] = useCurrentSession();
  const [mode, setMode] = useState<UploadMode>('separate');
  const [phase, setPhase] = useState<Phase>('upload');
  const [didUpload, setDidUpload] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [groups, setGroups] = useState<ChapterGroup[]>([]);
  // Page → source kind for the aggregated separate-files PDF; empty in cut mode. Untagged slices on
  // an answer/explanation page default to that kind (see build-chapter-pdfs `sliceKind`).
  const [pageKinds, setPageKinds] = useState<PageKinds>({});
  const [separateChapters, setSeparateChapters] = useState<SeparateChapter[]>([
    emptySeparateChapter(Math.random().toString(36).slice(2)),
  ]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [hoveredSliceId, setHoveredSliceId] = useState<string | null>(null);
  const [cutMode, setCutMode] = useState<CutMode>('horizontal');
  const [readingOrder, setReadingOrder] = useState<ReadingOrder>('column');
  const [applying, setApplying] = useState(false);

  const splitPoints = useSplitPoints();
  const reflow = useReflowBlocks();
  const workingDoc = useWorkingDocument();
  const upload = useUploadChapter();
  const { undo, redo } = splitPoints;

  const isReflow = cutMode === 'reflow';
  // The cut & tag workspace is shared: cut mode shows it once a PDF is loaded; separate mode shows it
  // in the crop phase (on the aggregated PDF).
  const showCropWorkspace = mode === 'cut' ? pdfBytes !== null : phase === 'crop';

  // The PDF the cutter is working on: the latest applied version, falling back to the source bytes.
  const activeBytes: ArrayBuffer | Uint8Array | null = workingDoc.current ?? pdfBytes;
  // The mode's pending edits: reflow crops vs grid cut lines.
  const pendingCount = isReflow ? reflow.totalCrops : splitPoints.totalSplits;

  const reset = (): void => {
    setPdfBytes(null);
    setFileName(null);
    setNumPages(0);
    setGroups([]);
    setPageKinds({});
    setResults({});
    setPageWidth(DEFAULT_WIDTH);
    splitPoints.reset();
    reflow.clear();
    workingDoc.clear();
  };

  /**
   * Materialise the current mode's edits into a fresh PDF version so modes can be chained. Because the
   * page identity changes, chapters and source-page defaults are dropped — they are re-defined on the
   * new pages (the split-point path used by upload never needs an apply, so pre-tags survive there).
   */
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
      setGroups([]);
      setPageKinds({});
    } finally {
      setApplying(false);
    }
  };

  /**
   * Drop a page from the working document as its own pipeline version. Solves the empty page a
   * reflow merge leaves behind, and (after a grid cut turns each slice into its own page) doubles
   * as slice deletion. Revert restores it since it just pushes another version on the stack.
   */
  const handleDeletePage = async (pageNumber: number): Promise<void> => {
    if (!activeBytes) return;
    const next = await deletePage(activeBytes, pageNumber);
    workingDoc.apply(next, `delete page ${String(pageNumber)}`);
    splitPoints.reset();
    reflow.clear();
    setGroups([]);
    setPageKinds({});
  };

  // Cycle a slice's tag question → answer → solution → question (the on-page click-through). The
  // starting point is the slice's current effective kind: an explicit tag, else its source-page default.
  const toggleTag = useCallback((chapterId: string, sliceId: string): void => {
    const nextKind: Record<ChapterKind, ChapterKind> = {
      question: 'answer',
      answer: 'solution',
      solution: 'question',
    };
    const page = Number(sliceId.split(':')[0]);
    setGroups((prev) =>
      prev.map((group) => {
        if (group.id !== chapterId) return group;
        const current: ChapterKind = group.tags[sliceId] ?? pageKinds[page] ?? 'question';
        return { ...group, tags: { ...group.tags, [sliceId]: nextKind[current] } };
      }),
    );
  }, [pageKinds]);

  // Undo / redo keyboard shortcuts, ignored while typing in a field.
  useEffect(() => {
    if (!activeBytes) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [activeBytes, undo, redo]);

  /** Upload one already-built PDF part, recording a per-chapter status line. */
  const uploadPart = async (
    chapterId: string,
    metadata: ChapterUploadMetadata,
    bytes: Uint8Array,
    done: string[],
    next: Record<string, string>,
  ): Promise<void> => {
    try {
      const result = await upload.mutateAsync({ pdfBytes: bytes, metadata });
      setDidUpload(true);
      done.push(`${metadata.kind} → ${result.driveFile.name} [${result.document.status}]`);
    } catch (error) {
      done.push(`${metadata.kind} failed: ${errorMessage(error)}`);
    }
    next[chapterId] = done.join(' · ');
    setResults({ ...next });
  };

  /**
   * Separate-files step 1 → crop: require every chapter's Question PDF, concatenate each chapter's
   * question → answer → explanation pages into one aggregated PDF, and hand that (with pre-ranged
   * chapters and per-page source kinds) to the shared cut & tag workspace.
   */
  const enterSeparateCrop = async (): Promise<void> => {
    setUploadError(null);
    for (const [index, chapter] of separateChapters.entries()) {
      if (!chapter.files.question) {
        setUploadError(`Chapter ${String(index + 1)}: a Question PDF is required.`);
        return;
      }
    }
    const { bytes, groups: preGroups, pageKinds: kinds } =
      await aggregateSeparateChapters(separateChapters);
    reset();
    setPdfBytes(bytes);
    workingDoc.reset(bytes);
    setGroups(preGroups);
    setPageKinds(kinds);
    setResults({});
    setDidUpload(false);
    setPhase('crop');
  };

  /**
   * Cut & upload: for each chapter, build its question/answer/solution PDFs from the tagged slices and
   * upload each part under the chapter's metadata. Shared by both modes. A distinct-unit guard blocks
   * two chapters that resolve to the same (module, chapter, section) so answers can't cross-map.
   */
  const handleUploadCut = async (): Promise<void> => {
    const source = workingDoc.current ?? pdfBytes;
    if (!source || !sessionId) return;

    // Distinct-unit guard over chapters with complete metadata (incomplete ones are skipped below).
    const seen = new Map<string, number>();
    for (const [index, group] of groups.entries()) {
      if (metadataError(group.metadata)) continue;
      const key = unitKey(group.metadata);
      const prior = seen.get(key);
      if (prior !== undefined) {
        setUploadError(
          `Chapters ${String(prior + 1)} and ${String(index + 1)} have the same module · chapter · section — ` +
            'give each a distinct chapter or section name so their questions map correctly.',
        );
        return;
      }
      seen.set(key, index);
    }
    setUploadError(null);
    setUploading(true);
    const next: Record<string, string> = {};

    for (const group of groups) {
      const invalid = metadataError(group.metadata);
      if (invalid) {
        next[group.id] = invalid;
        setResults({ ...next });
        continue;
      }

      let built: Awaited<ReturnType<typeof buildChapterPdfs>>;
      try {
        built = await buildChapterPdfs({
          pdfBytes: source,
          range: { from: group.from, to: group.to },
          splitPoints: splitPoints.splitPoints,
          tags: group.tags,
          pageKinds,
        });
      } catch (error) {
        next[group.id] = `Cut failed: ${errorMessage(error)}`;
        setResults({ ...next });
        continue;
      }

      const base = baseMetadata(sessionId, group.metadata);
      const parts: { kind: ChapterKind; bytes: Uint8Array | null }[] = [
        { kind: 'question', bytes: built.question },
        { kind: 'answer', bytes: built.answer },
        { kind: 'solution', bytes: built.solution },
      ];

      const done: string[] = [];
      for (const part of parts) {
        if (!part.bytes) continue;
        await uploadPart(group.id, { ...base, kind: part.kind }, part.bytes, done, next);
      }
      if (done.length === 0) {
        next[group.id] = 'No slices to upload.';
        setResults({ ...next });
      }
    }

    setUploading(false);
  };

  const resultChapters = groups.map((group, index) => ({
    id: group.id,
    label: group.metadata.chapter.trim() || `Chapter ${String(index + 1)}`,
  }));

  /** Reset back to a fresh empty separate-files upload (used by "Save & add more"). */
  const startFreshSeparate = (): void => {
    reset();
    setPhase('upload');
    setSeparateChapters([emptySeparateChapter(Math.random().toString(36).slice(2))]);
    setUploadError(null);
  };

  const continueBar = didUpload ? (
    <div className="phase-actions">
      <span className="muted">Filed to the session.</span>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (mode === 'separate') startFreshSeparate();
            else reset();
          }}
        >
          Save &amp; add more
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!sessionId}
          onClick={() => { if (sessionId) void navigate(`/sessions/${sessionId}`); }}
        >
          Continue to extraction →
        </button>
      </div>
    </div>
  ) : null;

  const resultsList =
    Object.keys(results).length > 0 ? (
      <ul className="results">
        {resultChapters.map((chapter) =>
          results[chapter.id] ? (
            <li key={chapter.id} className="note">
              <strong>{chapter.label}:</strong> {results[chapter.id]}
            </li>
          ) : null,
        )}
      </ul>
    ) : null;

  return (
    <section className={showCropWorkspace ? 'workspace' : 'page'}>
      {!showCropWorkspace ? (
        <>
          <PageHeader
            title="Cut & upload"
            subtitle="Bring in each chapter's question, answer, and explanation PDFs, cut & tag them in the workspace, then push to extraction."
          />

          <SessionBar />

          {/* One card: choose how PDFs come in, then that mode's intake sits directly below the switch. */}
          {phase === 'upload' ? (
            <div className="card stack">
              <div className="segmented self-start" role="tablist" aria-label="Upload mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'separate'}
                  className={`segmented__item ${mode === 'separate' ? 'is-active' : ''}`}
                  onClick={() => { setMode('separate'); }}
                >
                  Separate files
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'cut'}
                  className={`segmented__item ${mode === 'cut' ? 'is-active' : ''}`}
                  onClick={() => { setMode('cut'); }}
                >
                  Single PDF (cut &amp; tag)
                </button>
              </div>

              {mode === 'cut' ? (
                <PdfUploader
                  fileName={fileName}
                  onLoad={(bytes, name) => {
                    reset();
                    setPdfBytes(bytes);
                    setFileName(name);
                    workingDoc.reset(new Uint8Array(bytes));
                  }}
                  onClear={reset}
                />
              ) : (
                <>
                  <div className="stack--tight">
                    <h2>Files</h2>
                    <p className="muted">
                      Add a chapter for each set of PDFs. On continue they’re merged into one PDF (each
                      chapter’s question → answer → explanation) that you cut &amp; tag like a single PDF —
                      answer and explanation pages start pre-tagged.
                    </p>
                  </div>
                  <SeparateFilesPanel chapters={separateChapters} onChange={setSeparateChapters} />
                  {uploadError ? <p className="error">{uploadError}</p> : null}
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    disabled={separateChapters.some((chapter) => !chapter.files.question)}
                    onClick={() => { void enterSeparateCrop(); }}
                  >
                    Continue to crop →
                  </button>
                  {!sessionId ? (
                    <p className="muted">Tip: select or create a session above before you upload.</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {/* Shared cut & tag workspace: slim top bar reclaims the vertical space for the PDF + tools. */}
      {showCropWorkspace ? (
        <>
          <div className="ws-bar">
            <SessionBar compact />
            <span className="ws-bar__divider" />
            {mode === 'cut' ? (
              <div className="ws-file">
                <span className="ws-file__name" title={fileName ?? undefined}>
                  {fileName ?? 'Loaded PDF'}
                </span>
                <button type="button" className="btn btn--ghost btn--xs" onClick={reset}>
                  Change file
                </button>
              </div>
            ) : (
              <div className="ws-file">
                <span className="ws-file__name">
                  {separateChapters.length} chapter set{separateChapters.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  disabled={uploading}
                  onClick={() => { setPhase('upload'); setUploadError(null); }}
                >
                  ← Back to files
                </button>
              </div>
            )}
          </div>

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
            <PdfToolbar
              controller={splitPoints}
              zoomPercent={Math.round((pageWidth / DEFAULT_WIDTH) * 100)}
              onZoomIn={() => { setPageWidth((w) => Math.min(MAX_WIDTH, w + ZOOM_STEP)); }}
              onZoomOut={() => { setPageWidth((w) => Math.max(MIN_WIDTH, w - ZOOM_STEP)); }}
              onZoomReset={() => { setPageWidth(DEFAULT_WIDTH); }}
            />
            <div className="cutter-layout__scroll">
              {activeBytes ? (
                <PdfPreviewer
                  pdfBytes={activeBytes}
                  mode={cutMode}
                  order={readingOrder}
                  controller={splitPoints}
                  reflow={reflow}
                  groups={groups}
                  pageKinds={pageKinds}
                  pageWidth={pageWidth}
                  hoveredSliceId={hoveredSliceId}
                  onHoverSlice={setHoveredSliceId}
                  onToggleTag={toggleTag}
                  onNumPages={setNumPages}
                  onDeletePage={(pageNumber) => { void handleDeletePage(pageNumber); }}
                />
              ) : null}
            </div>
          </div>

          <aside className="cutter-layout__panel stack">
            {isReflow ? <ReflowBlocksPanel controller={reflow} /> : null}

            <h2>Chapters</h2>
            <ChapterGroupingPanel
              groups={groups}
              onChange={setGroups}
              numPages={numPages}
              splitPoints={splitPoints.splitPoints}
              pageKinds={pageKinds}
              hoveredSliceId={hoveredSliceId}
              onHoverSlice={setHoveredSliceId}
            />

            {uploadError ? <p className="error">{uploadError}</p> : null}

            {groups.length > 0 ? (
              <>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  disabled={uploading || !sessionId}
                  onClick={() => { void handleUploadCut(); }}
                >
                  {uploading ? <><Spinner /> Uploading…</> : 'Cut & upload all'}
                </button>
                {!sessionId ? (
                  <p className="muted">Select or create a session above before uploading.</p>
                ) : null}
              </>
            ) : null}

            {resultsList}
            {continueBar}
          </aside>
          </div>
        </>
      ) : null}
    </section>
  );
}
