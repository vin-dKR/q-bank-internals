import { type JSX } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import {
  type SeparateChapter,
  SEPARATE_FILE_SLOTS,
  emptySeparateChapter,
} from '../types/separate-chapter.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';
import { ChapterMetadataForm } from './chapter-metadata-form.js';

type SeparateFilesPanelProps = {
  chapters: SeparateChapter[];
  onChange: (chapters: SeparateChapter[]) => void;
};

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** One PDF drop slot — a native file picker that shows the chosen file name and a clear control. */
function FileSlot({
  label,
  required,
  file,
  onPick,
  onClear,
}: {
  label: string;
  required: boolean;
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <label className="field file-slot">
      <span>
        {label}
        {required ? ' *' : ' (optional)'}
      </span>
      {file ? (
        <span className="file-slot__picked">
          <span className="file-slot__name" title={file.name}>
            {file.name}
          </span>
          <button type="button" className="btn btn--ghost btn--xs" onClick={onClear}>
            Clear
          </button>
        </span>
      ) : (
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) onPick(picked);
          }}
        />
      )}
    </label>
  );
}

/**
 * The default upload mode: for each chapter, capture its metadata and up to three separate PDFs —
 * Question (required), Answer, and Explanation — each filed as its own document under the same
 * chapter unit so extraction maps answers/explanations back onto the questions.
 */
export function SeparateFilesPanel({ chapters, onChange }: SeparateFilesPanelProps): JSX.Element {
  const updateMetadata = (id: string, patch: Partial<ChapterMetadataDraft>): void => {
    onChange(
      chapters.map((chapter) =>
        chapter.id === id ? { ...chapter, metadata: { ...chapter.metadata, ...patch } } : chapter,
      ),
    );
  };

  const setFile = (id: string, kind: ChapterKind, file: File | null): void => {
    onChange(
      chapters.map((chapter) =>
        chapter.id === id ? { ...chapter, files: { ...chapter.files, [kind]: file } } : chapter,
      ),
    );
  };

  const addChapter = (): void => {
    onChange([...chapters, emptySeparateChapter(makeId())]);
  };

  const removeChapter = (id: string): void => {
    onChange(chapters.filter((chapter) => chapter.id !== id));
  };

  return (
    <div className="stack">
      {chapters.length === 0 ? (
        <p className="muted">No chapters yet. Add one, fill its metadata, and attach its PDFs.</p>
      ) : null}

      {chapters.map((chapter, index) => (
        <div key={chapter.id} className="chapter-card">
          <div className="chapter-card__head">
            <strong>
              <span className="chip chip--chapter">Chapter {index + 1}</span>
            </strong>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => { removeChapter(chapter.id); }}
            >
              Remove
            </button>
          </div>

          <ChapterMetadataForm
            value={chapter.metadata}
            onChange={(patch) => { updateMetadata(chapter.id, patch); }}
          />

          <div className="stack stack--tight">
            <span className="muted">Files</span>
            {SEPARATE_FILE_SLOTS.map((slot) => (
              <FileSlot
                key={slot.kind}
                label={slot.label}
                required={slot.required}
                file={chapter.files[slot.kind]}
                onPick={(file) => { setFile(chapter.id, slot.kind, file); }}
                onClear={() => { setFile(chapter.id, slot.kind, null); }}
              />
            ))}
          </div>
        </div>
      ))}

      <button type="button" className="btn" onClick={addChapter}>
        + Add chapter
      </button>
    </div>
  );
}
