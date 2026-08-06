import { type JSX, useRef } from 'react';

type PdfUploaderProps = {
  fileName: string | null;
  onLoad: (bytes: ArrayBuffer, fileName: string) => void;
  onClear: () => void;
};

/** Upload a PDF and hand its bytes (cloned to avoid detachment) to the page. */
export function PdfUploader({ fileName, onLoad, onClear }: PdfUploaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    if (file.type !== 'application/pdf') return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (result instanceof ArrayBuffer) {
        onLoad(result.slice(0), file.name);
      }
    };
    reader.readAsArrayBuffer(file);
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
          hidden
          onChange={(event) => { handleFile(event.target.files?.[0]); }}
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
        handleFile(event.dataTransfer.files[0]);
      }}
      onDragOver={(event) => { event.preventDefault(); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => { handleFile(event.target.files?.[0]); }}
      />
      <p className="muted">Drag &amp; drop a multi-chapter PDF here, or click to choose a file.</p>
    </div>
  );
}
