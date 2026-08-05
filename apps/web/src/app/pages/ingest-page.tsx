import { type JSX, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChapterKind, ChapterUploadMetadata } from '@ingest/contracts';
import {
  ChapterGroupingPanel,
  type ChapterGroup,
  ChapterMetadataForm,
  type CutMode,
  type ReadingOrder,
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
  chapterUnitKey,
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
import { PageHeader } from '../../shared/ui/index.js';

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const ZOOM_STEP = 80;

/** The two ways to bring PDFs in: three separate files (default) or one combined PDF to cut & tag. */
type UploadMode = 'separate' | 'cut';

/** Phase-1 has two steps: choose/collect files, then crop them, before pushing to extraction. */
type Phase = 'upload' | 'crop';

/** File-type tab label in the crop workspace (explanation is the `solution` kind). */
const KIND_TAB_LABEL: Record<ChapterKind, string> = {
  question: 'Question',
  answer: 'Answer',
  solution: 'Explanation',
};

/**
 * One PDF to crop then upload: a chapter's file of one kind. In the separate-files flow every
 * uploaded file becomes a crop item; the crop workspace edits `bytes` in place before finalizing.
 * `chapterId` ties the item back to its chapter, whose metadata is captured after the crop.
 */
type CropItem = {
  id: string;
  chapterId: string;
  chapterLabel: string;
  kind: ChapterKind;
  fileName: string;
  bytes: Uint8Array;
};

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
 * Phase 1: bring each chapter's question / answer / explanation PDFs in (as three separate files or
 * one combined PDF), crop them in the shared cut workspace, then push the results to extraction.
 */
export function IngestPage(): JSX.Element {
  const navigate = useNavigate();
  const [sessionId] = useCurrentSession();
  const [mode, setMode] = useState<UploadMode>('separate');
  const [phase, setPhase] = useState<Phase>('upload');
  const [didUpload, setDidUpload] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [groups, setGroups] = useState<ChapterGroup[]>([]);
  const [separateChapters, setSeparateChapters] = useState<SeparateChapter[]>([
    emptySeparateChapter(Math.random().toString(36).slice(2)),
  ]);
  const [cropItems, setCropItems] = useState<CropItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
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
  const inSeparateCrop = mode === 'separate' && phase === 'crop';
  const activeItem = cropItems.find((item) => item.id === activeItemId) ?? null;

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

  /** Reload the cut pipeline onto a specific crop item's current bytes (separate-files flow). */
  const loadItem = useCallback(
    (item: CropItem): void => {
      setActiveItemId(item.id);
      workingDoc.reset(new Uint8Array(item.bytes));
      splitPoints.reset();
      reflow.clear();
    },
    [workingDoc, splitPoints, reflow],
  );

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
      // In the separate-files flow the active file has no slice tags — persist its cropped bytes.
      if (inSeparateCrop && activeItemId) {
        setCropItems((prev) =>
          prev.map((item) => (item.id === activeItemId ? { ...item, bytes: next } : item)),
        );
      }
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
    // In the separate-files crop the active file has no slice tags — persist its cropped bytes.
    if (inSeparateCrop && activeItemId) {
      setCropItems((prev) =>
        prev.map((item) => (item.id === activeItemId ? { ...item, bytes: next } : item)),
      );
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
      done.push(`✓ ${metadata.kind} → ${result.driveFile.name} [${result.document.status}]`);
    } catch (error) {
      done.push(`✗ ${metadata.kind} failed: ${errorMessage(error)}`);
    }
    next[chapterId] = done.join(' · ');
    setResults({ ...next });
  };

  /**
   * Separate-files upload step: read every chapter's provided PDFs into crop items and move into the
   * crop phase. Each chapter's Question PDF is required; answer/explanation are optional. Chapter
   * metadata is captured later, in the crop workspace, exactly like the single-PDF flow.
   */
  const enterSeparateCrop = async (): Promise<void> => {
    setUploadError(null);
    for (const [index, chapter] of separateChapters.entries()) {
      if (!chapter.files.question) {
        setUploadError(`Chapter ${String(index + 1)}: a Question PDF is required.`);
        return;
      }
    }
    const items: CropItem[] = [];
    for (const [index, chapter] of separateChapters.entries()) {
      for (const slot of SEPARATE_FILE_SLOTS) {
        const file = chapter.files[slot.kind];
        if (!file) continue;
        items.push({
          id: `${chapter.id}:${slot.kind}`,
          chapterId: chapter.id,
          chapterLabel: `Chapter ${String(index + 1)}`,
          kind: slot.kind,
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
    setCropItems(items);
    setResults({});
    setDidUpload(false);
    const first = items[0];
    if (first) loadItem(first);
    setPhase('crop');
  };

  /**
   * Finalize the separate-files crop. Validate every chapter's metadata (captured in the aside), then
   * guarantee correct question-number mapping: each chapter must resolve to a distinct unit
   * `(module, chapter, section)`, because that unit is exactly what the extractor uses to bind a
   * chapter's answers/explanations to its own questions. Two chapters sharing a unit would let one
   * chapter's Q1 borrow another's — so we block that up front rather than upload a silent mistake.
   * Only after both checks pass does each chapter's cropped parts upload under its own metadata.
   */
  const finalizeSeparate = async (): Promise<void> => {
    if (!sessionId) return;

    for (const [index, chapter] of separateChapters.entries()) {
      const invalid = metadataError(chapter.metadata);
      if (invalid) {
        setUploadError(`Chapter ${String(index + 1)}: ${invalid.replace('⚠ ', '')} Fill in its details.`);
        return;
      }
    }

    // Distinct-unit guard: no two chapters may map to the same (module, chapter, section).
    const seen = new Map<string, number>();
    for (const [index, chapter] of separateChapters.entries()) {
      const key = chapterUnitKey(chapter.metadata);
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
    // Fold the active item's latest applied version back in before uploading.
    const items = cropItems.map((item) =>
      item.id === activeItemId && workingDoc.current ? { ...item, bytes: workingDoc.current } : item,
    );

    const metadataByChapter = new Map(separateChapters.map((chapter) => [chapter.id, chapter.metadata]));
    const byChapter = new Map<string, CropItem[]>();
    for (const item of items) {
      byChapter.set(item.chapterId, [...(byChapter.get(item.chapterId) ?? []), item]);
    }

    for (const [chapterId, chapterItems] of byChapter) {
      const metadata = metadataByChapter.get(chapterId);
      if (!metadata) continue;
      const base = baseMetadata(sessionId, metadata);
      const done: string[] = [];
      for (const item of chapterItems) {
        await uploadPart(chapterId, { ...base, kind: item.kind }, item.bytes, done, next);
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

  // File-type tabs (Question / Answer / Explanation) shown for the active chapter's uploaded parts.
  const activeChapterId = activeItem?.chapterId ?? null;
  const availableKinds = SEPARATE_FILE_SLOTS.map((slot) => slot.kind).filter((kind) =>
    cropItems.some((item) => item.kind === kind && item.chapterId === activeChapterId),
  );
  const activeKind = activeItem?.kind ?? availableKinds[0] ?? 'question';
  // The chapters available to switch between (one entry per chapter that produced crop items).
  const cropChapters = separateChapters
    .map((chapter, index) => ({ id: chapter.id, label: `Chapter ${String(index + 1)}` }))
    .filter((chapter) => cropItems.some((item) => item.chapterId === chapter.id));
  const activeSeparateChapter = separateChapters.find((chapter) => chapter.id === activeChapterId) ?? null;

  /** Switch to a file-type tab within the active chapter, loading that part into the cut pipeline. */
  const switchKind = (kind: ChapterKind): void => {
    const target = cropItems.find((item) => item.kind === kind && item.chapterId === activeChapterId);
    if (target) loadItem(target);
  };

  /** Switch chapters, keeping the same file-type tab when the target chapter has it (else its first). */
  const switchChapter = (chapterId: string): void => {
    const sameKind = cropItems.find((item) => item.chapterId === chapterId && item.kind === activeKind);
    const target = sameKind ?? cropItems.find((item) => item.chapterId === chapterId);
    if (target) loadItem(target);
  };

  /** Patch the active chapter's metadata (edited in the crop aside, after cropping). */
  const updateActiveMetadata = (patch: Partial<ChapterMetadataDraft>): void => {
    if (!activeChapterId) return;
    setSeparateChapters((prev) =>
      prev.map((chapter) =>
        chapter.id === activeChapterId
          ? { ...chapter, metadata: { ...chapter.metadata, ...patch } }
          : chapter,
      ),
    );
  };

  const resultChapters: { id: string; label: string }[] =
    mode === 'separate'
      ? separateChapters.map((chapter, index) => ({ id: chapter.id, label: `Chapter ${String(index + 1)}` }))
      : groups.map((group, index) => ({ id: group.id, label: `Chapter ${String(index + 1)}` }));

  const continueBar = didUpload ? (
    <div className="phase-actions">
      <span className="muted">Filed to the session.</span>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            reset();
            setPhase('upload');
            setCropItems([]);
            setSeparateChapters([emptySeparateChapter(Math.random().toString(36).slice(2))]);
            setUploadError(null);
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
    <section className="page">
      <PageHeader
        title="Cut & upload"
        subtitle="Bring in each chapter's question, answer, and explanation PDFs, crop them in the workspace, then push to extraction."
      />

      <SessionBar />

      <div className="card">
        {phase === 'upload' ? (
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
        ) : null}
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

      {/* Separate-files, step 1: collect each chapter's three PDFs (metadata comes after the crop). */}
      {mode === 'separate' && phase === 'upload' ? (
        <div className="card stack">
          <h2>Files</h2>
          <p className="muted">
            Add a chapter for each set of PDFs. You'll crop every file, then name each chapter before
            extraction — questions map to their own chapter's answers and explanations.
          </p>
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
            <p className="muted">Tip: select or create a session above before you finalize.</p>
          ) : null}
        </div>
      ) : null}

      {/* Separate-files, step 2: crop each file under its own tab, then finalize to extraction. */}
      {inSeparateCrop && activeItem ? (
        <div className="cutter-layout">
          <div className="cutter-layout__preview">
            <div className="folder-select__row" role="tablist" aria-label="File type">
              {cropChapters.length > 1 ? (
                <select
                  aria-label="Chapter"
                  value={activeChapterId ?? ''}
                  onChange={(event) => { switchChapter(event.target.value); }}
                >
                  {cropChapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {availableKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={activeKind === kind}
                  className={`btn ${activeKind === kind ? 'btn--primary' : ''}`}
                  onClick={() => { switchKind(kind); }}
                >
                  {KIND_TAB_LABEL[kind]}
                </button>
              ))}
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {activeItem.chapterLabel} · {KIND_TAB_LABEL[activeItem.kind]} · {activeItem.fileName}
              </span>
            </div>

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
                  key={activeItem.id}
                  pdfBytes={activeBytes}
                  mode={cutMode}
                  order={readingOrder}
                  controller={splitPoints}
                  reflow={reflow}
                  groups={[]}
                  taggable={false}
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

            {activeSeparateChapter ? (
              <div className="chapter-card">
                <div className="chapter-card__head">
                  <span className="chip chip--chapter">{activeItem.chapterLabel}</span>
                </div>
                <p className="muted">
                  Crop each file under its tab, then name this chapter to file it.
                  {cropChapters.length > 1 ? ' Switch chapters with the selector above the preview.' : ''}
                </p>
                <ChapterMetadataForm
                  value={activeSeparateChapter.metadata}
                  onChange={updateActiveMetadata}
                />
              </div>
            ) : null}

            <h2>Finalize</h2>
            {uploadError ? <p className="error">{uploadError}</p> : null}
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={uploading || !sessionId}
              onClick={() => { void finalizeSeparate(); }}
            >
              {uploading ? 'Uploading…' : 'Finalize & push to extraction'}
            </button>
            <button
              type="button"
              className="btn btn--block"
              disabled={uploading}
              onClick={() => { setPhase('upload'); setUploadError(null); }}
            >
              ← Back to files
            </button>

            {resultsList}
            {continueBar}
          </aside>
        </div>
      ) : null}

      {/* Single combined PDF: cut & tag slices as question / answer / solution, then upload. */}
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
