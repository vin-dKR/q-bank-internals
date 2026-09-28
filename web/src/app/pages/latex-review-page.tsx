import { type JSX, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LatexIssue, LatexScan, QuestionListResponse } from '@ingest/contracts';
import { DocumentPicker } from '../../features/documents/index.js';
import { latexScanQueryKey } from '../../features/questions/components/latex-issue-actions.js';
import { questionsApi } from '../../features/questions/api/questions.api.js';
import { questionsQueryKey } from '../../features/questions/hooks/use-questions.js';
import { RenderLatex } from '../../shared/lib/latex.js';
import { Button, Card, IconSparkle, IconWarning, PageHeader, Spinner, useToast } from '../../shared/ui/index.js';

type RepairMode = 'automatic' | 'ai';
type ComparisonRow = {
  issue: LatexIssue;
  mode: RepairMode;
  before: string | null;
  after: string | null;
  attempted: boolean;
  failed: string | null;
  stillFlagged: boolean;
};

function fieldText(data: QuestionListResponse, issue: LatexIssue): string | null {
  if (issue.questionId === null) {
    const passageId = issue.key.startsWith('p:') ? issue.key.slice(2) : '';
    return data.passages.find((passage) => passage.id === passageId)?.text ?? null;
  }
  const question = data.questions.find((item) => item.id === issue.questionId);
  if (!question) return null;
  if (issue.field === 'stem') return question.stem;
  if (issue.field === 'answer') return question.answer;
  if (issue.field === 'explanation') return question.explanation;
  const option = /^options\.(\d+)$/.exec(issue.field);
  if (option) return question.options[Number(option[1])]?.body ?? null;
  const match = /^match\.(\d+)\.(\d+)$/.exec(issue.field);
  if (match) return question.match?.columns[Number(match[1])]?.entries[Number(match[2])]?.body ?? null;
  return null;
}

function fieldLabel(issue: LatexIssue): string {
  if (issue.field === 'stem') return 'Question text';
  if (issue.field === 'answer') return 'Answer';
  if (issue.field === 'explanation') return 'Solution';
  const option = /^options\.(\d+)$/.exec(issue.field);
  if (option) return `Option ${String(Number(option[1]) + 1)}`;
  const match = /^match\.(\d+)\.(\d+)$/.exec(issue.field);
  if (match) return `Match · column ${String(Number(match[1]) + 1)}, entry ${String(Number(match[2]) + 1)}`;
  return issue.field;
}

function uniqueIssues(scan: LatexScan): LatexIssue[] {
  const byKey = new Map<string, LatexIssue>();
  for (const issue of scan.issues) if (!byKey.has(issue.key)) byKey.set(issue.key, issue);
  return [...byKey.values()];
}

function ComparisonText({ label, value }: { label: string; value: string | null }): JSX.Element {
  const [showSource, setShowSource] = useState(false);
  const text = value ?? 'Text unavailable';
  return (
    <button
      type="button"
      className="block w-full min-w-0 rounded-lg border border-line bg-surface-2/50 p-3 text-left hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      title={showSource ? 'Click to show the rendered preview' : 'Click to show the raw LaTeX source'}
      aria-label={`${label}. ${showSource ? 'Showing raw LaTeX source' : 'Showing rendered preview'}. Click to toggle.`}
      aria-pressed={showSource}
      onClick={() => { setShowSource((current) => !current); }}
    >
      <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
        <span>{label}</span>
        <span className="normal-case tracking-normal">Click to {showSource ? 'preview' : 'view LaTeX'}</span>
      </span>
      {showSource ? (
        <span className="block max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-sm text-ink">{text}</span>
      ) : (
        <span className="block max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          <RenderLatex text={text} />
        </span>
      )}
    </button>
  );
}

export function LatexReviewPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const documentId = searchParams.get('documentId');
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  const [busy, setBusy] = useState<RepairMode | null>(null);
  const [comparison, setComparison] = useState<ComparisonRow[] | null>(null);

  const questions = useQuery({
    queryKey: questionsQueryKey(documentId),
    queryFn: () => questionsApi.listByDocument(documentId ?? ''),
    enabled: documentId !== null,
  });
  const scan = useQuery({
    queryKey: documentId ? latexScanQueryKey(documentId) : ['latex-scan', null],
    queryFn: () => questionsApi.scanLatex(documentId ?? ''),
    enabled: documentId !== null,
  });

  useEffect(() => { setComparison(null); }, [documentId]);

  const runRepair = async (mode: RepairMode): Promise<void> => {
    if (!documentId || !scan.data || !questions.data || busy) return;
    const allIssues = uniqueIssues(scan.data);
    const targets = mode === 'automatic' ? allIssues.filter((issue) => issue.automatic) : allIssues;
    const targetKeys = new Set(targets.map((issue) => issue.key));
    if (targetKeys.size === 0) return;
    setBusy(mode);
    try {
      const failures = new Map<string, string>();
      if (mode === 'automatic') {
        const result = await questionsApi.fixLatexAutomatically(documentId);
        for (const failure of result.failed) failures.set(failure.key, failure.message);
      } else {
        const keys = [...targetKeys];
        for (let start = 0; start < keys.length; start += 5) {
          const result = await questionsApi.fixLatexWithAi(documentId, keys.slice(start, start + 5));
          for (const failure of result.failed) failures.set(failure.key, failure.message);
        }
      }

      const [afterData, afterScan] = await Promise.all([
        questionsApi.listByDocument(documentId),
        questionsApi.scanLatex(documentId),
      ]);
      queryClient.setQueryData(questionsQueryKey(documentId), afterData);
      queryClient.setQueryData(latexScanQueryKey(documentId), afterScan);
      const remaining = new Set(afterScan.issues.map((issue) => issue.key));
      const latestRows = allIssues.map((issue) => ({
        issue,
        mode,
        before: fieldText(questions.data, issue),
        after: fieldText(afterData, issue),
        attempted: targetKeys.has(issue.key),
        failed: failures.get(issue.key) ?? null,
        stillFlagged: remaining.has(issue.key),
      }));
      setComparison((previous) => {
        const merged = new Map((previous ?? []).map((row) => [row.issue.key, row]));
        for (const row of latestRows) merged.set(row.issue.key, row);
        return [...merged.values()];
      });
      const fixedCount = allIssues.filter((issue) => targetKeys.has(issue.key) && !remaining.has(issue.key)).length;
      if (failures.size > 0) error('Some fields still need review', `${String(fixedCount)} fields cleared; ${String(failures.size)} failed.`);
      else success('LaTeX comparison ready', `${String(fixedCount)} fields cleared. Review every before-and-after pair below.`);
    } catch (caught) {
      let afterData: QuestionListResponse | null = null;
      let afterScan: LatexScan | null = null;
      try {
        [afterData, afterScan] = await Promise.all([
          questionsApi.listByDocument(documentId),
          questionsApi.scanLatex(documentId),
        ]);
      } catch (refreshError) {
        error('Could not load partial repair results', refreshError instanceof Error ? refreshError.message : String(refreshError));
      }
      if (afterData !== null && afterScan !== null) {
        queryClient.setQueryData(questionsQueryKey(documentId), afterData);
        queryClient.setQueryData(latexScanQueryKey(documentId), afterScan);
        const remaining = new Set(afterScan.issues.map((issue) => issue.key));
        const latestRows = allIssues.map((issue) => ({
          issue,
          mode,
          before: fieldText(questions.data, issue),
          after: fieldText(afterData, issue),
          attempted: targetKeys.has(issue.key),
          failed: null,
          stillFlagged: remaining.has(issue.key),
        }));
        setComparison((previous) => {
          const merged = new Map((previous ?? []).map((row) => [row.issue.key, row]));
          for (const row of latestRows) merged.set(row.issue.key, row);
          return [...merged.values()];
        });
      }
      error('LaTeX repair interrupted', caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const issues = scan.data ? uniqueIssues(scan.data) : [];
  const fixedCount = comparison?.filter((row) => row.attempted && !row.stillFlagged).length ?? 0;
  const remainingCount = comparison?.filter((row) => row.attempted && row.stillFlagged).length ?? 0;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="LaTeX fix review"
        subtitle="Run safe automatic repairs or AI fixes, then compare each flagged field before and after in one view."
      />
      <Card>
        <div className="grid gap-4 md:grid-cols-[minmax(260px,1fr)_auto] md:items-end">
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Question PDF</p>
            <DocumentPicker value={documentId} onChange={(id) => { setSearchParams({ documentId: id }); }} />
          </div>
          {documentId && scan.data ? (
            <div className="flex flex-wrap gap-2">
              {scan.data.automaticFields > 0 ? (
                <Button disabled={busy !== null} onClick={() => { void runRepair('automatic'); }}>
                  {busy === 'automatic' ? <><Spinner /> Fixing automatically…</> : `Fix ${String(scan.data.automaticFields)} automatically`}
                </Button>
              ) : null}
              {scan.data.aiFields > 0 ? (
                <Button variant="primary" disabled={busy !== null} onClick={() => { void runRepair('ai'); }}>
                  {busy === 'ai' ? <><Spinner /> Fixing with AI…</> : <><IconSparkle /> Fix all with AI</>}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {!documentId ? (
        <Card><p className="m-0 text-sm text-ink-2">Choose a question PDF to see its LaTeX issues and compare repairs.</p></Card>
      ) : scan.isPending || questions.isPending ? (
        <Card><p className="m-0"><Spinner /> Scanning this document…</p></Card>
      ) : scan.isError || questions.isError ? (
        <Card><p className="m-0 text-sm text-bad">Could not load the LaTeX scan or extracted questions. {scan.error?.message ?? questions.error?.message}</p></Card>
      ) : (
        <>
          <Card className="gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-semibold">Current scan</h2>
              <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                {String(issues.length)} affected {issues.length === 1 ? 'field' : 'fields'} · {String(scan.data.questionCount)} {scan.data.questionCount === 1 ? 'question' : 'questions'}
              </span>
              {comparison ? <span className="text-sm text-ink-2">{String(fixedCount)} cleared · {String(remainingCount)} still flagged</span> : null}
            </div>
            <p className="m-0 text-sm text-ink-2">The comparison below uses the saved extracted text from before the selected repair and the latest saved text after it.</p>
          </Card>

          {issues.length === 0 ? (
            <Card><p className="m-0 flex items-center gap-2 text-sm text-ok">No LaTeX issues are currently flagged for this document.</p></Card>
          ) : null}

          {(comparison ?? issues.map((issue) => ({
            issue,
            mode: 'ai',
            before: fieldText(questions.data, issue),
            after: null,
            attempted: false,
            failed: null,
            stillFlagged: true,
          }))).map((row) => (
            <Card key={row.issue.key} className="gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-sm font-semibold">
                  {row.issue.questionId === null ? 'Passage' : `Q${String(row.issue.questionNumber ?? '?')}`} · {fieldLabel(row.issue)}
                </h3>
                {row.attempted ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.stillFlagged ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
                    {row.stillFlagged ? 'Needs review' : 'Issue cleared'}
                  </span>
                ) : <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">Not included in this repair</span>}
                {row.attempted ? <span className="text-xs text-ink-3">{row.mode === 'automatic' ? 'Automatic' : 'AI'} repair</span> : null}
                {row.issue.questionId ? (
                  <Link className="ml-auto text-xs font-medium text-brand hover:underline"
                    to={`/verify?${new URLSearchParams({ documentId, questionId: row.issue.questionId }).toString()}`}>
                    Open in Verify
                  </Link>
                ) : null}
              </div>
              <p className="m-0 text-xs text-ink-2">{row.issue.detail}{row.failed ? ` · ${row.failed}` : ''}</p>
              <div className="grid gap-3 lg:grid-cols-2">
                <ComparisonText label="Before" value={row.before} />
                <ComparisonText label="After" value={row.after ?? (row.attempted ? 'No saved change' : 'Run a repair to compare')} />
              </div>
            </Card>
          ))}
          {comparison && remainingCount > 0 ? (
            <Card className="gap-2 border-warn/40">
              <p className="m-0 flex items-center gap-2 text-sm font-medium text-warn"><IconWarning /> These fields remain flagged. Open them in Verify for manual review.</p>
            </Card>
          ) : null}
        </>
      )}
    </section>
  );
}
