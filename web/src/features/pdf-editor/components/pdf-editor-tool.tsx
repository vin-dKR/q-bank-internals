import { type ChangeEvent, type JSX, useMemo, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../../shared/lib/pdf-worker.js';
import {
  Button,
  ErrorBoundary,
  ErrorFallback,
  FileDropzone,
  IconEdit,
  IconImage,
  IconZoomIn,
  IconZoomOut,
  LoadedFileBar,
} from '../../../shared/ui/index.js';
import { bytesToBlob, readFileAsDataUrl, saveBlob } from '../../../shared/lib/files.js';
import { usePdfFile } from '../../../shared/lib/use-pdf-file.js';
import type { EditorElement } from '../types.js';
import { exportEditedPdf } from '../lib/export-pdf.js';
import { EditorElement as ElementView } from './editor-element.js';

const PAGE_WIDTH = 640;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

/**
 * Pdf Editor: overlay text and images onto a PDF — drag, resize, and edit them — then export the
 * result as a real edited PDF (the overlays are stamped back into the file via pdf-lib; the source
 * tool had no export at all). New elements land on the "active" page (the last one you clicked).
 */
export function PdfEditorTool(): JSX.Element {
  const pdf = usePdfFile();
  const [numPages, setNumPages] = useState(0);
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const fileData = useMemo(
    () => (pdf.file ? { data: new Uint8Array(pdf.file.bytes.slice(0)) } : null),
    [pdf.file],
  );

  const reset = (): void => { setElements([]); setSelectedId(null); setActivePage(1); setNumPages(0); };

  if (!pdf.file || !fileData) {
    return (
      <FileDropzone
        accept="application/pdf"
        onFiles={pdf.load}
        icon={<IconEdit />}
        title="Drop a PDF here, or click to choose"
        hint="Then add text and image overlays and export the edited PDF."
      />
    );
  }
  const file = pdf.file;

  const updateElement = (id: string, patch: Partial<EditorElement>): void => {
    setElements((prev) => prev.map((el) => (el.id === id ? ({ ...el, ...patch } as EditorElement) : el)));
  };
  const removeElement = (id: string): void => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const addText = (): void => {
    const id = crypto.randomUUID();
    setElements((prev) => [
      ...prev,
      { id, type: 'text', page: activePage, x: 60, y: 60, w: 200, h: 40, text: 'New text', fontSize: 20, color: '#111827' },
    ]);
    setSelectedId(id);
  };

  const addImage = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    void readFileAsDataUrl(chosen).then((dataUrl) => {
      const id = crypto.randomUUID();
      setElements((prev) => [
        ...prev,
        { id, type: 'image', page: activePage, x: 60, y: 120, w: 160, h: 160, dataUrl },
      ]);
      setSelectedId(id);
    });
  };

  const exportPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      saveBlob(bytesToBlob(await exportEditedPdf(file.bytes, elements, PAGE_WIDTH)), 'edited.pdf');
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
      />

      <div className="sticky top-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => { setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2))); }} aria-label="Zoom out">
            <IconZoomOut />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-ink-2">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="xs" onClick={() => { setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(2))); }} aria-label="Zoom in">
            <IconZoomIn />
          </Button>
        </div>
        <span className="h-6 w-px bg-line" />
        <Button variant="default" size="xs" onClick={addText}><IconEdit /> Add text</Button>
        <Button variant="default" size="xs" onClick={() => imageInputRef.current?.click()}><IconImage /> Add image</Button>
        <span className="mx-1 text-xs text-ink-3">Adding to page {activePage}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={() => { setElements([]); setSelectedId(null); }} disabled={elements.length === 0}>
          Clear
        </Button>
        <Button variant="primary" size="xs" onClick={() => { void exportPdf(); }} disabled={busy}>
          {busy ? 'Exporting…' : 'Export PDF'}
        </Button>
        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={addImage} />
      </div>

      <ErrorBoundary
        resetKeys={[fileData]}
        fallback={(_error, retry) => (
          <ErrorFallback
            title="Couldn’t render the PDF"
            body="The preview hit an error while loading. Reload it — your overlays are kept."
            retryLabel="Reload preview"
            onRetry={retry}
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
            const pageElements = elements.filter((el) => el.page === pageNumber);
            return (
              <div
                key={i}
                className={`relative rounded-lg border shadow-sm ${activePage === pageNumber ? 'border-brand' : 'border-line'}`}
                style={{ width: PAGE_WIDTH * zoom }}
              >
                <Page
                  pageNumber={pageNumber}
                  width={PAGE_WIDTH * zoom}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={<div className="grid h-[400px] w-full place-items-center text-xs text-ink-3">Loading page {pageNumber}…</div>}
                />
                <div
                  className="absolute inset-0"
                  onMouseDown={() => { setActivePage(pageNumber); setSelectedId(null); }}
                >
                  {pageElements.map((element) => (
                    <ElementView
                      key={element.id}
                      element={element}
                      zoom={zoom}
                      selected={selectedId === element.id}
                      onSelect={() => { setActivePage(pageNumber); setSelectedId(element.id); }}
                      onChange={(patch) => { updateElement(element.id, patch); }}
                      onRemove={() => { removeElement(element.id); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Document>
      </ErrorBoundary>
    </div>
  );
}
