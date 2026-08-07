import type { JSX } from 'react';
import type { Question } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';

/**
 * The extracted-question preview: one card per question with its stem, options (correct one
 * highlighted), and answer + source page. Questions arrive in PDF reading order and show the
 * PRINTED question number from the sheet (ordinal fallback when the extractor read none), and
 * every LaTeX-bearing field renders through KaTeX — never raw source.
 */
export function QuestionList({ questions }: { questions: Question[] }): JSX.Element {
  return (
    <ol className="q-list">
      {questions.map((question, index) => (
        <li key={question.id} className="q-card">
          <div className="q-card__head">
            <span className="q-card__num">Q{question.questionNumber ?? index + 1}</span>
            <span className="muted">page {question.sourceRegion.page}</span>
            {question.answer ? (
              <span className="badge badge--success">answer: <RenderLatex text={question.answer} /></span>
            ) : (
              <span className="badge badge--neutral">no answer</span>
            )}
          </div>
          <p className="q-card__stem"><RenderLatex text={question.stem} /></p>
          {question.options.length > 0 ? (
            <ul className="q-opts">
              {question.options.map((option) => (
                <li key={option.label} className={option.isCorrect ? 'q-opt is-correct' : 'q-opt'}>
                  <strong>{option.label}.</strong> <RenderLatex text={option.body} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
