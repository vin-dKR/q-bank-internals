import type { BulkFixPlanId, BulkFixSample, QuestionFix } from '@ingest/contracts';
import { canonicalQuestionType } from './canonical-question-type.js';
import { repairCorruptedEscapes } from './latex-rules.js';
import { wrapLooseMath } from './latex-wrap.js';
import {
  CHOICE_TYPES,
  answerInOptionLabels,
  labelsOf,
} from './option-labels.js';
import type { AuditQuestion } from './quality.types.js';

/** One question's mechanical correction, with the before/after the preview shows. */
export type BulkFixChange = { questionId: string; ingestQuestionId: string | null; fix: QuestionFix; sample: BulkFixSample };

type PlanDefinition = {
  label: string;
  description: string;
  /** The change this plan would make to `question`, or null when it does not apply. */
  change(question: AuditQuestion): { fix: QuestionFix; field: string; before: string; after: string } | null;
};

/**
 * The corrections a rule can make on its own, with nothing to decide. Each rewrites exactly one field and
 * is skipped for any question where the rewrite is not unambiguous.
 */
export const BULK_FIX_DEFINITIONS: Record<BulkFixPlanId, PlanDefinition> = {
  question_type_spelling: {
    label: 'Normalise question types',
    description:
      'Rewrites a legacy section heading ("SINGLE CORRECT TYPE QUESTIONS", "Matrix Match Type Question") as the standard type code it means. Questions whose type is missing or is not a type at all are left alone.',
    change: (question) => {
      const canonical = canonicalQuestionType(question.questionType);
      if (canonical.status !== 'known' || canonical.exact) return null;
      return {
        fix: { questionType: canonical.type },
        field: 'question_type',
        before: question.questionType ?? '',
        after: canonical.type,
      };
    },
  },

  latex_corrupted_escape: {
    label: 'Repair corrupted LaTeX escapes',
    description:
      'Turns the control characters left by a bad JSON escape back into their commands — a form feed followed by "rac" becomes \\frac, a tab followed by "ext" becomes \\text. Nothing else in the text is touched.',
    change: (question) => {
      const fix: QuestionFix = {};
      let field = '';
      let before = '';
      let after = '';
      const repairedText = repairCorruptedEscapes(question.questionText);
      if (repairedText !== question.questionText) {
        fix.questionText = repairedText;
        field = 'question_text';
        before = question.questionText;
        after = repairedText;
      }
      const repairedOptions = question.options.map(repairCorruptedEscapes);
      const changedAt = repairedOptions.findIndex((option, index) => option !== question.options[index]);
      if (changedAt !== -1) {
        fix.options = repairedOptions;
        if (field === '') {
          field = `options[${String(changedAt)}]`;
          before = question.options[changedAt] ?? '';
          after = repairedOptions[changedAt] ?? '';
        }
      }
      if (question.answer !== null) {
        const repairedAnswer = repairCorruptedEscapes(question.answer);
        if (repairedAnswer !== question.answer) {
          fix.answer = repairedAnswer;
          if (field === '') {
            field = 'answer';
            before = question.answer;
            after = repairedAnswer;
          }
        }
      }
      if (question.explanation !== null) {
        const repairedExplanation = repairCorruptedEscapes(question.explanation);
        if (repairedExplanation !== question.explanation) fix.explanation = repairedExplanation;
      }
      return field === '' ? null : { fix, field, before, after };
    },
  },

  latex_wrap_math: {
    label: 'Wrap maths in \\( \\)',
    description:
      'Maths written without delimiters is printed as raw source ("T_n \\propto \\frac{1}{n^2}"). Where a value is a formula and nothing else, it is wrapped so it renders. A formula sitting inside a sentence is left alone — use "Fix LaTeX with AI" on those.',
    // Every unwrapped field of the question is wrapped in ONE pass, so a question never needs a second run.
    change: (question) => {
      const fix: QuestionFix = {};
      const changed: { field: string; before: string; after: string }[] = [];

      const wrappedText = wrapLooseMath(question.questionText);
      if (wrappedText !== null) {
        fix.questionText = wrappedText;
        changed.push({ field: 'question_text', before: question.questionText, after: wrappedText });
      }
      const wrappedOptions = question.options.map((option) => wrapLooseMath(option) ?? option);
      const optionAt = wrappedOptions.findIndex((option, index) => option !== question.options[index]);
      if (optionAt !== -1) {
        fix.options = wrappedOptions;
        changed.push({
          field: `options[${String(optionAt)}]`,
          before: question.options[optionAt] ?? '',
          after: wrappedOptions[optionAt] ?? '',
        });
      }
      const wrappedAnswer = question.answer === null ? null : wrapLooseMath(question.answer);
      if (question.answer !== null && wrappedAnswer !== null) {
        fix.answer = wrappedAnswer;
        changed.push({ field: 'answer', before: question.answer, after: wrappedAnswer });
      }
      const wrappedExplanation = question.explanation === null ? null : wrapLooseMath(question.explanation);
      if (question.explanation !== null && wrappedExplanation !== null) {
        fix.explanation = wrappedExplanation;
        changed.push({ field: 'explanation', before: question.explanation, after: wrappedExplanation });
      }

      // The preview shows one example per question; the fix still carries every field it wrapped.
      const [example] = changed;
      return example ? { fix, ...example } : null;
    },
  },

  option_labels_to_letters: {
    label: 'Keep printed option labels',
    description:
      'Numeric, Roman, and custom markers are valid source labels. This legacy plan deliberately makes no automatic rewrite, so a paper’s printed choices are never silently changed to A–D.',
    change: () => null,
  },

  answer_option_label: {
    label: 'Match answer labels to the options',
    description:
      'Where an answer is an unambiguous positional alias rather than one of the source labels — for example "3" for options (A)–(D), or "A" for options (I)–(IV) — rewrite it to the actual printed label. Numeric, Roman, and custom labels already present in the options are preserved.',
    change: (question) => {
      const answer = question.answer?.trim() ?? '';
      if (answer === '' || question.options.length < 2) return null;
      const canonical = canonicalQuestionType(question.questionType);
      if (canonical.status !== 'known' || !CHOICE_TYPES.has(canonical.type)) return null;
      const labels = labelsOf(question.options);
      if (!labels) return null;
      const after = answerInOptionLabels(answer, labels);
      if (after === null || after === answer) return null;
      return { fix: { answer: after }, field: 'answer', before: answer, after };
    },
  },
};

/** The change `plan` would make to `question`, ready to write, or null when the plan does not apply. */
export function planChange(plan: BulkFixPlanId, question: AuditQuestion): BulkFixChange | null {
  const change = BULK_FIX_DEFINITIONS[plan].change(question);
  if (!change) return null;
  return {
    questionId: question.id,
    ingestQuestionId: question.ingestQuestionId,
    fix: change.fix,
    sample: {
      questionId: question.id,
      field: change.field,
      questionType: question.questionType,
      subject: question.subject,
      before: change.before,
      after: change.after,
    },
  };
}
