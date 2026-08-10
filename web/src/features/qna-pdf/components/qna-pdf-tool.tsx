import { type JSX, useEffect, useMemo, useState } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../../shared/lib/pdf-worker.js';
import {
  Button,
  EmptyState,
  ErrorBoundary,
  ErrorFallback,
  FileDropzone,
  IconCheck,
  IconScan,
  LoadedFileBar,
  useToast,
} from '../../../shared/ui/index.js';
import { saveBlob } from '../../../shared/lib/files.js';
import { usePdfFile } from '../../../shared/lib/use-pdf-file.js';
import { buildQnaZip } from '../lib/build-qna.js';

const THUMB_WIDTH = 150;

/**
 * QnA PDF Generator: load a PDF, click the pages that are answers, and export a zip with the selected
 * pages as `<name>-answer.pdf` and the rest as `<name>-question.pdf`. The name defaults to the file's.
 */
export function QnaPdfTool(): JSX.Element {
  const pdf = usePdfFile();
  const { error: toastError } = useToast();
  const [numPages, setNumPages] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // A stable copy so pdf.js never reads a detached buffer across re-renders.
  const fileData = useMemo(
    () => (pdf.file ? { data: new Uint8Array(pdf.file.bytes.slice(0)) } : null),
    [pdf.file],
  );

  // Default the export name to the uploaded file's name (sans extension) whenever a new file loads.
  useEffect(() => {
    if (pdf.file) setName(pdf.file.name.replace(/\.pdf$/i, ''));
    setSelected(new Set());
    setNumPages(0);
  }, [pdf.file]);

  if (!pdf.file || !fileData) {
    return (
      <FileDropzone
        accept="application/pdf"
        onFiles={pdf.load}
        icon={<IconScan />}
        title="Drop a PDF here, or click to choose"
        hint="Then select the answer pages to split them out from the questions."
      />
    );
  }
  const file = pdf.file;

  const toggle = (pageNumber: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pageNumber)) next.delete(pageNumber);
      else next.add(pageNumber);
      return next;
    });
  };

  const exportZip = async (): Promise<void> => {
    setBusy(true);
    try {
      saveBlob(await buildQnaZip(file.bytes, selected, name), `${name.trim() || 'qna'}.zip`);
    } catch (err) {
      toastError('Export failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <LoadedFileBar
        name={file.name}
        accept="application/pdf"
        onFile={(next) => { pdf.load([next]); }}
        onClear={pdf.clear}
        actions={
          <span className="text-xs text-ink-3">
            {selected.size} of {numPages || '…'} page{selected.size === 1 ? '' : 's'} marked as answers
          </span>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Output name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => { setName(event.target.value); }}
            placeholder="qna"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
          />
        </label>
        <Button variant="primary" onClick={() => { void exportZip(); }} disabled={busy || selected.size === 0}>
          {busy ? 'Zipping…' : 'Export answer + question'}
        </Button>
        <Button variant="ghost" onClick={() => { setSelected(new Set()); }} disabled={selected.size === 0}>
          Clear selection
        </Button>
      </div>

      <ErrorBoundary
        resetKeys={[fileData]}
        fallback={(_error, reset) => (
          <ErrorFallback
            title="Couldn’t render the PDF"
            body="The preview hit an error while loading. Reload it — your selection is kept."
            retryLabel="Reload preview"
            onRetry={reset}
          />
        )}
      >
        <Document
          file={fileData}
          onLoadSuccess={(doc: { numPages: number }) => { setNumPages(doc.numPages); }}
          loading={<p className="text-sm text-ink-2">Loading PDF…</p>}
          error={<p className="text-sm text-bad">Failed to load the PDF.</p>}
          className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNumber = i + 1;
            const isAnswer = selected.has(pageNumber);
            return (
              <button
                key={i}
                type="button"
                onClick={() => { toggle(pageNumber); }}
                aria-pressed={isAnswer}
                className={`relative flex flex-col items-center gap-1 rounded-xl border bg-surface p-2 transition-colors ${
                  isAnswer ? 'border-warn ring-2 ring-warn-soft' : 'border-line hover:bg-surface-2'
                }`}
              >
                <Page
                  pageNumber={pageNumber}
                  width={THUMB_WIDTH}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={<div className="grid h-40 w-full place-items-center text-xs text-ink-3">…</div>}
                />
                <span className="text-xs text-ink-2">Page {pageNumber}</span>
                {isAnswer ? (
                  <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-warn text-white [&>svg]:size-3.5">
                    <IconCheck />
                  </span>
                ) : null}
              </button>
            );
          })}
        </Document>
      </ErrorBoundary>

      {numPages === 0 ? (
        <EmptyState icon={<IconScan />} title="Loading pages…" body="The page thumbnails will appear here." />
      ) : null}
    </div>
  );
}
