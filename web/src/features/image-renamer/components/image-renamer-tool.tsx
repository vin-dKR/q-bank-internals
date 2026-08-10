import { type JSX, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Button, FileDropzone, IconButton, IconGrid, IconTrash, IconX } from '../../../shared/ui/index.js';
import { saveBlob } from '../../../shared/lib/files.js';

/** The file extension (lower-cased) from a name, defaulting to `jpg` when there isn't one. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : 'jpg';
}

/** `<base>-001.<ext>` — 1-based, zero-padded to three digits (matches the source Image Renamer). */
function renamedFile(base: string, index: number, original: string): string {
  return `${base}-${String(index + 1).padStart(3, '0')}.${extensionOf(original)}`;
}

/**
 * Image Renamer: pick many images, give a base name, and download them zipped as `base-001.ext`,
 * `base-002.ext`, … The original bytes are zipped untouched (no re-encoding) — only the name changes.
 */
export function ImageRenamerTool(): JSX.Element {
  const [images, setImages] = useState<File[]>([]);
  const [base, setBase] = useState('image');
  const [busy, setBusy] = useState(false);

  // Object URLs for previews — created per image, revoked when the set changes or on unmount.
  const previews = useMemo(() => images.map((file) => URL.createObjectURL(file)), [images]);
  useEffect(() => () => { previews.forEach((url) => { URL.revokeObjectURL(url); }); }, [previews]);

  const addImages = (files: File[]): void => { setImages((prev) => [...prev, ...files]); };
  const removeAt = (index: number): void => { setImages((prev) => prev.filter((_, i) => i !== index)); };

  const download = async (): Promise<void> => {
    const cleanBase = base.trim() || 'image';
    setBusy(true);
    try {
      const zip = new JSZip();
      images.forEach((file, index) => { zip.file(renamedFile(cleanBase, index, file.name), file); });
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `${cleanBase}.zip`);
    } finally {
      setBusy(false);
    }
  };

  if (images.length === 0) {
    return (
      <FileDropzone
        accept="image/*"
        multiple
        onFiles={addImages}
        icon={<IconGrid />}
        title="Drop images here, or click to choose"
        hint="Pick any number of images — they’ll be renamed in the order shown."
      />
    );
  }

  const cleanBase = base.trim() || 'image';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Base name</span>
          <input
            type="text"
            value={base}
            onChange={(event) => { setBase(event.target.value); }}
            placeholder="image"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors hover:border-line-strong focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
          />
        </label>
        <FileDropzone accept="image/*" multiple onFiles={addImages} title="Add more" />
        <Button variant="primary" onClick={() => { void download(); }} disabled={busy}>
          {busy ? 'Zipping…' : `Rename & download (${String(images.length)})`}
        </Button>
        <Button variant="ghost" onClick={() => { setImages([]); }} disabled={busy}>Clear</Button>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((file, index) => (
          <li key={`${file.name}-${String(index)}`} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="relative">
              <img src={previews[index]} alt={file.name} className="h-32 w-full rounded-lg object-cover" />
              <div className="absolute right-1 top-1">
                <IconButton icon={<IconX />} label={`Remove ${file.name}`} size="sm" onClick={() => { removeAt(index); }} />
              </div>
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-3" title={file.name}>{file.name}</p>
              <p className="truncate text-[13px] font-medium" title={renamedFile(cleanBase, index, file.name)}>
                {renamedFile(cleanBase, index, file.name)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <IconTrash /> Originals are zipped unchanged — only the filenames change.
      </p>
    </div>
  );
}
