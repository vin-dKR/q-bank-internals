import { type JSX, useId, useState } from 'react';
import type { ChemistryRepairResult, Passage, Question } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { Badge, Button, IconCheck, Spinner } from '../../../shared/ui/index.js';
import { chemistrySourceReviewBlockers } from '../lib/chemistry-source-review.js';

/** Compare the rendered molecular transcription with source evidence before manual acceptance. */
export function ChemistrySourceReview({
  question,
  passage,
  disabled = false,
  pending = false,
  onReview,
  onRepair,
  repairing = false,
  unresolved = [],
}: {
  question: Question;
  passage?: Pick<Passage, 'text' | 'passageImage'> | null | undefined;
  disabled?: boolean;
  pending?: boolean;
  onReview: () => void;
  onRepair: () => void;
  repairing?: boolean;
  unresolved?: ChemistryRepairResult['unresolved'];
}): JSX.Element | null {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [originalSize, setOriginalSize] = useState<ReadonlySet<string>>(new Set());
  const sourceId = useId();
  const chemistry = question.chemistry;
  if (!chemistry) return null;
  const transcription = chemistry.representation === 'transcription';
  const blockers = chemistrySourceReviewBlockers(question, passage);
  const allLoaded = chemistry.visuals.every((visual) => Boolean(visual.cropUrl && loaded.has(visual.cropUrl)));
  const reviewed = chemistry.status === (transcription ? 'transcription_reviewed' : 'source_preserved') && blockers.length === 0;
  return (
    <details className="rounded-lg border border-line bg-surface-2 p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        Check extracted chemistry
        <Badge tone={reviewed ? 'success' : 'review'}>{reviewed ? (transcription ? 'Transcription reviewed' : 'Source images reviewed') : 'Needs chemistry review'}</Badge>
        {blockers.length > 0 ? <Badge tone="review">{blockers.length} review blocker{blockers.length === 1 ? '' : 's'}</Badge> : null}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="m-0 text-xs leading-relaxed text-ink-2">
          {transcription ? 'The question fields render the extracted SMILES. Compare every molecule with the PDF, including rings, bonds, substituent positions, charges, stereochemistry and reaction conditions. Source crops here are comparison evidence. A valid molecular graph does not prove that it matches the drawing.'
            : 'This record still uses the previous source-image representation. Restore extracted SMILES to display its saved molecular transcription. Review the structures against the original page before publishing.'}
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
          const label = visual.field === 'stem' ? 'Question' : visual.field === 'answer' ? 'Answer'
            : visual.field === 'explanation' ? 'Worked solution' : `Option ${visual.optionLabel ?? '?'}`;
          const candidate = transcription
            ? visual.field === 'stem' ? question.stem
              : visual.field === 'answer' ? question.answer
              : visual.field === 'explanation' ? question.explanation ?? ''
              : question.options.find((option) => option.label.toUpperCase() === visual.optionLabel?.replace(/[()]/g, '').toUpperCase())?.body ?? ''
            : visual.field === 'stem' ? chemistry.candidateStem
              : visual.field === 'answer' ? chemistry.candidateAnswer ?? ''
              : visual.field === 'explanation' ? chemistry.candidateExplanation ?? ''
              : visual.candidateSmiles.map((smiles) => `<smiles>${smiles}</smiles>`).join('\n');
          return (
            <section key={visual.id} className="rounded-lg border border-line bg-surface p-3">
              <h4 className="m-0 mb-2 text-sm font-semibold text-ink">{label} · {visual.kind}</h4>
              {visual.sourcePage ? <p className="m-0 mb-2 text-xs text-ink-2">Source page {visual.sourcePage}</p> : null}
              <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                    <p className="m-0 text-xs font-medium text-ink-2">Source crop · comparison only</p>
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
                  ) : <p className="m-0 text-xs text-ink-2">Comparison crop unavailable. Check the structure directly on the original PDF{visual.sourcePage ? `, page ${String(visual.sourcePage)}` : ''}.</p>}
                  {cropUrl && failed.has(cropUrl) ? <p role="alert" className="m-0 mt-1 text-xs text-bad">Source crop could not load.</p> : null}
                </div>
                <div className="min-w-0">
                  <p className="m-0 mb-1 text-xs font-medium text-ink-2">{transcription ? 'Displayed SMILES transcription' : 'Saved molecular transcription'}</p>
                  <div className="overflow-x-auto rounded-md border border-line bg-white p-2 text-sm text-ink">
                    {candidate.trim() ? <RenderLatex text={candidate} /> : 'No molecular structure recognized.'}
                  </div>
                  <p className="m-0 mt-1 text-xs text-ink-2">
                    {visual.graphValid === true ? 'The saved recognition parsed as a valid graph; source agreement still requires review.'
                      : visual.graphValid === false ? 'The saved recognition had an invalid graph. Correct the displayed SMILES before review.' : 'No graph validation was recorded for the saved recognition.'}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
        {chemistry.candidateOptions.some((option) => option.trim()) ? (
          <details className="rounded-md border border-line bg-surface p-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-2">Original extracted choice text</summary>
            <ol className="m-0 mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-2">
              {chemistry.candidateOptions.map((option, index) => <li key={index}><RenderLatex text={option} /></li>)}
            </ol>
          </details>
        ) : null}
        {blockers.length > 0 ? (
          <div role="alert" className="rounded-md border border-line bg-surface p-3 text-xs text-bad">
            <p className="m-0 mb-2 font-semibold">Chemistry review cannot be saved yet.</p>
            <ul className="m-0 list-disc space-y-1 pl-4">
              {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
            <p className="m-0 mt-2 text-ink-2">Correct the molecular transcription before review. If a structure cannot be recognized, add a source figure manually for that field.</p>
          </div>
        ) : null}
        {unresolved.length > 0 ? (
          <div role="alert" className="rounded-md border border-line bg-surface p-3 text-xs text-bad">
            <p className="m-0 mb-2 font-semibold">Some content could not be restored automatically.</p>
            <ul className="m-0 list-disc space-y-1 pl-4">
              {unresolved.map((issue, index) => <li key={`${issue.field}-${String(index)}`}>{issue.message}</li>)}
            </ul>
          </div>
        ) : null}
        <Button
          size="xs"
          disabled={disabled || pending || repairing}
          onClick={onRepair}
          title="Restore saved SMILES and remove only the extractor's automatically attached source crops"
        >
          {repairing ? <Spinner /> : null} {repairing ? 'Restoring SMILES…' : 'Restore extracted SMILES'}
        </Button>
        <Button
          size="xs"
          variant="primary"
          disabled={disabled || pending || repairing || reviewed || blockers.length > 0 || (!transcription && !allLoaded)}
          title={blockers[0] ?? 'Confirm that the displayed molecular structures, bonds, rings and conditions match the source'}
          onClick={onReview}
        >
          {pending ? <Spinner /> : <IconCheck />} {pending ? 'Saving review…' : transcription ? 'Mark SMILES transcription reviewed' : 'Mark source images reviewed'}
        </Button>
      </div>
    </details>
  );
}
