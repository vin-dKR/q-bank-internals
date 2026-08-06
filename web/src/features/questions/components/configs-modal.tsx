import type { JSX } from 'react';
import type { Question } from '@ingest/contracts';
import { useQuestions } from '../hooks/use-questions.js';

/** Project an ingest question into the main bank's shape — a preview of what publish would write. */
function toBankConfig(question: Question, index: number): Record<string, unknown> {
  return {
    question_number: index + 1,
    question_text: question.stem,
    options: question.options.map((o) => `(${o.label}) ${o.body}`),
    answer: question.answer || null,
    isQuestionImage: question.isQuestionImage,
    question_image: question.questionImage,
    isOptionImage: question.isOptionImage,
    option_images: question.optionImages,
    question_type: question.questionType,
    section_name: question.sectionName ?? question.path.section,
    topic: question.topic,
    chapter: question.path.chapter,
    module: question.path.module,
  };
}

/**
 * Modal listing the exact records a document would push to the DB on publish — the "see all my
 * configs going to the DB" view. Read-only preview; publishing is a later, explicit step.
 */
export function ConfigsModal({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}): JSX.Element {
  const questions = useQuestions(documentId);
  const configs = (questions.data ?? []).map(toBankConfig);
  const json = JSON.stringify(configs, null, 2);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => { e.stopPropagation(); }}>
        <div className="row justify-between">
          <h2>Configs to publish · {configs.length} question(s)</h2>
          <div className="row">
            <button
              type="button"
              className="btn btn--xs"
              disabled={configs.length === 0}
              onClick={() => { void navigator.clipboard.writeText(json); }}
            >
              Copy JSON
            </button>
            <button type="button" className="btn btn--xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="muted">These bank-shaped records are what a publish step would write to the DB.</p>
        {questions.isPending ? (
          <p className="muted">Loading…</p>
        ) : configs.length === 0 ? (
          <p className="muted">No extracted questions for this document yet.</p>
        ) : (
          <pre className="modal__code">{json}</pre>
        )}
      </div>
    </div>
  );
}
