import { type JSX, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { IconChevronDown, IconExternalLink, IconSparkle, IconWarning, Spinner, useToast } from '../../../shared/ui/index.js';
import { questionsApi } from '../api/questions.api.js';
import { questionsQueryKey } from '../hooks/use-questions.js';

export function latexScanQueryKey(documentId: string): readonly ['latex-scan', string] {
  return ['latex-scan', documentId];
}

/** Shared scan and repair actions, inline in session rows or inside Verify's compact actions menu. */
export function LatexIssueActions({
  documentId,
  disabled = false,
  layout = 'inline',
  scanEnabled = true,
  onReextract,
  reextractDisabled = false,
  reextractPending = false,
  onNavigateToQuestion,
}: {
  documentId: string;
  /** A local Verify draft must be saved before a bulk repair writes staged text. */
  disabled?: boolean;
  layout?: 'inline' | 'dropdown';
  scanEnabled?: boolean;
  onReextract?: () => void;
  reextractDisabled?: boolean;
  reextractPending?: boolean;
  /** Navigate from an affected field to its question card in Verify. */
  onNavigateToQuestion?: (questionId: string) => void;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const scan = useQuery({
    queryKey: latexScanQueryKey(documentId),
    queryFn: () => questionsApi.scanLatex(documentId),
    enabled: scanEnabled,
  });
  const [busy, setBusy] = useState<'automatic' | 'ai' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (layout !== 'dropdown') return;
    const closeOutside = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && menuRef.current?.open) {
        menuRef.current.open = false;
        menuRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [layout]);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: latexScanQueryKey(documentId) }),
      queryClient.invalidateQueries({ queryKey: questionsQueryKey(documentId) }),
    ]);
  };
  const fixAutomatically = async (): Promise<void> => {
    if (busy) return;
    setBusy('automatic');
    try {
      const result = await questionsApi.fixLatexAutomatically(documentId);
      await refresh();
      if (result.failed.length) error('Some LaTeX fixes failed', `${String(result.updatedFields)} fields fixed; ${String(result.failed.length)} need review. ${result.failed[0]?.message ?? ''}`);
      else success('LaTeX fixes saved', `${String(result.updatedFields)} fields updated.`);
    } catch (caught) {
      error('Automatic LaTeX fix failed', caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };
  const fixWithAi = async (): Promise<void> => {
    if (busy || !scan.data) return;
    const keys = [...new Set(scan.data.issues.map((issue) => issue.key))];
    setBusy('ai');
    setProgress({ done: 0, total: keys.length });
    let updated = 0;
    const failures: string[] = [];
    try {
      for (let start = 0; start < keys.length; start += 5) {
        const batch = keys.slice(start, start + 5);
        const result = await questionsApi.fixLatexWithAi(documentId, batch);
        updated += result.updatedFields;
        failures.push(...result.failed.map((failure) => failure.message));
        setProgress({ done: Math.min(start + batch.length, keys.length), total: keys.length });
      }
      await refresh();
      if (failures.length) error('Some LaTeX issues need review', `${String(updated)} fields fixed; ${String(failures.length)} could not be resolved. ${failures[0] ?? ''}`);
      else success('AI LaTeX fixes saved', `${String(updated)} fields updated across this document.`);
    } catch (caught) {
      await refresh();
      error('AI LaTeX run stopped', `${String(updated)} fields were saved. ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const issues = scanEnabled ? (scan.data?.issues ?? []) : [];
  const count = new Set(issues.map((issue) => issue.key)).size;
  const automaticFields = scanEnabled ? (scan.data?.automaticFields ?? 0) : 0;
  const aiFields = scanEnabled ? (scan.data?.aiFields ?? 0) : 0;
  const scanError = scanEnabled && scan.isError;
  const blocked = disabled || busy !== null;
  const issueSummary = issues.slice(0, 8).map((issue) =>
    `${issue.questionNumber === null ? 'Passage' : `Q${String(issue.questionNumber)}`} · ${issue.field}: ${issue.detail}`,
  ).join('\n');
  if (layout === 'dropdown') {
    if (!onReextract && count === 0 && !scanError) return null;
    return (
      <details ref={menuRef} className="flex-none">
        <summary className="btn list-none whitespace-nowrap [&::-webkit-details-marker]:hidden"
          aria-label={count > 0 ? `Actions, ${String(count)} fields need LaTeX fixes` : 'Actions'}>
          {busy || reextractPending ? <Spinner /> : null}
          Actions
          {count > 0 ? <span className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-1.5 text-xs text-warn"><IconWarning /> {count}</span> : null}
          <IconChevronDown />
        </summary>
        <div className="absolute right-0 top-full z-30 mt-1.5 w-[min(340px,100%)] rounded-xl border border-line-strong bg-surface p-2 shadow-lg">
          {scanError ? (
            <p className="px-2 py-1 text-xs text-bad" title={scan.error.message}>LaTeX scan unavailable</p>
          ) : count > 0 ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 px-2 py-1 text-sm font-semibold text-warn">
                <IconWarning /> {count} {count === 1 ? 'field needs' : 'fields need'} LaTeX fixes
              </p>
              {automaticFields > 0 ? (
                <button type="button" className="w-full rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={blocked} title={disabled ? 'Save Verify edits first' : undefined}
                  onClick={() => { void fixAutomatically(); }}>
                  {busy === 'automatic' ? <><Spinner /> Fixing automatically…</> : `Fix ${String(automaticFields)} automatically`}
                </button>
              ) : null}
              <button type="button" className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={blocked} title={disabled ? 'Save Verify edits first' : `Fix ${String(aiFields)} flagged fields`}
                onClick={() => { void fixWithAi(); }}>
                {busy === 'ai' ? <><Spinner /> AI {String(progress?.done ?? 0)}/{String(progress?.total ?? 0)}</> : <><IconSparkle /> Fix all with AI</>}
              </button>
              {disabled ? (
                <p className="m-0 px-2 py-2 text-xs text-ink-3" title="Save Verify edits before leaving this page">Save Verify edits to open comparison</p>
              ) : (
                <Link
                  className="block rounded-md px-2 py-2 text-sm font-medium text-brand hover:bg-surface-2"
                  to={`/latex-review?${new URLSearchParams({ documentId }).toString()}`}
                  onClick={() => { if (menuRef.current) menuRef.current.open = false; }}
                >
                  Compare before and after
                </Link>
              )}
              <details className="px-2 pb-1 text-xs text-ink-2">
                <summary className="w-fit cursor-pointer select-none hover:text-ink">View affected fields</summary>
                <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto pl-4 leading-relaxed">
                  {issues.map((issue, index) => (
                    <li key={`${issue.key}:${issue.kind}:${String(index)}`} className="break-words">
                      {issue.questionId && onNavigateToQuestion ? (
                        <button type="button" className="text-left hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          onClick={() => {
                            if (menuRef.current) menuRef.current.open = false;
                            onNavigateToQuestion(issue.questionId as string);
                          }}
                          title={`Go to ${issue.questionNumber === null ? 'question' : `Q${String(issue.questionNumber)}`} in Verify`}>
                          <span className="font-medium">{issue.questionNumber === null ? 'Question' : `Q${String(issue.questionNumber)}`} · {issue.field}:</span>{' '}
                          {issue.detail}<span className="sr-only"> — go to question</span>
                        </button>
                      ) : (
                        <><span className="font-medium">{issue.questionNumber === null ? 'Passage' : `Q${String(issue.questionNumber)}`} · {issue.field}:</span>{' '}{issue.detail}</>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : scanEnabled && scan.isPending ? (
            <p className="px-2 py-1 text-xs text-ink-2">Checking LaTeX…</p>
          ) : null}
          {onReextract ? (
            <div className={count > 0 || scanError ? 'mt-1 border-t border-line pt-1' : ''}>
              <button type="button" className="w-full rounded-md px-2 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={reextractDisabled} onClick={() => { if (menuRef.current) menuRef.current.open = false; onReextract(); }}>
                {reextractPending ? <><Spinner /> Re-extracting…</> : 'Re-extract document'}
              </button>
            </div>
          ) : null}
        </div>
      </details>
    );
  }
  if (scanError) return <span className="text-xs text-bad" title={scan.error.message}>LaTeX scan unavailable</span>;
  if (count === 0) return null;
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="LaTeX issues">
      <span className="inline-flex whitespace-nowrap items-center gap-1 rounded-full bg-warn-soft px-2 py-1 text-xs font-medium text-warn"
        title={`${String(scan.data?.questionCount ?? 0)} question(s) have LaTeX rendering issues\n${issueSummary}`}>
        <IconWarning /> {count} LaTeX {count === 1 ? 'issue' : 'issues'}
      </span>
      {automaticFields > 0 ? (
        <button type="button" className="btn btn--xs" disabled={blocked}
          title={disabled ? 'Save Verify edits first' : `Fix ${String(automaticFields)} fields using safe rules`}
          onClick={() => { void fixAutomatically(); }}>
          {busy === 'automatic' ? <><Spinner /> Fixing…</> : `Fix ${String(automaticFields)} automatically`}
        </button>
      ) : null}
      <button type="button" className="btn btn--xs" disabled={blocked}
        title={disabled ? 'Save Verify edits first' : `Use the AI LaTeX refiner on all ${String(aiFields)} flagged fields`}
        onClick={() => { void fixWithAi(); }}>
        {busy === 'ai' ? <><Spinner /> AI {String(progress?.done ?? 0)}/{String(progress?.total ?? 0)}</> : <><IconSparkle /> Fix all with AI</>}
      </button>
      <Link
        className="btn btn--icon-only btn--icon-only-sm flex-none"
        title="Open the LaTeX review page"
        aria-label="Open the LaTeX review page"
        to={`/latex-review?${new URLSearchParams({ documentId }).toString()}`}
      >
        <IconExternalLink />
      </Link>
    </div>
  );
}
