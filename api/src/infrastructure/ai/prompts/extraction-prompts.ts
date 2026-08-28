import type { Document } from '@ingest/contracts';
import { topicBindingForPage } from '../../../modules/extraction/index.js';

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

const BASE_RULES = `
Extract ONLY the core information for each question into this exact JSON shape:

{
  "questions": [
    { "question_number": 1, "question_text": "…", "options": ["(A) …", "(B) …", "(C) …", "(D) …"] }
  ]
}

EXTRACTION RULES:
1. Only these three fields per question: question_number, question_text, options.
2. question_number: the number printed next to the question (1, 2, 3, …).
3. question_text: the complete question text, including any passage and math (use LaTeX like \\( \\sqrt{3} \\)).
4. options: an array of strings, always prefixed and normalized as "(A) …", "(B) …", "(C) …", "(D) …".
5. Normalize option labels printed as (1)(2)(3)(4) to (A)(B)(C)(D).
6. Do NOT repeat a shared comprehension passage inside every question_text — a comprehension paper is handled by the TYPE-SPECIFIC RULE below.
7. For subjective questions with no options, use an empty array [].
8. If — and ONLY if — the page itself prints the correct answer or a worked solution for a question, add optional "answer" (the correct option letter(s) or numeric/text value) and/or "explanation" (the printed working) fields to that question. Question papers usually do NOT show these; when the page does not, OMIT both fields and never guess.
9. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.
`;

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
 * Extra rule appended when a page's segment is marked PYQ. Asks the model to read each question's
 * SOURCE exam + year printed on the page (distinct from the target exam/subject in the context line)
 * and return them per-question, never guessed. The worker stamps these onto `question.pyqExam`/`pyqYear`.
 */
const PYQ_RULE = `
PREVIOUS-YEAR QUESTION (PYQ) RULE:
These are previous-year exam questions. For EACH question, read the SOURCE exam and year printed on the page — usually shown beside the question, e.g. "[NEET 2019]", "(JEE Main 2021)", "AIEEE 2011" — and add these two fields to that question object:
- "pyq_exam": the exam the question originally appeared in (e.g. "NEET", "JEE Main"). Omit when the page does not print it.
- "pyq_year": the year as printed (e.g. "2019"). Omit when the page does not print it.
This SOURCE exam/year is distinct from the target exam/subject in the context above. Never guess; omit any field the page does not actually show.
`;

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
 * the persisted questions.
 */
export function questionPrompt(document: Document, pageNumber: number): string {
  const binding = topicBindingForPage(document.topics, pageNumber);
  const questionType = binding?.questionType ?? document.questionType;
  const typeRule = questionType ? TYPE_RULES[questionType] : undefined;
  const bindingNote = binding
    ? `This page belongs to the topic "${binding.matchKey}" and its questions are of the fixed type "${binding.questionType}", chosen by the operator. Extract the questions exactly as printed for that type — do NOT re-classify them or invent a different type.`
    : '';
  return [
    `You are given an image of an exam question paper (${context(document)}).`,
    bindingNote,
    BASE_RULES.trim(),
    typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : '',
    resolvePyq(document, binding) ? PYQ_RULE.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n');
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
  return [
    'You are given an image of one page from an exam question paper.',
    `Re-read the SINGLE question printed as number ${
      target.questionNumber === null ? '(unknown)' : String(target.questionNumber)
    }${hint ? `, which begins: "${hint}"` : ''} and extract only that one question.`,
    `Return ONLY this exact JSON shape:

{
  "stem": "the full question text, math as LaTeX like \\\\( \\\\sqrt{3} \\\\)",
  "options": [ { "label": "A", "body": "…", "is_correct": false } ],
  "answer": "the correct option label(s) e.g. \\"A\\" or \\"AC\\", a numeric/text answer, or \\"\\" if the page does not state it",
  "explanation": "the worked solution if the page prints one, else null"
}`,
    `RE-EXTRACT RULES:
1. Extract ONLY the target question — ignore every other question on the page.
2. options: one entry per printed choice; normalize labels (1)(2)(3)(4) to (A)(B)(C)(D). Set is_correct true only when the page marks that choice as correct, else false.
3. For a question with no options, use an empty array [].
4. answer: use "" when the page does not indicate the correct answer (question papers usually do not).
5. explanation: use null when no worked solution is printed on this page.
6. Preserve all math as LaTeX. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`,
    typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The answer-key extraction prompt, returning one entry per section found on the sheet. The page's
 * resolved question type (topic binding, else document type — the same resolution the question prompt
 * uses) selects a type-specific rule so the answer VALUE is formatted correctly for that type.
 */
export function answerPrompt(document: Document, pageNumber: number): string {
  const questionType = resolveQuestionType(document, pageNumber);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  return [
    `You are given an image of an exam answer sheet (${context(document)}).
Extract the answer key for EVERY section visible in the image into this exact JSON shape:

{
  "sections": [
    { "section_name": "Exercise O-1", "answers": { "1": "A", "2": "B", "3": "C" } }
  ]
}

ANSWER RULES:
1. Include ALL sections in the image; question numbers may restart per section.
2. answers keys are the question numbers as strings ("1", "2", …).
3. Format each answer value exactly as the ANSWER TYPE-SPECIFIC RULE below requires.
4. If no section name is printed, use "General".
5. Use LaTeX for math; return valid, complete JSON only — no prose, no trailing commas.`,
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
export function solutionPrompt(document: Document, pageNumber: number): string {
  const questionType = resolveQuestionType(document, pageNumber);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  return [
    `You are given an image from an exam SOLUTIONS booklet (${context(document)}).
Extract the worked solution for EVERY question visible in the image into this exact JSON shape:

{
  "sections": [
    {
      "section_name": "Exercise O-1",
      "solutions": {
        "1": { "answer": "A", "explanation": "Step-by-step reasoning …" }
      }
    }
  ]
}

SOLUTION RULES:
1. Include ALL sections in the image; question numbers may restart per section.
2. solutions keys are the question numbers as strings ("1", "2", …).
3. explanation: the complete worked solution / reasoning as printed, preserving math as LaTeX (e.g. \\( \\sqrt{3} \\)). Do NOT summarise or omit steps.
4. answer: the final answer if the solution states one, formatted exactly as the ANSWER TYPE-SPECIFIC RULE below requires; use null if no final answer is given.
5. If no section name is printed, use "General".
6. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`,
    typeRule ? `ANSWER TYPE-SPECIFIC RULE:\n${typeRule}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
