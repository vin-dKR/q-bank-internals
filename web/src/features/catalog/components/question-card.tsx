import type { JSX } from 'react';
import type { CatalogQuestion } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { Badge } from '../../../shared/ui/index.js';

/** A/B/C… label for the option at `index`. */
function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The set of correct answer tokens: eduents stores answers as a comma list of letters or numbers. */
function correctTokens(answer: string | null): Set<string> {
  if (!answer) return new Set();
  return new Set(answer.split(',').map((token) => token.trim().toUpperCase()).filter(Boolean));
}

/** An option is correct when its letter (A, B…) or its 1-based number is in the answer set. */
function isCorrect(correct: Set<string>, index: number): boolean {
  return correct.has(optionLabel(index)) || correct.has(String(index + 1));
}

/** Only render images we can trust as absolute URLs; fix the common double-encoding (`%2520` → `%20`). */
function imageUrl(url: string): string | null {
  if (!url.startsWith('http')) return null;
  return url.replaceAll('%2520', '%20');
}

/** One published-question preview card: taxonomy badges, stem, options (correct highlighted), answer. */
export function QuestionCard({ question }: { question: CatalogQuestion }): JSX.Element {
  const correct = correctTokens(question.answer);
  const questionImage = question.isQuestionImage && question.questionImage
    ? imageUrl(question.questionImage)
    : null;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {question.exam ? <Badge tone="info" dot={false}>{question.exam}</Badge> : null}
        {question.subject ? <Badge tone="review" dot={false}>{question.subject}</Badge> : null}
        {question.chapter ? <Badge tone="neutral" dot={false}>{question.chapter}</Badge> : null}
        {question.section ? <Badge tone="neutral" dot={false}>{question.section}</Badge> : null}
        <span className="flex-1" />
        {question.flagged ? <Badge tone="danger">Flagged</Badge> : null}
      </div>

      <div className="text-sm leading-relaxed text-ink">
        <RenderLatex text={question.questionText} />
      </div>

      {questionImage ? (
        <img
          src={questionImage}
          alt="Question figure"
          className="max-h-72 w-auto max-w-full rounded-lg border border-line object-contain"
        />
      ) : null}

      {question.isOptionImage ? (
        <div className="grid grid-cols-2 gap-3">
          {question.optionImages.map((url, index) => {
            const src = imageUrl(url);
            return src ? (
              <figure key={index} className="flex flex-col gap-1.5">
                <figcaption className="text-xs font-semibold text-ink-2">{optionLabel(index)}.</figcaption>
                <img
                  src={src}
                  alt={`Option ${optionLabel(index)}`}
                  className="max-h-48 w-auto max-w-full rounded-lg border border-line object-contain"
                />
              </figure>
            ) : null;
          })}
        </div>
      ) : question.options.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {question.options.map((option, index) => (
            <li
              key={index}
              className={
                isCorrect(correct, index)
                  ? 'flex gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2 text-sm text-ink'
                  : 'flex gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-2'
              }
            >
              <span className="font-semibold">{optionLabel(index)}.</span>
              <span className="min-w-0">
                <RenderLatex text={option} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {question.answer ? (
        <div>
          <Badge tone="success">
            Answer:&nbsp;<RenderLatex text={question.answer} />
          </Badge>
        </div>
      ) : null}
    </article>
  );
}
