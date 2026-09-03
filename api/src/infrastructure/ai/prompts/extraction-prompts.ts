import type { Document } from '@ingest/contracts';
import { PAPER_METADATA_FIELDS } from '@ingest/contracts';
import { topicBindingForPage } from '../../../modules/extraction/index.js';
import { fillTokens, resolvePrompt, type PromptOverrides } from '../../../modules/prompts/index.js';

/**
 * Prompts ported from the Python PDF Extractor (`backend/prompts/*.py`). The JSON envelopes are
 * adapted to top-level objects so they satisfy OpenAI's `response_format: json_object` (the Python
 * version returned a bare array for answers). Question types map to the extra rule blocks.
 */

function context(document: Document): string {
  const parts = [
    `Module: ${document.path.module}`,
    `Chapter: ${document.path.chapter}`,
    document.sectionName ? `Section: ${document.sectionName}` : `Section: ${document.path.section}`,
  ];
  if (document.questionType) parts.push(`Question type: ${document.questionType}`);
  return parts.join(' | ');
}

const TYPE_RULES: Record<string, string> = {
  single_correct:
    'This is a SINGLE CORRECT type: exactly four options (A)(B)(C)(D), exactly one correct.',
  multi_correct:
    'This is a MULTIPLE CORRECT type: four options (A)(B)(C)(D), one or more may be correct.',
  integer: 'This is an INTEGER type: the answer is a number; options is usually an empty array [].',
  matrix:
    'This is a MATRIX MATCH (match-the-column) type. Return ONE JSON entry for the whole question. Put ONLY the instruction/stem (e.g. "Match Column I with Columns II and III") in question_text — do NOT copy the columns into it — and leave options as an empty array []. Add a "columns" field: an array of EVERY column in printed order (there are usually TWO, sometimes THREE), each { "title": the column heading e.g. "Column I (Velocity)", "entries": [ { "label": the printed label e.g. "A"/"p"/"t", "body": that entry\'s text with math as LaTeX } ] }. If the page prints the correct matching, also add a "match" field mapping each FIRST-column label to the labels it matches, e.g. { "A": ["p","t"], "B": ["q","u"] }; omit it when the answer is not shown on the question page.',
  comprehension:
    'This is a COMPREHENSION type: a shared passage is followed by several sub-questions. Return ONE JSON entry PER SUB-QUESTION. Put ONLY that sub-question\'s own text in question_text — do NOT copy the passage into it. Add a "passage" field to every sub-question carrying the FULL shared passage VERBATIM, byte-for-byte IDENTICAL across all sub-questions that share it (this is how they are grouped into one question). question_number is each sub-question\'s printed number; options are that sub-question\'s own choices.',
  assertion_reason:
    'This is an ASSERTION-REASON type: question_text contains both the Assertion (A) and the Reason (R) statements; options are the four standard evaluations of A and R.',
  true_false:
    'This is a TRUE/FALSE type: each question is judged true or false; options are "(A) True", "(B) False" unless the paper prints other choices.',
  fill_blank:
    'This is a FILL IN THE BLANK type: keep the blank marker (e.g. ______) inside question_text; options is usually an empty array [].',
  subjective:
    'This is a SUBJECTIVE/DESCRIPTIVE type: there are no options — use an empty array []; capture the complete question text.',
};

/**
 * Per-type rules for the ANSWER-KEY and SOLUTION prompts. Answer formats differ sharply per question
 * type (a single letter vs. joined letters vs. a number vs. a label→labels map), so each type gets a
 * precise instruction for what the answer VALUE must look like. These are appended to
 * {@link answerPrompt} / {@link solutionPrompt}; where a rule mentions the explanation it applies to
 * the solution prompt (the answer sheet stores only the value).
 */
const ANSWER_TYPE_RULES: Record<string, string> = {
  single_correct:
    'SINGLE CORRECT: each answer is exactly ONE uppercase option letter "A"–"D" (normalize (1)(2)(3)(4) to A/B/C/D).',
  multi_correct:
    'MULTIPLE CORRECT: each answer is EVERY correct option letter, uppercase, sorted alphabetically and JOINED with NO separator — e.g. "AC" or "ABD".',
  integer:
    'INTEGER / NUMERICAL: each answer is the exact numeric value as printed (integer or decimal), with no surrounding text and no units unless the printed answer itself carries them.',
  matrix:
    'MATRIX MATCH: each answer is the first-column label → matched labels mapping, written one first-column label per group and joining that group\'s labels with commas — e.g. "A→P,Q; B→R; C→S,T; D→P". Mirror the printed matching exactly (same shape as the question\'s "match" field).',
  assertion_reason:
    'ASSERTION-REASON: each answer is the single chosen option letter for the standard evaluation of the Assertion and the Reason. In the explanation, state which of the Assertion and the Reason are true and whether the Reason correctly explains the Assertion.',
  comprehension:
    'COMPREHENSION: give ONE answer PER SUB-QUESTION, keyed by that sub-question\'s own printed number (each sub-question is a separate entry); each value is the option letter(s) or value for that sub-question.',
  true_false:
    'TRUE/FALSE: each answer is "True" or "False" — or the printed option letter (e.g. "A" for True, "B" for False) when the paper labels the choices.',
  fill_blank:
    'FILL IN THE BLANK: each answer is the exact word/phrase/value that fills the blank, verbatim, with math as LaTeX.',
  subjective:
    'SUBJECTIVE/DESCRIPTIVE: there is no single letter — give the key final answer/result concisely as the answer; the full working belongs in the explanation.',
};

/**
 * Resolve the question type for a page exactly as the persisted questions are stamped: the operator's
 * topic binding when the page is covered by a block (fixed, so the model cannot re-classify), else the
 * document-level type. Shared by the question, answer, and solution prompts so all three agree.
 */
function resolveQuestionType(document: Document, pageNumber: number): string | null {
  return topicBindingForPage(document.topics, pageNumber)?.questionType ?? document.questionType;
}

/**
 * Whether the questions on a page should be extracted as PYQ: the segment's per-node toggle when the
 * page is covered by a block, else the document-level PYQ flag (legacy whole-chapter PYQ uploads).
 */
function resolvePyq(document: Document, binding: ReturnType<typeof topicBindingForPage>): boolean {
  return binding?.pyq ?? document.pyq;
}

/**
 * The question-extraction prompt for one page of a document. The question type comes from the
 * operator's topic config when the page is covered by a block (stated as fixed so the model cannot
 * re-classify), else from the document-level question type — exactly mirroring how the worker stamps
 * the persisted questions. When the paper's answer layout is `inline`, an extra rule tells the model
 * to read each question's printed answer key in the same pass (no sibling answer sheet exists).
 */
export function questionPrompt(
  document: Document,
  pageNumber: number,
  overrides: PromptOverrides,
): string {
  const binding = topicBindingForPage(document.topics, pageNumber);
  const questionType = binding?.questionType ?? document.questionType;
  const typeRule = questionType ? TYPE_RULES[questionType] : undefined;
  const bindingNote = binding
    ? `This page belongs to the topic "${binding.matchKey}" and its questions are of the fixed type "${binding.questionType}", chosen by the operator. Extract the questions exactly as printed for that type — do NOT re-classify them or invent a different type.`
    : '';
  return [
    `You are given an image of an exam question paper (${context(document)}).`,
    bindingNote,
    resolvePrompt(overrides, 'extraction'),
    typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : '',
    document.answerLayout === 'inline' ? resolvePrompt(overrides, 'inlineAnswer') : '',
    resolvePyq(document, binding) ? resolvePrompt(overrides, 'pyq') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Prompt for the AI-fill of the PYQ paper-details form. Given ONE rendered page image (the paper's
 * header/first page), read the whole-paper metadata printed on it into a flat JSON object keyed by
 * exactly the {@link PAPER_METADATA_FIELDS} keys. Every field is optional — return only what the page
 * actually prints, an empty string for anything it does not, and never guess.
 */
export function paperMetadataPrompt(): string {
  const fieldLines = PAPER_METADATA_FIELDS.map(
    ({ key, hint, placeholder }) => `- "${key}": ${hint} (e.g. ${placeholder}).`,
  ).join('\n');
  return [
    'You are given an image of the header / first page of a previous-year examination paper (e.g. the title block that names the exam, year, date, and shift).',
    'Read the whole-paper metadata printed on it and return ONLY this exact JSON shape:',
    `{\n${PAPER_METADATA_FIELDS.map(({ key }) => `  "${key}": "…"`).join(',\n')}\n}`,
    `FIELD MEANINGS:\n${fieldLines}`,
    'RULES:\n1. Include every key above. Use an empty string "" for any field the page does not print — never guess or infer a value that is not shown.\n2. Copy values verbatim as printed (e.g. keep "Morning Shift", "02 April 2026"); normalise an obvious date to YYYY-MM-DD only when the parts are unambiguous.\n3. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.',
  ].join('\n\n');
}

/**
 * Re-extract ONE already-extracted question from its source page (the verify screen's "read the page
 * again" button). Unlike {@link questionPrompt}, which pulls every question on the page, this targets
 * a single question by its printed number (with the current stem as a fallback hint) and asks for all
 * four editable fields — including any answer/explanation the page itself happens to print.
 */
export function reExtractQuestionPrompt(target: {
  questionNumber: number | null;
  stemHint: string;
  questionType: string | null;
}): string {
  const hint = target.stemHint.replace(/\s+/g, ' ').trim().slice(0, 120);
  const typeRule = target.questionType ? TYPE_RULES[target.questionType] : undefined;
  const isMatrix = target.questionType === 'matrix';
  return [
    'You are given an image of one page from an exam question paper.',
    `Re-read the SINGLE question printed as number ${
      target.questionNumber === null ? '(unknown)' : String(target.questionNumber)
    }${hint ? `, which begins: "${hint}"` : ''} and extract only that one question.`,
    `Return ONLY this exact JSON shape:

{
  "stem": "the full question text, math as LaTeX like \\\\( \\\\sqrt{3} \\\\)",
  "options": [ { "label": "A", "body": "…", "is_correct": false } ],
  "columns": [ { "title": "Column I", "entries": [ { "label": "A", "body": "…" } ] } ],
  "match": { "A": ["p"], "B": ["q","s"] },
  "answer": "the correct option label(s) e.g. \\"A\\" or \\"AC\\", a numeric/text answer, or \\"\\" if the page does not state it",
  "explanation": "the worked solution if the page prints one, else null"
}`,
    `RE-EXTRACT RULES:
1. Extract ONLY the target question — ignore every other question on the page.
2. options: one entry per printed choice. The "label" MUST be exactly one of "A","B","C","D" in printed order (normalize (1)(2)(3)(4) to A/B/C/D). NEVER emit any other label, never repeat a label, never merge labels (no "AAPB", no column labels like "p"/"q"). Set is_correct true only when the page marks that choice as correct, else false.
3. For a question with no options, use an empty array [].
4. columns/match: leave "columns" as [] and OMIT "match" UNLESS this is a MATRIX MATCH question (see the type-specific rule).
5. answer: use "" when the page does not indicate the correct answer (question papers usually do not).
6. explanation: use null when no worked solution is printed on this page.
7. Preserve all math as LaTeX. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`,
    isMatrix
      ? 'MATRIX MATCH: put ONLY the instruction/stem in "stem" — do NOT copy the columns into it. Fill "columns" — an array of EVERY printed column in order (usually two, sometimes three), each { "title": the heading, "entries": [ { "label": the printed label e.g. "A"/"p"/"t", "body": that entry\'s text with math as LaTeX } ] }. ALSO fill "options" with the printed multiple-choice ANSWERS (usually four), each { "label": one of "A"–"D" in printed order (normalize (1)(2)(3)(4)), "body": that choice\'s FULL matching text EXACTLY as printed, e.g. "A-i, B-ii, C-iii, D-iv, E-v", "is_correct": true only for the choice the page marks correct else false }. When the page prints the matching (or marks the correct option), add "match" mapping each first-column label to the labels it matches, e.g. { "A": ["iv"], "B": ["v"] }; omit "match" when no answer is shown.'
      : (typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : ''),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The answer-key extraction prompt, returning one entry per section found on the sheet. The page's
 * resolved question type (topic binding, else document type — the same resolution the question prompt
 * uses) selects a type-specific rule so the answer VALUE is formatted correctly for that type.
 */
export function answerPrompt(
  document: Document,
  pageNumber: number,
  overrides: PromptOverrides,
): string {
  const questionType = resolveQuestionType(document, pageNumber);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  return [
    fillTokens(resolvePrompt(overrides, 'answerKey'), { context: context(document) }),
    typeRule ? `ANSWER TYPE-SPECIFIC RULE:\n${typeRule}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The worked-solution extraction prompt. A solution PDF has the reasoning/steps for each question,
 * and usually restates the final answer. We capture BOTH so the solution can back-fill an answer the
 * answer sheet was missing, while also giving the verifier the full explanation text.
 */
export function solutionPrompt(
  document: Document,
  pageNumber: number,
  overrides: PromptOverrides,
): string {
  const questionType = resolveQuestionType(document, pageNumber);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  return [
    fillTokens(resolvePrompt(overrides, 'solution'), { context: context(document) }),
    typeRule ? `ANSWER TYPE-SPECIFIC RULE:\n${typeRule}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
