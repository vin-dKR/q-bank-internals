import { useCallback, useState } from 'react';
import { readFileAsArrayBuffer } from './files.js';

export type PdfFile = { bytes: ArrayBuffer; name: string };

export type PdfFileController = {
  file: PdfFile | null;
  loading: boolean;
  error: string | null;
  /** Read the first file's bytes into state (ignores non-PDFs upstream via the dropzone `accept`). */
  load: (files: File[]) => void;
  clear: () => void;
};

/**
 * One PDF-in-memory for a tool: read an uploaded file to bytes, expose them + the name, and clear.
 * Shared by every PDF tool so the load/clear plumbing lives in one place, not copied per tool.
 */
export function usePdfFile(): PdfFileController {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((files: File[]) => {
    const first = files[0];
    if (!first) return;
    setLoading(true);
    setError(null);
    readFileAsArrayBuffer(first)
      .then((bytes) => { setFile({ bytes, name: first.name }); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Could not read the PDF.'); })
      .finally(() => { setLoading(false); });
  }, []);

  const clear = useCallback(() => { setFile(null); setError(null); }, []);

  return { file, loading, error, load, clear };
}
