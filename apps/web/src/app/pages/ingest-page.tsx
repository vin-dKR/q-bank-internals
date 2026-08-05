import { type JSX, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChapterKind, ChapterUploadMetadata } from '@ingest/contracts';
import {
  ChapterGroupingPanel,
  type ChapterGroup,
  type CutMode,
  type ReadingOrder,
  DrivePathExplorer,
  PdfModeSelector,
  PdfPreviewer,
  PdfToolbar,
  PdfUploader,
  ReflowBlocksPanel,
  type SeparateChapter,
  SEPARATE_FILE_SLOTS,
  SeparateFilesPanel,
  applyGridSplit,
  applyReflow,
  buildChapterPdfs,
  emptySeparateChapter,
  useReflowBlocks,
  useSplitPoints,
  useWorkingDocument,
  useUploadChapter,
} from '../../features/ingestion/index.js';
import type { ChapterMetadataDraft } from '../../features/ingestion/types/chapter-group.js';
import { SessionBar } from '../../features/sessions/index.js';
import { useCurrentSession } from '../../shared/lib/current-session.js';
import { PageHeader } from '../../shared/ui/index.js';

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const ZOOM_STEP = 80;

/** The two ways to bring PDFs in: three separate files (default) or one combined PDF to cut & tag. */
type UploadMode = 'separate' | 'cut';

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
    return '⚠ Missing metadata — skipped.';
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
 * Phase 1: file each chapter's question / answer / explanation PDFs into its Drive folder
 * (exam → subject → module → chapter) under the active session. Two modes: upload three separate
 * PDFs per chapter (default), or upload one combined PDF and cut/tag its slices by kind.
 */
export function IngestPage(): JSX.Element {
  const navigate = useNavigate();
  const [sessionId] = useCurrentSession();
  const [mode, setMode] = useState<UploadMode>('separate');
  const [didUpload, setDidUpload] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [groups, setGroups] = useState<ChapterGroup[]>([]);
  const [separateChapters, setSeparateChapters] = useState<SeparateChapter[]>([
    emptySeparateChapter(Math.random().toString(36).slice(2)),
  ]);
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

  // The PDF the cutter is working on: the latest applied version, falling back to the source bytes.
  const activeBytes: ArrayBuffer | Uint8Array | null = workingDoc.current ?? pdfBytes;
  // The mode's pending edits: reflow crops vs grid cut lines.
  const pendingCount = isReflow ? reflow.totalCrops : splitPoints.totalSplits;

  const reset = (): void => {
    setPdfBytes(null);
    setFileName(null);
    setNumPages(0);
    setGroups([]);
    setResults({});
    setPageWidth(DEFAULT_WIDTH);
    splitPoints.reset();
    reflow.clear();
    workingDoc.clear();
  };

  /** Materialise the current mode's edits into a fresh PDF version so modes can be chained. */
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
    } finally {
      setApplying(false);
    }
  };

  // Cycle a slice's tag question → answer → solution → question (the on-page click-through).
  const toggleTag = useCallback((chapterId: string, sliceId: string): void => {
    const nextKind: Record<ChapterKind, ChapterKind> = {
      question: 'answer',
      answer: 'solution',
      solution: 'question',
    };
    setGroups((prev) =>
      prev.map((group) => {
        if (group.id !== chapterId) return group;
        const current: ChapterKind = group.tags[sliceId] ?? 'question';
        return { ...group, tags: { ...group.tags, [sliceId]: nextKind[current] } };
      }),
    );
  }, []);

  // Undo / redo keyboard shortcuts, ignored while typing in a field.
  useEffect(() => {
    if (!pdfBytes) return;
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
  }, [pdfBytes, undo, redo]);

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
      done.push(`✓ ${metadata.kind} → ${result.driveFile.name} [${result.document.status}]`);
    } catch (error) {
      done.push(`✗ ${metadata.kind} failed: ${errorMessage(error)}`);
    }
    next[chapterId] = done.join(' · ');
    setResults({ ...next });
  };

  /** Default mode: upload each chapter's three separate PDFs (question required, others optional). */
  const handleUploadSeparate = async (): Promise<void> => {
    if (!sessionId) return;
    setUploading(true);
    const next: Record<string, string> = {};

    for (const chapter of separateChapters) {
      const invalid = metadataError(chapter.metadata);
      if (invalid) {
        next[chapter.id] = invalid;
        setResults({ ...next });
        continue;
      }
      if (!chapter.files.question) {
        next[chapter.id] = '⚠ Question PDF is required — skipped.';
        setResults({ ...next });
        continue;
      }

      const base = baseMetadata(sessionId, chapter.metadata);
      const done: string[] = [];
      for (const slot of SEPARATE_FILE_SLOTS) {
        const file = chapter.files[slot.kind];
        if (!file) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await uploadPart(chapter.id, { ...base, kind: slot.kind }, bytes, done, next);
      }
    }

    setUploading(false);
  };

  /** Combined-PDF mode: cut each chapter into question/answer/solution parts and upload each. */
  const handleUploadCut = async (): Promise<void> => {
    const source = workingDoc.current ?? pdfBytes;
    if (!source || !sessionId) return;
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
        });
      } catch (error) {
        next[group.id] = `✗ Cut failed: ${errorMessage(error)}`;
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

  const resultChapters: { id: string; label: string }[] =
    mode === 'separate'
      ? separateChapters.map((chapter, index) => ({ id: chapter.id, label: `Chapter ${String(index + 1)}` }))
      : groups.map((group, index) => ({ id: group.id, label: `Chapter ${String(index + 1)}` }));

  const continueBar = didUpload ? (
    <div className="phase-actions">
      <span className="muted">Filed to the session.</span>
      <div className="row">
        <button type="button" className="btn" onClick={reset}>
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
    <section className="page">
      <PageHeader
        title="Cut & upload"
        subtitle="File each chapter's question, answer, and explanation PDFs into its session and Drive folder — as three separate files, or by cutting one combined PDF."
      />

      <SessionBar />

      <div className="card">
        <DrivePathExplorer />
        <div className="folder-select__row" role="tablist" aria-label="Upload mode">
          <button
            type="button"
            className={`btn ${mode === 'separate' ? 'btn--primary' : ''}`}
            onClick={() => { setMode('separate'); }}
          >
            Separate files
          </button>
          <button
            type="button"
            className={`btn ${mode === 'cut' ? 'btn--primary' : ''}`}
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
        ) : null}
      </div>

      {mode === 'separate' ? (
        <div className="card stack">
          <h2>Chapters</h2>
          <SeparateFilesPanel chapters={separateChapters} onChange={setSeparateChapters} />
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={uploading || !sessionId}
            onClick={() => { void handleUploadSeparate(); }}
          >
            {uploading ? 'Uploading…' : 'Upload all'}
          </button>
          {!sessionId ? (
            <p className="muted">Select or create a session above before uploading.</p>
          ) : null}
          {resultsList}
          {continueBar}
        </div>
      ) : null}

      {mode === 'cut' && pdfBytes ? (
        <div className="cutter-layout">
          <div className="cutter-layout__preview">
            <PdfToolbar
              controller={splitPoints}
              zoomPercent={Math.round((pageWidth / DEFAULT_WIDTH) * 100)}
              onZoomIn={() => { setPageWidth((w) => Math.min(MAX_WIDTH, w + ZOOM_STEP)); }}
              onZoomOut={() => { setPageWidth((w) => Math.max(MIN_WIDTH, w - ZOOM_STEP)); }}
              onZoomReset={() => { setPageWidth(DEFAULT_WIDTH); }}
            />
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
            <div className="cutter-layout__scroll">
              {activeBytes ? (
                <PdfPreviewer
                  pdfBytes={activeBytes}
                  mode={cutMode}
                  order={readingOrder}
                  controller={splitPoints}
                  reflow={reflow}
                  groups={groups}
                  pageWidth={pageWidth}
                  hoveredSliceId={hoveredSliceId}
                  onHoverSlice={setHoveredSliceId}
                  onToggleTag={toggleTag}
                  onNumPages={setNumPages}
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
              hoveredSliceId={hoveredSliceId}
              onHoverSlice={setHoveredSliceId}
            />

            {groups.length > 0 ? (
              <>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  disabled={uploading || !sessionId}
                  onClick={() => { void handleUploadCut(); }}
                >
                  {uploading ? 'Uploading…' : 'Cut & Upload all'}
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
      ) : null}
    </section>
  );
}
