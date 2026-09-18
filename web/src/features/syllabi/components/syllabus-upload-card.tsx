import { type JSX, useState } from 'react';
import type { SyllabusUploadFormat } from '@ingest/contracts';
import { Button, Card, IconButton, IconTrash, Spinner } from '../../../shared/ui/index.js';
import { useSyllabusFormats, useUploadSyllabus } from '../hooks/use-syllabi.js';

/** Which format a picked file is, from its extension; CSV unless it is plainly JSON. */
function formatOf(fileName: string): SyllabusUploadFormat {
  return fileName.toLowerCase().endsWith('.json') ? 'json' : 'csv';
}

function download(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** The CSV columns, so the sheet can be built without downloading the sample first. */
function CsvColumns(): JSX.Element | null {
  const { data } = useSyllabusFormats();
  if (!data) return null;
  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <thead>
        <tr className="text-ink-3">
          <th className="border-b border-line py-1 pr-3 font-medium">Column</th>
          <th className="border-b border-line py-1 font-medium">What it holds</th>
        </tr>
      </thead>
      <tbody>
        {data.csvColumns.map((column) => (
          <tr key={column.column}>
            <td className="border-b border-line py-1 pr-3 align-top">
              <code className="rounded bg-surface-2 px-1 py-0.5 text-ink">{column.column}</code>
              {column.required ? <span className="ml-1 text-bad" title="required">*</span> : null}
            </td>
            <td className="border-b border-line py-1 align-top text-ink-2">{column.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Upload a syllabus as JSON or CSV — pick a file or paste the text. Each exam the file names is REPLACED
 * whole, so a partial file never leaves an exam half-updated. Samples of both formats are downloadable, and
 * the server reports exactly which row or field it could not read.
 */
export function SyllabusUploadCard(): JSX.Element {
  const [format, setFormat] = useState<SyllabusUploadFormat>('csv');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [showFormat, setShowFormat] = useState(false);
  const formats = useSyllabusFormats();
  const upload = useUploadSyllabus();

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setFormat(formatOf(file.name));
    setFileName(file.name);
    setContent(await file.text());
  };

  const clear = (): void => {
    setContent('');
    setFileName(null);
  };

  const send = (): void => {
    upload.mutate(
      { format, content, ...(fileName !== null && { fileName }) },
      { onSuccess: () => { clear(); } },
    );
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-base font-semibold text-ink">Upload a syllabus</h2>
          <p className="m-0 text-sm text-ink-2">
            JSON or CSV. Every exam in the file replaces that exam&apos;s syllabus completely — and an uploaded
            exam overrides the copy bundled with the app.
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={() => { setShowFormat(!showFormat); }}>
          {showFormat ? 'Hide the format' : 'Show the format'}
        </Button>
      </div>

      {showFormat ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-2">Start from a sample:</span>
            <Button
              size="xs"
              variant="ghost"
              disabled={!formats.data}
              onClick={() => { if (formats.data) download('syllabus-sample.csv', formats.data.csv); }}
            >
              Download sample.csv
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!formats.data}
              onClick={() => { if (formats.data) download('syllabus-sample.json', formats.data.json); }}
            >
              Download sample.json
            </Button>
          </div>
          <p className="m-0 text-[13px] text-ink-2">
            CSV is one row per topic, with exam, subject and chapter repeated on every row. Put several aliases
            in one cell separated by <code className="rounded bg-surface px-1">|</code>, and quote any cell that
            contains a comma. Chapter aliases are the bank&apos;s own chapter names, which is how a question
            filed under &ldquo;KTG &amp; Thermodynamics&rdquo; finds its syllabus chapter.
          </p>
          <CsvColumns />
          {formats.data ? (
            <details>
              <summary className="cursor-pointer text-[13px] text-ink-2">Sample CSV</summary>
              <pre className="m-0 mt-2 overflow-x-auto rounded bg-surface p-2 font-mono text-[12px] leading-relaxed text-ink">
                {formats.data.csv}
              </pre>
            </details>
          ) : null}
          {formats.data ? (
            <details>
              <summary className="cursor-pointer text-[13px] text-ink-2">Sample JSON</summary>
              <pre className="m-0 mt-2 overflow-x-auto rounded bg-surface p-2 font-mono text-[12px] leading-relaxed text-ink">
                {formats.data.json}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-ink-2">
          Read as{' '}
          <select
            value={format}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
            onChange={(event) => { setFormat(event.target.value === 'json' ? 'json' : 'csv'); }}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <input
          type="file"
          accept=".json,.csv,application/json,text/csv"
          className="text-sm text-ink-2"
          onChange={(event) => { void pick(event.target.files?.[0]); }}
        />
        {fileName !== null ? (
          <span className="flex items-center gap-1 text-sm text-ink-2">
            {fileName}
            <IconButton label="Clear the picked file" icon={<IconTrash />} onClick={clear} />
          </span>
        ) : null}
      </div>

      <textarea
        value={content}
        spellCheck={false}
        rows={10}
        placeholder={format === 'csv' ? 'Paste CSV rows here, or pick a file above…' : 'Paste JSON here, or pick a file above…'}
        className="w-full rounded-lg border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink"
        onChange={(event) => { setContent(event.target.value); setFileName(null); }}
      />

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={content.trim() === '' || upload.isPending} onClick={send}>
          {upload.isPending ? <Spinner /> : null}
          {upload.isPending ? 'Reading…' : 'Upload syllabus'}
        </Button>
        <span className="text-sm text-ink-3">
          Nothing is written until the whole file reads cleanly.
        </span>
      </div>
    </Card>
  );
}
