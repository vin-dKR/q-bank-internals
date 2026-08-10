import { type JSX, useCallback, useMemo, useState } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../../shared/lib/pdf-worker.js';
import {
  Button,
  ErrorBoundary,
  ErrorFallback,
  FileDropzone,
  IconScissors,
  LoadedFileBar,
  useToast,
} from '../../../shared/ui/index.js';
import { bytesToBlob, saveBlob } from '../../../shared/lib/files.js';
import { usePdfFile } from '../../../shared/lib/use-pdf-file.js';
import type { SplitOrientation, SplitPoint } from '../types.js';
import { buildMergedPdf } from '../lib/reflow-export.js';
import { SplitOverlay } from './split-overlay.js';

const PAGE_WIDTH = 640;

/**
 * PDF Page Cutter: left-click a page to drop a horizontal cut line, right-click for a vertical guide;
 * drag to reposition, × to remove. Export slices every page at its cut lines and reflows each slice
 * onto its own A4 page, downloaded as `merged.pdf`.
 */
export function PdfCutterTool(): JSX.Element {
  const pdf = usePdfFile();
  const { error: toastError } = useToast();
  const [numPages, setNumPages] = useState(0);
  const [splits, setSplits] = useState<SplitPoint[]>([]);
  const [busy, setBusy] = useState(false);

  const fileData = useMemo(
    () => (pdf.file ? { data: new Uint8Array(pdf.file.bytes.slice(0)) } : null),
    [pdf.file],
  );

  const addSplit = useCallback((page: number, position: number, orientation: SplitOrientation) => {
    setSplits((prev) => [...prev, { id: crypto.randomUUID(), page, position, orientation }]);
  }, []);
  const moveSplit = useCallback((id: string, position: number) => {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, position } : s)));
  }, []);
  const removeSplit = useCallback((id: string) => {
    setSplits((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const reset = (): void => { setSplits([]); setNumPages(0); };

  if (!pdf.file || !fileData) {
    return (
      <FileDropzone
        accept="application/pdf"
        onFiles={pdf.load}
        icon={<IconScissors />}
        title="Drop a PDF here, or click to choose"
        hint="Then click pages to place cut lines and export the reflowed PDF."
      />
    );
  }
  const file = pdf.file;
  const cutCount = splits.filter((s) => s.orientation === 'horizontal').length;

  const exportMerged = async (): Promise<void> => {
    setBusy(true);
    try {
      saveBlob(bytesToBlob(await buildMergedPdf(file.bytes, splits)), 'merged.pdf');
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
        onFile={(next) => { reset(); pdf.load([next]); }}
        onClear={() => { reset(); pdf.clear(); }}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-3">{cutCount} cut line{cutCount === 1 ? '' : 's'}</span>
            <Button variant="ghost" size="xs" onClick={() => { setSplits([]); }} disabled={splits.length === 0}>
              Clear
            </Button>
            <Button variant="primary" size="xs" onClick={() => { void exportMerged(); }} disabled={busy}>
              {busy ? 'Exporting…' : 'Export merged PDF'}
            </Button>
          </div>
        }
      />

      <p className="text-xs text-ink-3">
        Left-click a page to add a horizontal cut · right-click for a vertical guide · drag a line to
        move it · × to remove. Only horizontal cuts split the export.
      </p>

      <ErrorBoundary
        resetKeys={[fileData]}
        fallback={(_error, reset2) => (
          <ErrorFallback
            title="Couldn’t render the PDF"
            body="The preview hit an error while loading. Reload it — your cut lines are kept."
            retryLabel="Reload preview"
            onRetry={reset2}
          />
        )}
      >
        <Document
          file={fileData}
          onLoadSuccess={(doc: { numPages: number }) => { setNumPages(doc.numPages); }}
          loading={<p className="text-sm text-ink-2">Loading PDF…</p>}
          error={<p className="text-sm text-bad">Failed to load the PDF.</p>}
          className="flex flex-col items-center gap-6"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNumber = i + 1;
            const pageSplits = splits.filter((s) => s.page === pageNumber);
            return (
              <div key={i} className="relative w-fit rounded-lg border border-line shadow-sm" style={{ width: PAGE_WIDTH }}>
                <Page
                  pageNumber={pageNumber}
                  width={PAGE_WIDTH}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={<div className="grid h-[400px] w-full place-items-center text-xs text-ink-3">Loading page {pageNumber}…</div>}
                />
                <SplitOverlay
                  page={pageNumber}
                  splits={pageSplits}
                  onAdd={addSplit}
                  onMove={moveSplit}
                  onRemove={removeSplit}
                />
              </div>
            );
          })}
        </Document>
      </ErrorBoundary>
    </div>
  );
}
