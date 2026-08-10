import { type JSX, useEffect, useMemo, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import {
  Button,
  FileDropzone,
  IconButton,
  IconLayers,
  IconTrash,
  LoadedFileBar,
  useToast,
} from '../../../shared/ui/index.js';
import { bytesToBlob, saveBlob } from '../../../shared/lib/files.js';
import { usePdfFile } from '../../../shared/lib/use-pdf-file.js';
import {
  type ChapterRange,
  buildChaptersZip,
  buildChapterPdf,
  chapterFileName,
} from '../lib/split-chapters.js';

type Draft = { start: string; end: string; name: string };
const EMPTY_DRAFT: Draft = { start: '', end: '', name: '' };

/**
 * Chapter Splitter: load one multi-chapter PDF, define named page ranges, and download each range as
 * its own PDF or all of them zipped as `chapters.zip`. The PDF preview (native viewer) sits alongside
 * so page numbers are easy to read off while defining ranges.
 */
export function ChapterSplitterTool(): JSX.Element {
  const pdf = usePdfFile();
  const { error: toastError } = useToast();
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [ranges, setRanges] = useState<ChapterRange[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);

  const previewUrl = useMemo(
    () => (pdf.file ? URL.createObjectURL(new Blob([pdf.file.bytes], { type: 'application/pdf' })) : null),
    [pdf.file],
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Read the page count once per file so range bounds can be validated.
  useEffect(() => {
    if (!pdf.file) { setPageCount(null); return; }
    let live = true;
    void PDFDocument.load(pdf.file.bytes.slice(0)).then((doc) => {
      if (live) setPageCount(doc.getPageCount());
    });
    return () => { live = false; };
  }, [pdf.file]);

  const resetOnNewFile = (): void => { setRanges([]); setDraft(EMPTY_DRAFT); setEditingId(null); setWarning(''); };

  if (!pdf.file || !previewUrl) {
    return (
      <FileDropzone
        accept="application/pdf"
        onFiles={pdf.load}
        icon={<IconLayers />}
        title="Drop a PDF here, or click to choose"
        hint="Then define named page ranges to split it into chapters."
      />
    );
  }

  // Captured after the guard so async handlers don't re-widen `pdf.file` back to nullable.
  const file = pdf.file;

  const commitDraft = (): void => {
    const start = Number(draft.start);
    const end = Number(draft.end);
    const name = draft.name.trim();
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      setWarning('Enter a valid start and end page (end ≥ start).');
      return;
    }
    if (pageCount !== null && end > pageCount) {
      setWarning(`This PDF has ${String(pageCount)} pages.`);
      return;
    }
    if (!name) { setWarning('Give the chapter a name.'); return; }
    setWarning('');
    if (editingId) {
      setRanges((prev) => prev.map((r) => (r.id === editingId ? { ...r, start, end, name } : r)));
      setEditingId(null);
    } else {
      setRanges((prev) => [...prev, { id: crypto.randomUUID(), start, end, name }]);
    }
    setDraft(EMPTY_DRAFT);
  };

  const editRange = (range: ChapterRange): void => {
    setEditingId(range.id);
    setDraft({ start: String(range.start), end: String(range.end), name: range.name });
  };

  const deleteRange = (id: string): void => {
    setRanges((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) { setEditingId(null); setDraft(EMPTY_DRAFT); }
  };

  const downloadOne = async (range: ChapterRange): Promise<void> => {
    setBusy(true);
    try {
      const bytes = await buildChapterPdf(file.bytes, range);
      saveBlob(bytesToBlob(bytes), chapterFileName(range));
    } catch (err) {
      toastError('Couldn’t build that chapter', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = async (): Promise<void> => {
    setBusy(true);
    try {
      saveBlob(await buildChaptersZip(file.bytes, ranges), 'chapters.zip');
    } catch (err) {
      toastError('Couldn’t build the zip', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <LoadedFileBar
        name={`${file.name}${pageCount ? ` · ${String(pageCount)} pages` : ''}`}
        accept="application/pdf"
        onFile={(file) => { resetOnNewFile(); pdf.load([file]); }}
        onClear={() => { resetOnNewFile(); pdf.clear(); }}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6 max-[900px]:grid-cols-1">
        <iframe
          title="PDF preview"
          src={previewUrl}
          className="sticky top-4 h-[calc(100vh-8rem)] w-full rounded-xl border border-line bg-surface max-[900px]:static max-[900px]:h-[60vh]"
        />

        <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Define chapters</h2>

          <div className="flex items-end gap-2">
            <label className="flex w-20 flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Start</span>
              <input
                type="number"
                min={1}
                value={draft.start}
                onChange={(event) => { setDraft((d) => ({ ...d, start: event.target.value })); }}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
              />
            </label>
            <label className="flex w-20 flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">End</span>
              <input
                type="number"
                min={1}
                value={draft.end}
                onChange={(event) => { setDraft((d) => ({ ...d, end: event.target.value })); }}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
              />
            </label>
            <Button variant="default" onClick={commitDraft} className="flex-1">
              {editingId ? 'Update' : 'Add'}
            </Button>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Chapter name</span>
            <input
              type="text"
              value={draft.name}
              placeholder="e.g. Kinematics"
              onChange={(event) => { setDraft((d) => ({ ...d, name: event.target.value })); }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
            />
          </label>
          {warning ? <p className="m-0 text-sm text-bad">{warning}</p> : null}

          {ranges.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line">
              {ranges.map((range) => (
                <li key={range.id} className="flex items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={range.name}>{range.name}</p>
                    <p className="text-xs text-ink-3">pages {range.start}–{range.end}</p>
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => { editRange(range); }}>Edit</Button>
                  <Button variant="ghost" size="xs" onClick={() => { void downloadOne(range); }} disabled={busy}>
                    Download
                  </Button>
                  <IconButton icon={<IconTrash />} label={`Delete ${range.name}`} size="sm" onClick={() => { deleteRange(range.id); }} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-ink-3">No chapters yet — add a page range above.</p>
          )}

          {ranges.length > 0 ? (
            <Button variant="primary" size="block" onClick={() => { void downloadAll(); }} disabled={busy}>
              {busy ? 'Working…' : 'Download all as ZIP'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
