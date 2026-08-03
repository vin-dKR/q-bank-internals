import { type JSX, useCallback, useEffect, useState } from 'react';
import type { ChapterKind, ChapterUploadMetadata } from '@ingest/contracts';
import {
  ChapterGroupingPanel,
  type ChapterGroup,
  DrivePathExplorer,
  PdfPreviewer,
  PdfToolbar,
  PdfUploader,
  buildChapterPdfs,
  useSplitPoints,
  useUploadChapter,
} from '../../features/ingestion/index.js';
import { SessionPicker } from '../../features/sessions/index.js';
import { PageHeader } from '../../shared/ui/index.js';

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const ZOOM_STEP = 80;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Phase 1: upload a multi-chapter PDF, cut pages, tag slices as question/answer, and file each
 * chapter's question.pdf + answer.pdf into its Drive folder (exam → subject → module → chapter).
 */
export function IngestPage(): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [groups, setGroups] = useState<ChapterGroup[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [pageWidth, setPageWidth] = useState(DEFAULT_WIDTH);
  const [hoveredSliceId, setHoveredSliceId] = useState<string | null>(null);

  const splitPoints = useSplitPoints();
  const upload = useUploadChapter();
  const { undo, redo } = splitPoints;

  const reset = (): void => {
    setPdfBytes(null);
    setFileName(null);
    setNumPages(0);
    setGroups([]);
    setResults({});
    setPageWidth(DEFAULT_WIDTH);
    splitPoints.reset();
  };

  const toggleTag = useCallback((chapterId: string, sliceId: string): void => {
    setGroups((prev) =>
      prev.map((group) => {
        if (group.id !== chapterId) return group;
        const current: ChapterKind = group.tags[sliceId] ?? 'question';
        const next: ChapterKind = current === 'question' ? 'answer' : 'question';
        return { ...group, tags: { ...group.tags, [sliceId]: next } };
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

  const handleUploadAll = async (): Promise<void> => {
    if (!pdfBytes || !sessionId) return;
    setUploading(true);
    const next: Record<string, string> = {};

    for (const group of groups) {
      const meta = group.metadata;
      if (
        !meta.exam ||
        !meta.module ||
        !meta.subject.trim() ||
        !meta.chapter.trim() ||
        !meta.sectionName.trim() ||
        !meta.questionType.trim()
      ) {
        next[group.id] = '⚠ Missing metadata — skipped.';
        setResults({ ...next });
        continue;
      }

      let built: Awaited<ReturnType<typeof buildChapterPdfs>>;
      try {
        built = await buildChapterPdfs({
          pdfBytes,
          range: { from: group.from, to: group.to },
          splitPoints: splitPoints.splitPoints,
          tags: group.tags,
        });
      } catch (error) {
        next[group.id] = `✗ Cut failed: ${errorMessage(error)}`;
        setResults({ ...next });
        continue;
      }

      const base: Omit<ChapterUploadMetadata, 'kind'> = {
        sessionId,
        exam: meta.exam,
        subject: meta.subject.trim(),
        module: meta.module,
        chapter: meta.chapter.trim(),
        sectionName: meta.sectionName.trim(),
        questionType: meta.questionType.trim(),
      };

      const parts: { kind: ChapterKind; bytes: Uint8Array | null }[] = [
        { kind: 'question', bytes: built.question },
        { kind: 'answer', bytes: built.answer },
      ];

      const done: string[] = [];
      for (const part of parts) {
        if (!part.bytes) continue;
        try {
          const result = await upload.mutateAsync({
            pdfBytes: part.bytes,
            metadata: { ...base, kind: part.kind },
          });
          done.push(`✓ ${part.kind} → ${result.driveFile.name} [${result.document.status}]`);
        } catch (error) {
          done.push(`✗ ${part.kind} failed: ${errorMessage(error)}`);
        }
        next[group.id] = done.join(' · ');
        setResults({ ...next });
      }
      if (done.length === 0) {
        next[group.id] = 'No slices to upload.';
        setResults({ ...next });
      }
    }

    setUploading(false);
  };

  return (
    <section className="page">
      <PageHeader
        title="Cut & upload"
        subtitle="Upload a multi-chapter PDF, cut pages, tag slices as question or answer, then file each chapter into its session and Drive folder."
      />

      <div className="card">
        <SessionPicker value={sessionId} onChange={setSessionId} />
        <DrivePathExplorer />
        <PdfUploader
          fileName={fileName}
          onLoad={(bytes, name) => {
            reset();
            setPdfBytes(bytes);
            setFileName(name);
          }}
          onClear={reset}
        />
      </div>

      {pdfBytes ? (
        <div className="cutter-layout">
          <div className="cutter-layout__preview">
            <PdfToolbar
              controller={splitPoints}
              zoomPercent={Math.round((pageWidth / DEFAULT_WIDTH) * 100)}
              onZoomIn={() => { setPageWidth((w) => Math.min(MAX_WIDTH, w + ZOOM_STEP)); }}
              onZoomOut={() => { setPageWidth((w) => Math.max(MIN_WIDTH, w - ZOOM_STEP)); }}
              onZoomReset={() => { setPageWidth(DEFAULT_WIDTH); }}
            />
            <div className="cutter-layout__scroll">
              <PdfPreviewer
                pdfBytes={pdfBytes}
                controller={splitPoints}
                groups={groups}
                pageWidth={pageWidth}
                hoveredSliceId={hoveredSliceId}
                onHoverSlice={setHoveredSliceId}
                onToggleTag={toggleTag}
                onNumPages={setNumPages}
              />
            </div>
          </div>

          <aside className="cutter-layout__panel stack">
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
                  onClick={() => { void handleUploadAll(); }}
                >
                  {uploading ? 'Uploading…' : 'Cut & Upload all'}
                </button>
                {!sessionId ? (
                  <p className="muted">Select or create a session above before uploading.</p>
                ) : null}
              </>
            ) : null}

            {Object.keys(results).length > 0 ? (
              <ul className="results">
                {groups.map((group, index) =>
                  results[group.id] ? (
                    <li key={group.id} className="note">
                      <strong>Chapter {index + 1}:</strong> {results[group.id]}
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
