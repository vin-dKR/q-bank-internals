import type { BulkFixPlanId, BulkFixSample, QuestionFix } from '@ingest/contracts';
import { canonicalQuestionType } from './canonical-question-type.js';
import { repairCorruptedEscapes } from './latex-rules.js';
import { wrapLooseMath } from './latex-wrap.js';
import {
  LETTER_LABEL_TYPES,
  answerInLetters,
  answerLabels,
  hasNumberedLabels,
  labelsOf,
  relabelToLetters,
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

/** The alphabet a set of option labels uses, when they are all letters or all numbers. */
function labelAlphabet(labels: readonly string[]): 'letters' | 'numbers' | 'mixed' {
  if (labels.every((label) => /^[a-z]$/.test(label))) return 'letters';
  if (labels.every((label) => /^\d+$/.test(label))) return 'numbers';
  return 'mixed';
}

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
    label: 'Label choice options A–D',
    description:
      'Choice questions (single-correct, multi-correct, assertion-reason) whose options are numbered (1)–(4) are relabelled (A)–(D), keeping their order and text, and their answer is rewritten in the same letters. Integer, subjective and other types are untouched, so numeric answers stay numeric.',
    change: (question) => {
      const canonical = canonicalQuestionType(question.questionType);
      if (canonical.status !== 'known' || !LETTER_LABEL_TYPES.has(canonical.type)) return null;
      if (question.options.length < 2 || !hasNumberedLabels(question.options)) return null;

      const options = relabelToLetters(question.options);
      const fix: QuestionFix = { options };
      // The answer travels with the options: leaving "3" behind would point at a label that no longer
      // exists. An answer that is not a position (free text, a matrix key) is left exactly as it is.
      const answer = question.answer?.trim() ?? '';
      const inLetters = answer === '' ? null : answerInLetters(answer, options.length);
      const rewritten = inLetters !== null && inLetters !== answer ? inLetters : null;
      if (rewritten !== null) fix.answer = rewritten;
      // Every option is shown: the whole set is being relabelled, so one of them proves nothing.
      const withAnswer = (list: readonly string[], value: string): string =>
        `${list.join('   ')}${value === '' ? '' : `   →  answer "${value}"`}`;
      return {
        fix,
        field: 'options + answer',
        before: withAnswer(question.options, answer),
        after: withAnswer(options, rewritten ?? answer),
      };
    },
  },

  answer_option_label: {
    label: 'Match answer labels to the options',
    description:
      'Where the answer names a label its options do not use — answer "3" with options (A)–(D) — it is rewritten to the label at the same position, here "C". Only applied when every label in the answer maps cleanly; questions whose options are still numbered are handled by "Label choice options A–D".',
    change: (question) => {
      const answer = question.answer?.trim() ?? '';
      if (answer === '' || question.options.length < 2) return null;
      const labels = labelsOf(question.options);
      if (!labels) return null;
      // Numbered options are the other plan's job — converting the answer to a number would entrench them.
      if (labelAlphabet(labels) !== 'letters') return null;
      const known = new Set(labels);
      const given = answerLabels(answer);
      if (given.length === 0 || given.every((label) => known.has(label))) return null;
      const after = answerInLetters(answer, question.options.length);
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
