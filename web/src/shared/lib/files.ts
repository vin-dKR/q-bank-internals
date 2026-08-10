/**
 * The one place the browser file helpers live for the PDF tools: read an uploaded file into the
 * shape the transform needs, and trigger a download. Kept dependency-free (no file-saver) — a temp
 * object-URL anchor is all a "save" is.
 */

/** Read a file's bytes. The buffer is cloned (`slice(0)`) so pdf.js/pdf-lib never see it detached. */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result.slice(0));
      else reject(new Error('Could not read file as bytes.'));
    };
    reader.onerror = () => { reject(reader.error ?? new Error('File read failed.')); };
    reader.readAsArrayBuffer(file);
  });
}

/** Read an image file as a data URL (for embedding as an overlay / into a PDF). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file as a data URL.'));
    };
    reader.onerror = () => { reject(reader.error ?? new Error('File read failed.')); };
    reader.readAsDataURL(file);
  });
}

/**
 * Wrap pdf-lib / raw bytes in a Blob. Copies into a fresh ArrayBuffer-backed view so the Blob part is
 * exactly `ArrayBufferView<ArrayBuffer>` — pdf-lib's `save()` returns `Uint8Array<ArrayBufferLike>`,
 * which TS won't accept as a `BlobPart` directly.
 */
export function bytesToBlob(bytes: Uint8Array, type = 'application/pdf'): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type });
}

/** Download `blob` as `fileName` via a transient object-URL anchor, revoked on the next tick. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 0);
}
