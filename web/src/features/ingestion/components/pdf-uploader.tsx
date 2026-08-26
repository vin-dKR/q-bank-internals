import { type JSX, useRef } from 'react';

/** One selected PDF's cloned bytes (detachment-safe) and its original filename. */
export type LoadedPdf = { bytes: ArrayBuffer; name: string };

type PdfUploaderProps = {
  fileName: string | null;
  onLoad: (files: LoadedPdf[]) => void;
  onClear: () => void;
};

/** Read one PDF's bytes, or null when it is not a PDF or cannot be read. */
function readPdf(file: File): Promise<LoadedPdf | null> {
  if (file.type !== 'application/pdf') return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      resolve(result instanceof ArrayBuffer ? { bytes: result.slice(0), name: file.name } : null);
    };
    reader.onerror = () => { resolve(null); };
    reader.readAsArrayBuffer(file);
  });
}

/** Upload one or more PDFs and hand their ordered bytes (cloned to avoid detachment) to the page. */
export function PdfUploader({ fileName, onLoad, onClear }: PdfUploaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | null): void => {
    if (!list || list.length === 0) return;
    void Promise.all(Array.from(list).map(readPdf)).then((loaded) => {
      const pdfs = loaded.filter((file): file is LoadedPdf => file !== null);
      if (pdfs.length > 0) onLoad(pdfs);
    });
  };

  if (fileName) {
    return (
      <div className="uploader uploader--loaded">
        <span>
          <strong>{fileName}</strong> <span className="muted">loaded</span>
        </span>
        <div className="folder-select__row">
          <button type="button" className="btn btn--ghost" onClick={() => inputRef.current?.click()}>
            Change
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClear}>
            Clear
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(event) => { handleFiles(event.target.files); }}
        />
      </div>
    );
  }

  return (
    <div
      className="uploader"
      onClick={() => inputRef.current?.click()}
      onDrop={(event) => {
        event.preventDefault();
        handleFiles(event.dataTransfer.files);
      }}
      onDragOver={(event) => { event.preventDefault(); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(event) => { handleFiles(event.target.files); }}
      />
      <p className="muted">
        Drag &amp; drop one or more PDFs here, or click to choose. Multiple files merge into one
        continuous document, in the order selected.
      </p>
    </div>
  );
}
