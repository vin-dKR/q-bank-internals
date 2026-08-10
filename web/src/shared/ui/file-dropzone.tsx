import { type JSX, type ReactNode, useRef, useState } from 'react';

type FileDropzoneProps = {
  /** `accept` attribute + drop filter, e.g. `application/pdf` or `image/*`. */
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: string;
  icon?: ReactNode;
};

/** Keep only the files whose type matches the `accept` list (handles `image/*` style wildcards). */
function matchesAccept(file: File, accept: string): boolean {
  const patterns = accept.split(',').map((p) => p.trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

/**
 * The one upload target for the PDF tools: a click-or-drop dashed panel that filters to `accept` and
 * hands back the accepted files. Replaces the near-identical hand-rolled uploader each source tool
 * carried. The tool owns what to render once files are chosen — this is only the empty pick state.
 */
export function FileDropzone({
  accept,
  multiple = false,
  onFiles,
  title,
  hint,
  icon,
}: FileDropzoneProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const emit = (list: FileList | null): void => {
    if (!list) return;
    const files = Array.from(list).filter((file) => matchesAccept(file, accept));
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => { setDragOver(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        emit(event.dataTransfer.files);
      }}
      className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
        dragOver ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface hover:bg-surface-2'
      }`}
    >
      {icon ? (
        <div className="mb-1 grid size-10 place-items-center rounded-full bg-surface-2 text-ink-3 [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <span className="text-[15px] font-semibold">{title}</span>
      {hint ? <span className="max-w-md text-sm text-ink-2">{hint}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => { emit(event.target.files); event.target.value = ''; }}
      />
    </button>
  );
}
