import { QUESTION_LEVELS, synthesizeMatrixChoiceOptions } from '@ingest/contracts';
import { canonicalQuestionType } from './canonical-question-type.js';
import {
  CHOICE_TYPES,
  answerOptionLabels,
  labelsOf,
  optionBody,
  optionLabel,
  optionLabelKey,
} from './option-labels.js';
import type { AuditQuestion, RuleFinding } from './quality.types.js';

/** Types whose answer must be one or more of the question's option labels. */
const OPTION_ANSWER_TYPES = CHOICE_TYPES;

/** Values an operator typed instead of a real answer. */
const PLACEHOLDER_ANSWER = /^\s*(should\s+be\b.*|n\/?a|-+|\?+|not\s+given|refer\b.*|see\s+(image|solution)\b.*|image)\s*$/i;

/** Topic values that are really the exercise/section a question sat under, not a real topic. */
const SECTION_LIKE_TOPIC = /\b(exercise|level|section|part|dpp|worksheet|sheet|assignment)\b|\((s|o)-\d\)/i;

/** Wording that means the question depends on a figure. */
const FIGURE_REFERENCE = /\b(figure|fig\.|diagram|graph|as shown|shown (below|above|in)|following figure|circuit shown)\b/i;

/** Placeholder subject values that carry no information. */
const EMPTY_SUBJECT = /^\s*(na|n\/a|none|-+)?\s*$/i;

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hasAnyImage(question: AuditQuestion): boolean {
  return (
    question.isQuestionImage ||
    !isBlank(question.questionImage) ||
    question.isOptionImage ||
    question.optionImages.length > 0 ||
    !isBlank(question.passageImage)
  );
}

function answerRules(question: AuditQuestion, type: string | null): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const { answer } = question;
  if (answer === null || answer.trim() === '') {
    // A historic direct-response matrix may have persisted its complete key but no flat answer
    // string. That is still publishable: the shared planner deterministically creates its choices
    // and selected answer from the key. Do not mark a recoverable legacy row as answer-less.
    if (
      type === 'matrix'
      && question.options.length === 0
      && question.match !== null
      && synthesizeMatrixChoiceOptions(question.match).status === 'generated'
    ) return findings;
    findings.push({
      kind: type === 'subjective' ? 'answer_missing_subjective' : 'answer_missing',
      field: 'answer',
      detail: 'No answer stored.',
    });
    return findings;
  }
  if (PLACEHOLDER_ANSWER.test(answer)) {
    findings.push({ kind: 'answer_placeholder', field: 'answer', detail: `Answer is "${answer.trim()}".` });
    return findings;
  }
  if (type === 'integer' && !/^\s*[-+]?\d+(\.\d+)?\s*$/.test(answer)) {
    findings.push({ kind: 'integer_answer_not_numeric', field: 'answer', detail: `Answer is "${answer.trim()}".` });
  }
  if (type === null || !OPTION_ANSWER_TYPES.has(type) || question.options.length === 0) return findings;

  const labels = labelsOf(question.options);
  if (!labels) return findings;
  const known = new Set(labels.map(optionLabelKey));
  const given = answerOptionLabels(answer, question.options);
  if (given.length === 0 || given.some((label) => !known.has(label))) {
    findings.push({
      kind: 'answer_not_in_options',
      field: 'answer',
      detail: `Answer "${answer.trim()}" but options are labelled ${labels.join(', ')}.`,
    });
  } else if (type === 'single_correct' && given.length > 1) {
    findings.push({
      kind: 'single_correct_multiple_answers',
      field: 'question_type',
      detail: `Stored as "${question.questionType ?? ''}" but the answer is "${answer.trim()}".`,
    });
  }
  return findings;
}

function topicRules(question: AuditQuestion): RuleFinding[] {
  const { topic } = question;
  if (topic === null || topic.trim() === '') return [{ kind: 'topic_missing', field: 'topic', detail: 'No topic stored.' }];
  if (question.chapter !== null && normalize(topic) === normalize(question.chapter)) {
    return [{ kind: 'topic_equals_chapter', field: 'topic', detail: `Topic "${topic}" repeats the chapter name.` }];
  }
  if (SECTION_LIKE_TOPIC.test(topic)) {
    return [{ kind: 'topic_looks_like_section', field: 'topic', detail: `Topic "${topic}" looks like a section label.` }];
  }
  return [];
}

function metadataRules(question: AuditQuestion): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const type = canonicalQuestionType(question.questionType);
  if (type.status === 'missing') {
    findings.push({ kind: 'type_missing', field: 'question_type', detail: 'No question type stored.' });
  } else if (type.status === 'unrecognised') {
    findings.push({ kind: 'type_not_a_type', field: 'question_type', detail: `"${question.questionType ?? ''}" is not a question type.` });
  } else if (!type.exact) {
    findings.push({ kind: 'type_nonstandard', field: 'question_type', detail: `"${question.questionType ?? ''}" → ${type.type}` });
  }
  if (question.subject === null || EMPTY_SUBJECT.test(question.subject)) {
    const shown = question.subject === null ? 'absent' : `"${question.subject}"`;
    findings.push({ kind: 'subject_missing', field: 'subject', detail: `Subject is ${shown}.` });
  }
  if (isBlank(question.chapter)) findings.push({ kind: 'chapter_missing', field: 'chapter', detail: 'No chapter stored.' });
  if (isBlank(question.exam)) findings.push({ kind: 'exam_missing', field: 'exam_name', detail: 'No exam stored.' });
  if (!QUESTION_LEVELS.some((level) => level === question.level)) {
    const stored = isBlank(question.level) ? 'not set' : `"${question.level ?? ''}"`;
    findings.push({ kind: 'level_missing', field: 'level', detail: `Difficulty is ${stored}.` });
  }
  return findings;
}

function contentRules(question: AuditQuestion, type: string | null): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const { options } = question;
  if (isBlank(question.questionText) && !question.isQuestionImage && isBlank(question.questionImage)) {
    findings.push({ kind: 'question_text_empty', field: 'question_text', detail: 'No question text and no question image.' });
  }
  const isChoiceType = type !== null && OPTION_ANSWER_TYPES.has(type);
  const hasOptionPictures = question.isOptionImage && question.optionImages.length >= 2;
  if (isChoiceType && question.matchColumns === null && options.length < 2 && !hasOptionPictures) {
    findings.push({ kind: 'mcq_options_missing', field: 'options', detail: `${String(options.length)} option(s) stored.` });
  }
  // Only a SHORT choice list is a defect: five or six options are legitimate (assertion-reason sets, "all
  // of the above" variants), while two or three usually means an option was lost in extraction.
  if ((type === 'single_correct' || type === 'multi_correct') && options.length >= 2 && options.length < 4) {
    findings.push({
      kind: 'mcq_option_count_unusual',
      field: 'options',
      detail: `Only ${String(options.length)} options; a choice question normally offers at least 4.`,
    });
  }
  // Numeric, Roman, and custom printed labels are all valid. Only a repeated *actual* label signals
  // that separate questions may have been folded into one row.
  const labels = options.map(optionLabel).filter((label): label is string => label !== null).map(optionLabelKey);
  const repeated = [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
  if (repeated.length > 0) {
    findings.push({
      kind: 'option_labels_repeat',
      field: 'options',
      detail: `${String(options.length)} options with ${repeated.map((l) => l.toUpperCase()).join(', ')} appearing twice — the row holds more than one question.`,
    });
  }
  if (question.optionImages.length === 0 && !question.isOptionImage) {
    const emptyAt = options.findIndex((option) => optionBody(option) === '');
    if (emptyAt !== -1) {
      findings.push({ kind: 'empty_option_text', field: `options[${String(emptyAt)}]`, detail: `Option ${String(emptyAt + 1)} has no text.` });
    }
    // Lowercased: two options differing only in capitalisation are still the same choice.
    const bodies = options.map((option) => optionBody(option).toLowerCase()).filter((body) => body !== '');
    if (new Set(bodies).size !== bodies.length) {
      findings.push({ kind: 'duplicate_options', field: 'options', detail: 'Two or more options have identical text.' });
    }
  }
  return findings;
}

function imageRules(question: AuditQuestion): RuleFinding[] {
  const findings: RuleFinding[] = [];
  if (question.isQuestionImage && isBlank(question.questionImage)) {
    findings.push({ kind: 'question_image_flag_without_url', field: 'question_image', detail: 'isQuestionImage is true but question_image is empty.' });
  }
  if (!question.isQuestionImage && !isBlank(question.questionImage)) {
    findings.push({ kind: 'question_image_url_without_flag', field: 'isQuestionImage', detail: 'question_image has a URL but isQuestionImage is false.' });
  }
  if (question.isOptionImage && question.optionImages.length === 0) {
    findings.push({ kind: 'option_image_flag_without_url', field: 'option_images', detail: 'isOptionImage is true but option_images is empty.' });
  }
  const reference = FIGURE_REFERENCE.exec(question.questionText);
  if (reference && !hasAnyImage(question)) {
    findings.push({ kind: 'figure_mentioned_without_image', field: 'question_text', detail: `Text says "${reference[0]}" but no image is attached.` });
  }
  return findings;
}

function structureRules(question: AuditQuestion, type: string | null): RuleFinding[] {
  const findings: RuleFinding[] = [];
  // A structural table itself is also a matrix signal: legacy rows sometimes lost or misspelled the
  // type string, but a `match_columns` payload must still obey the same invariant before it can be
  // presented as selectable answer choices.
  const isMatrix = type === 'matrix' || question.match !== null || question.matchColumns !== null;
  if (isMatrix) {
    if (question.matchColumns === null) {
      findings.push({ kind: 'matrix_missing_columns', field: 'match_columns', detail: 'Matching is stored only as answer text.' });
    }

    // The shared synthesis planner is the authority for whether a key is safe to turn into choices.
    // It rejects dangling rows, duplicate later-column labels, missing mappings, and non-round-trippable
    // labels — precisely the states that otherwise let a matrix look complete while selecting nonsense.
    const synthesis = question.match ? synthesizeMatrixChoiceOptions(question.match) : null;
    if (!synthesis || synthesis.status === 'blocked') {
      const ambiguous = synthesis?.reason === 'ambiguous_labels';
      findings.push({
        kind: ambiguous ? 'matrix_match_key_ambiguous' : 'matrix_match_key_incomplete',
        field: ambiguous ? 'match_columns' : 'match_key',
        detail: ambiguous
          ? 'A later-column label appears more than once, so a matching target is ambiguous. Rename the duplicate label.'
          : `The matrix cannot produce a complete answer-choice mapping${synthesis ? ` (${synthesis.reason.replace(/_/g, ' ')})` : ''}. Fill every Column-I mapping and remove invalid references.`,
      });
    }

    // A no-choice legacy/direct-response matrix is valid when its complete key can be normalised by
    // the planner above. Once any printed/generated panel exists, though, the answer must name exactly
    // one real option — a mapping string or two selected labels is not a selectable matrix answer.
    if (question.options.length > 0) {
      const labels = labelsOf(question.options);
      const selected = question.answer ? answerOptionLabels(question.answer, question.options) : [];
      const known = new Set((labels ?? []).map(optionLabelKey));
      const oneKnownSelection = selected.length === 1 && known.has(selected[0] ?? '');
      if (!oneKnownSelection) {
        findings.push({
          kind: 'matrix_choice_selection_invalid',
          field: 'answer',
          detail: question.answer?.trim()
            ? `Answer "${question.answer.trim()}" must select exactly one printed matrix option${labels ? ` (${labels.join(', ')})` : ''}.`
            : 'A matrix answer-choice panel has no selected option.',
        });
      }
    }
  }
  if (!isBlank(question.groupId) && isBlank(question.passage)) {
    findings.push({ kind: 'group_missing_passage', field: 'passage', detail: `In comprehension group ${question.groupId ?? ''} but has no passage text.` });
  }
  return findings;
}

/** Every per-question rule except LaTeX rendering and duplicates (which need a renderer / the whole bank). */
export function detectQuestionAnomalies(question: AuditQuestion): RuleFinding[] {
  const canonical = canonicalQuestionType(question.questionType);
  const type = canonical.status === 'known' ? canonical.type : null;
  return [
    ...answerRules(question, type),
    ...topicRules(question),
    ...metadataRules(question),
    ...contentRules(question, type),
    ...imageRules(question),
    ...structureRules(question, type),
  ];
}
