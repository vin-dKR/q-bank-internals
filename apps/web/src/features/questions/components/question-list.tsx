import type { JSX } from 'react';
import type { Question } from '@ingest/contracts';

/**
 * The extracted-question preview (the ingest equivalent of the PDF Extractor's results screen):
 * one card per question with its stem, options (correct one highlighted), and answer + source page.
 * Stems/options are LaTeX-bearing source for now — rendering with KaTeX is a later polish.
 */
export function QuestionList({ questions }: { questions: Question[] }): JSX.Element {
  return (
    <ol className="q-list">
      {questions.map((question, index) => (
        <li key={question.id} className="q-card">
          <div className="q-card__head">
            <span className="q-card__num">Q{index + 1}</span>
            <span className="muted">page {question.sourceRegion.page}</span>
            {question.answer ? (
              <span className="badge badge--success">answer: {question.answer}</span>
            ) : (
              <span className="badge badge--neutral">no answer</span>
            )}
          </div>
          <p className="q-card__stem">{question.stem}</p>
          {question.options.length > 0 ? (
            <ul className="q-opts">
              {question.options.map((option) => (
                <li key={option.label} className={option.isCorrect ? 'q-opt is-correct' : 'q-opt'}>
                  <strong>{option.label}.</strong> {option.body}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
