import { type JSX, useId, useState } from 'react';
import type { Question } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { Badge, Button, IconCheck, Spinner } from '../../../shared/ui/index.js';
import { chemistrySourceReviewBlockers } from '../lib/chemistry-source-review.js';

/** Audit candidates stay separate from the source images shown to students. */
export function ChemistrySourceReview({
  question,
  disabled = false,
  pending = false,
  onReview,
}: {
  question: Question;
  disabled?: boolean;
  pending?: boolean;
  onReview: () => void;
}): JSX.Element | null {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [originalSize, setOriginalSize] = useState<ReadonlySet<string>>(new Set());
  const sourceId = useId();
  const chemistry = question.chemistry;
  if (!chemistry || chemistry.visuals.length === 0) return null;
  const blockers = chemistrySourceReviewBlockers(question);
  const allLoaded = chemistry.visuals.every((visual) => Boolean(visual.cropUrl && loaded.has(visual.cropUrl)));
  const reviewed = chemistry.status === 'source_preserved';
  return (
    <details className="rounded-lg border border-line bg-surface-2 p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        Chemistry source comparison
        <Badge tone={reviewed ? 'success' : 'review'}>{reviewed ? 'Source images reviewed' : 'Needs source review'}</Badge>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="m-0 text-xs leading-relaxed text-ink-2">
          Check each source crop against the PDF for the correct question or choice, complete rings,
          bonds, arrows and conditions. Students see the source images. The extracted candidates below
          are retained for comparison and are not verified transcriptions.
        </p>
        {chemistry.issues.length > 0 ? (
          <ul className="m-0 list-disc space-y-1 pl-4 text-xs text-ink-2">
            {chemistry.issues.map((issue, index) => <li key={`${String(index)}-${issue}`}>{issue}</li>)}
          </ul>
        ) : null}
        {chemistry.visuals.map((visual) => {
          const cropUrl = visual.cropUrl;
          const regionCount = visual.regions?.length ?? 1;
          const sourceExpanded = originalSize.has(visual.id);
          const sourceControlId = `${sourceId}-${visual.id}`;
          const label = visual.field === 'stem' ? 'Question' : `Option ${visual.optionLabel ?? '?'}`;
          const candidate = visual.field === 'stem'
            ? chemistry.candidateStem
            : visual.candidateSmiles.map((smiles) => `<smiles>${smiles}</smiles>`).join('\n');
          return (
            <section key={visual.id} className="rounded-lg border border-line bg-surface p-3">
              <h4 className="m-0 mb-2 text-sm font-semibold text-ink">{label} · {visual.kind}</h4>
              <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                    <p className="m-0 text-xs font-medium text-ink-2">Source crop</p>
                    {cropUrl ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-expanded={sourceExpanded}
                        aria-controls={sourceControlId}
                        onClick={() => {
                          setOriginalSize((current) => current.has(visual.id)
                            ? new Set([...current].filter((id) => id !== visual.id))
                            : new Set([...current, visual.id]));
                        }}
                      >
                        {sourceExpanded ? 'Fit preview' : 'View at original size'}
                      </Button>
                    ) : null}
                  </div>
                  {regionCount > 1 ? <p className="m-0 mb-2 text-xs text-ink-2">{regionCount} source regions shown in reading order. Check every region against the PDF.</p> : null}
                  {cropUrl ? (
                    <div id={sourceControlId} className={sourceExpanded ? 'max-h-[32rem] overflow-auto rounded-md border border-line bg-white' : undefined}>
                      <img
                        src={cropUrl}
                        alt={`${label} chemistry source crop${regionCount > 1 ? `, ${String(regionCount)} regions in reading order` : ''}`}
                        className={sourceExpanded ? 'h-auto w-auto max-w-none bg-white' : 'max-h-96 w-auto max-w-full rounded-md border border-line bg-white object-contain'}
                        onLoad={() => {
                          setLoaded((current) => new Set([...current, cropUrl]));
                          setFailed((current) => new Set([...current].filter((value) => value !== cropUrl)));
                        }}
                        onError={() => {
                          setFailed((current) => new Set([...current, cropUrl]));
                          setLoaded((current) => new Set([...current].filter((value) => value !== cropUrl)));
                        }}
                      />
                    </div>
                  ) : <p className="m-0 text-xs text-bad">Source crop missing.</p>}
                  {cropUrl && failed.has(cropUrl) ? <p role="alert" className="m-0 mt-1 text-xs text-bad">Source crop could not load.</p> : null}
                </div>
                <div className="min-w-0">
                  <p className="m-0 mb-1 text-xs font-medium text-ink-2">Extracted candidate · audit only</p>
                  <div className="overflow-x-auto rounded-md border border-line bg-white p-2 text-sm text-ink">
                    {candidate.trim() ? <RenderLatex text={candidate} /> : 'No molecular structure recognized.'}
                  </div>
                  <p className="m-0 mt-1 text-xs text-ink-2">
                    {visual.graphValid === true ? 'Valid graph; source agreement requires review.'
                      : visual.graphValid === false ? 'Invalid molecular graph.' : 'Graph validation unavailable.'}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
        {chemistry.candidateOptions.some((option) => option.trim()) ? (
          <details className="rounded-md border border-line bg-surface p-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-2">Original extracted choice text · audit only</summary>
            <ol className="m-0 mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-2">
              {chemistry.candidateOptions.map((option, index) => <li key={index}><RenderLatex text={option} /></li>)}
            </ol>
          </details>
        ) : null}
        {blockers.length > 0 ? <p className="m-0 text-xs text-bad">{blockers.join(' ')}</p> : null}
        <Button
          size="xs"
          variant="primary"
          disabled={disabled || pending || reviewed || blockers.length > 0 || !allLoaded}
          title="Confirm that every source crop matches its question or choice and is complete"
          onClick={onReview}
        >
          {pending ? <Spinner /> : <IconCheck />} {pending ? 'Saving review…' : 'Mark source images reviewed'}
        </Button>
      </div>
    </details>
  );
}
