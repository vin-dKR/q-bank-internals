import { ANOMALY_KINDS, type AiFixField, type AnomalyGroup, type AnomalyKind } from '@ingest/contracts';

/**
 * What a run should do for the selected rule: which fields to ask for, and whether the stored value is the
 * thing being corrected.
 *
 * `overwrite: false` means fill only what is empty — a run for missing topics must not touch an answer that
 * is already there. `overwrite: true` is for rules where the stored value IS the defect (an answer naming a
 * label its options do not use, a topic that just repeats the chapter name).
 */
export type RulePlan = { fields: AiFixField[]; overwrite: boolean; reason: string };

const PLANS: Partial<Record<AnomalyKind, RulePlan>> = {
  topic_missing: { fields: ['topic'], overwrite: false, reason: 'these questions have no topic' },
  topic_equals_chapter: { fields: ['topic'], overwrite: true, reason: 'the stored topic just repeats the chapter' },
  topic_looks_like_section: { fields: ['topic'], overwrite: true, reason: 'the stored topic is an exercise label' },
  answer_missing: { fields: ['answer', 'solution'], overwrite: false, reason: 'these questions have no answer' },
  answer_missing_subjective: { fields: ['answer', 'solution'], overwrite: false, reason: 'these subjective questions have no answer' },
  answer_placeholder: { fields: ['answer', 'solution'], overwrite: true, reason: 'the stored answer is placeholder text' },
  answer_not_in_options: { fields: ['answer'], overwrite: true, reason: 'the stored answer names a label the options do not use' },
  single_correct_multiple_answers: { fields: ['answer'], overwrite: true, reason: 'the stored answer lists several options' },
  integer_answer_not_numeric: { fields: ['answer'], overwrite: true, reason: 'the stored answer is not a number' },
  level_missing: { fields: ['level'], overwrite: false, reason: 'these questions are not graded' },
  matrix_missing_columns: { fields: ['structure'], overwrite: false, reason: 'these matrix questions lost their match table' },
  group_missing_passage: { fields: ['structure'], overwrite: false, reason: 'these comprehension questions lost their passage' },
};

/** Which rules mean a field is missing, so the filtered counts say what this selection actually needs. */
const RULES_PER_FIELD: Record<AiFixField, AnomalyKind[]> = {
  topic: ['topic_missing'],
  answer: ['answer_missing', 'answer_missing_subjective'],
  level: ['level_missing'],
  // Nothing flags a missing solution, so it is never demanded on its own — it rides along with an answer.
  solution: [],
  // A lost match table or a passage-less comprehension row: both are shapes the AI can rebuild.
  structure: ['matrix_missing_columns', 'group_missing_passage'],
};

/** How many questions in the current selection are missing each field; null where no rule measures it. */
export function fieldNeeds(counts: readonly { kind: AnomalyKind; count: number }[]): Record<AiFixField, number | null> {
  const by = new Map(counts.map((row) => [row.kind, row.count] as const));
  const total = (field: AiFixField): number | null => {
    const rules = RULES_PER_FIELD[field];
    if (rules.length === 0) return null;
    return rules.reduce((sum, rule) => sum + (by.get(rule) ?? 0), 0);
  };
  return { topic: total('topic'), answer: total('answer'), solution: null, level: total('level'), structure: total('structure') };
}

/**
 * What to run for the current selection. A chosen rule speaks for itself. Otherwise the FILTERED counts
 * decide: a chapter whose answers are all present should not have Answer ticked, because ticking it would
 * spend money asking about fields that are already filled.
 */
export function planFor(
  kind: AnomalyKind | '',
  group: AnomalyGroup | '',
  counts: readonly { kind: AnomalyKind; count: number }[],
): RulePlan {
  if (kind !== '') {
    return PLANS[kind] ?? { fields: fieldsForGroup(ANOMALY_KINDS[kind].group), overwrite: false, reason: 'fills whatever is missing' };
  }

  const needs = fieldNeeds(counts);
  const missing = (['topic', 'answer', 'level', 'structure'] as const).filter((field) => (needs[field] ?? 0) > 0);
  if (missing.length === 0) {
    return { fields: fieldsForGroup(group), overwrite: false, reason: 'nothing here is measurably missing' };
  }
  const reason = missing
    .map((field) => {
      const count = (needs[field] ?? 0).toLocaleString();
      if (field === 'level') return `${count} ungraded`;
      if (field === 'structure') return `${count} with a lost table or passage`;
      return `${count} missing ${field}s`;
    })
    .join(' and ');
  return {
    // A worked solution is worth having wherever an answer is being written.
    fields: missing.includes('answer') ? [...missing, 'solution'] : missing,
    overwrite: false,
    reason: `this selection has ${reason}`,
  };
}

/** A group with no rule chosen and no counts yet: ask for what that group is about. */
function fieldsForGroup(group: AnomalyGroup | ''): AiFixField[] {
  if (group === 'topic') return ['topic'];
  if (group === 'answer') return ['answer', 'solution'];
  if (group === 'structure') return ['structure'];
  return ['topic', 'answer', 'solution', 'level', 'structure'];
}

/** What the AI should be asked for on ONE question, and the sentence explaining why those boxes are ticked. */
export type QuestionPlan = { fields: AiFixField[]; reason: string };

/** Rules that mean a field's STORED value is the defect, so the AI is asked for it even though it is filled. */
const WRONG_VALUE_RULES: Record<'topic' | 'answer', AnomalyKind[]> = {
  topic: ['topic_equals_chapter', 'topic_looks_like_section'],
  answer: ['answer_placeholder', 'answer_not_in_options', 'single_correct_multiple_answers', 'integer_answer_not_numeric'],
};

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * What this one question could use from the AI: a field it has nothing for, or one whose stored value a rule
 * says is wrong. A field that is already filled and unflagged is never asked for — regenerating it would
 * spend tokens to overwrite good data.
 */
function questionNeeds(question: QuestionFields, open: readonly AnomalyKind[]): { field: AiFixField; why: string }[] {
  const flagged = (field: 'topic' | 'answer'): boolean => WRONG_VALUE_RULES[field].some((rule) => open.includes(rule));
  const needs: { field: AiFixField; why: string }[] = [];
  if (isBlank(question.topic)) needs.push({ field: 'topic', why: 'has no topic' });
  else if (flagged('topic')) needs.push({ field: 'topic', why: 'has a topic that is not a real topic' });
  if (isBlank(question.answer)) needs.push({ field: 'answer', why: 'has no answer' });
  else if (flagged('answer')) needs.push({ field: 'answer', why: 'has an answer that does not fit it' });
  // A worked solution is never demanded on its own — it rides along with an answer being written.
  if (needs.some((need) => need.field === 'answer') && isBlank(question.explanation)) {
    needs.push({ field: 'solution', why: 'has no worked solution' });
  }
  if (question.level === null) needs.push({ field: 'level', why: 'is not graded' });
  // Structure is asked for only when a rule says the shape is missing — never on a question that has one.
  if (open.includes('matrix_missing_columns')) needs.push({ field: 'structure', why: 'is a matrix question with no match table' });
  else if (open.includes('group_missing_passage')) needs.push({ field: 'structure', why: 'is part of a comprehension with no passage' });
  return needs;
}

/** The fields of one question the plan reads. */
export type QuestionFields = {
  topic: string | null;
  answer: string | null;
  explanation: string | null;
  level: string | null;
  /** The structured matching, when this is a matrix question that still has one. */
  match: unknown;
  /** The shared passage, when this row belongs to a comprehension group. */
  passage: string | null;
};

/**
 * Which boxes to tick for one question, from what it is missing NARROWED to the rule or group being worked
 * on — so "Answer" in the tree asks for an answer, not a topic the question happens to be missing too.
 */
export function planForQuestion(
  question: QuestionFields,
  open: readonly AnomalyKind[],
  kind: AnomalyKind | '',
  group: AnomalyGroup | '',
): QuestionPlan {
  const needs = questionNeeds(question, open);
  const scope = kind !== '' ? (PLANS[kind]?.fields ?? fieldsForGroup(ANOMALY_KINDS[kind].group)) : fieldsForGroup(group);
  const wanted = needs.filter((need) => scope.includes(need.field));
  // The rule says this question needs the field even if the value looks fine (it is in the queue BECAUSE of
  // that rule), so its own fields win when the question itself shows nothing to fill.
  const fields = wanted.length > 0 ? wanted.map((need) => need.field) : kind !== '' ? scope : [];
  // Read as a whole sentence by the panel, which prefixes the others with "Ticked because".
  if (fields.length === 0) return { fields, reason: 'Nothing here for the AI — everything it can work out is already filled in.' };
  const why = wanted.length > 0 ? wanted.map((need) => need.why) : ['matches the rule you picked'];
  return { fields, reason: `Ticked because this question ${[...new Set(why)].join(', ')}.` };
}
