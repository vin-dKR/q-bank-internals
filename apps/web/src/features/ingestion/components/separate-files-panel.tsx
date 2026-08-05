import { type JSX, useId, useState } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import { IconPlus } from '../../../shared/ui/index.js';
import {
  type SeparateChapter,
  type SeparateFiles,
  SEPARATE_FILE_SLOTS,
  emptySeparateChapter,
} from '../types/separate-chapter.js';

type SeparateFilesPanelProps = {
  chapters: SeparateChapter[];
  onChange: (chapters: SeparateChapter[]) => void;
};

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function UploadIcon(): JSX.Element {
  return (
    <svg className="dropzone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M7 16a4 4 0 0 1-.88-7.9A5 5 0 0 1 15.9 6 5 5 0 0 1 17 15.9" />
      <path d="M12 12v9" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </svg>
  );
}

function PdfIcon(): JSX.Element {
  return (
    <svg className="file-card__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm7 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5ZM8 13h1.2a1.6 1.6 0 0 1 0 3.2H8.8V18H8v-5Zm.8 2.4h.4a.8.8 0 0 0 0-1.6h-.4v1.6Zm3.4-2.4h1.3c1 0 1.7.8 1.7 2.5s-.7 2.5-1.7 2.5h-1.3v-5Zm.8 4.2h.4c.5 0 .9-.4.9-1.7s-.4-1.7-.9-1.7h-.4v3.4ZM16.4 13H19v.8h-1.8v1.1h1.6v.8h-1.6V18h-.8v-5Z" />
    </svg>
  );
}

function RemoveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** A dashed drag-&-drop target (click-to-browse fallback) that accepts a single PDF. */
function DropZone({ onPick }: { onPick: (file: File) => void }): JSX.Element {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (list: FileList | null | undefined): void => {
    const file = list?.[0];
    if (!file) return;
    if (!isPdf(file)) {
      setError('That’s not a PDF — choose a .pdf file.');
      return;
    }
    setError(null);
    onPick(file);
  };

  const browse = (): void => { document.getElementById(inputId)?.click(); };

  return (
    <div
      className={`dropzone ${dragging ? 'dropzone--active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={browse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          browse();
        }
      }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files);
      }}
    >
      <input
        id={inputId}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => { accept(event.target.files); }}
      />
      <UploadIcon />
      <span className="dropzone__hint">Drop PDF here or click to browse</span>
      <span className="dropzone__sub">PDF only</span>
      {error ? <span className="dropzone__error">{error}</span> : null}
    </div>
  );
}

/** The picked-file state: a compact card with the PDF name, size, and a remove control. */
function FileCard({ file, onClear }: { file: File; onClear: () => void }): JSX.Element {
  return (
    <div className="file-card">
      <PdfIcon />
      <div className="file-card__body">
        <div className="file-card__name" title={file.name}>{file.name}</div>
        <div className="file-card__meta">{formatSize(file.size)}</div>
      </div>
      <button type="button" className="file-card__remove" aria-label="Remove file" onClick={onClear}>
        <RemoveIcon />
      </button>
    </div>
  );
}

/** The three drop targets for one chapter — Question (required), Answer, Explanation (optional). */
function ChapterFiles({
  files,
  onChange,
}: {
  files: SeparateFiles;
  onChange: (files: SeparateFiles) => void;
}): JSX.Element {
  const setFile = (kind: ChapterKind, file: File | null): void => {
    onChange({ ...files, [kind]: file });
  };

  return (
    <div className="upload-grid">
      {SEPARATE_FILE_SLOTS.map((slot) => {
        const file = files[slot.kind];
        return (
          <div
            key={slot.kind}
            className={`upload-slot ${slot.kind === 'solution' ? 'upload-slot--wide' : ''}`}
          >
            <div className="upload-slot__head">
              <span className="upload-slot__label">{slot.label}</span>
              <span className={`req-badge ${slot.required ? 'req-badge--required' : ''}`}>
                {slot.required ? 'Required' : 'Optional'}
              </span>
            </div>
            {file ? (
              <FileCard file={file} onClear={() => { setFile(slot.kind, null); }} />
            ) : (
              <DropZone onPick={(picked) => { setFile(slot.kind, picked); }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The default upload mode, step 1: for each chapter, drop its Question (required), Answer, and
 * Explanation PDFs — no metadata yet. The files move into the crop workspace; every chapter is named
 * there (after cropping), as in the single-PDF flow. Add as many chapters as the batch needs.
 */
export function SeparateFilesPanel({ chapters, onChange }: SeparateFilesPanelProps): JSX.Element {
  const setChapterFiles = (id: string, files: SeparateFiles): void => {
    onChange(chapters.map((chapter) => (chapter.id === id ? { ...chapter, files } : chapter)));
  };

  const addChapter = (): void => {
    onChange([...chapters, emptySeparateChapter(makeId())]);
  };

  const removeChapter = (id: string): void => {
    onChange(chapters.filter((chapter) => chapter.id !== id));
  };

  return (
    <div className="stack">
      {chapters.map((chapter, index) => (
        <div key={chapter.id} className="chapter-card">
          <div className="chapter-card__head">
            <span className="chip chip--chapter">Chapter {index + 1}</span>
            {chapters.length > 1 ? (
              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() => { removeChapter(chapter.id); }}
              >
                Remove
              </button>
            ) : null}
          </div>
          <ChapterFiles
            files={chapter.files}
            onChange={(files) => { setChapterFiles(chapter.id, files); }}
          />
        </div>
      ))}

      <button type="button" className="btn" onClick={addChapter}>
        <IconPlus /> Add chapter
      </button>
    </div>
  );
}
