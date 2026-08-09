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
6. For a comprehension passage, include the passage at the start of question_text.
7. For subjective questions with no options, use an empty array [].
8. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.
`;

const TYPE_RULES: Record<string, string> = {
  single_correct:
    'This is a SINGLE CORRECT type: exactly four options (A)(B)(C)(D), exactly one correct.',
  multi_correct:
    'This is a MULTIPLE CORRECT type: four options (A)(B)(C)(D), one or more may be correct.',
  integer: 'This is an INTEGER type: the answer is a number; options is usually an empty array [].',
  matrix:
    'This is a MATRIX MATCH type: preserve both columns in question_text; options list the match rows.',
  comprehension:
    'This is a COMPREHENSION type: include the shared passage at the start of each question_text.',
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
    ? `This page belongs to the topic "${binding.topicName}" and its questions are of the fixed type "${binding.questionType}", chosen by the operator. Extract the questions exactly as printed for that type — do NOT re-classify them or invent a different type.`
    : '';
  return [
    `You are given an image of an exam question paper (${context(document)}).`,
    bindingNote,
    BASE_RULES.trim(),
    typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : '',
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

/** The answer-key extraction prompt, returning one entry per section found on the sheet. */
export function answerPrompt(document: Document): string {
  return `You are given an image of an exam answer sheet (${context(document)}).
Extract the answer key for EVERY section visible in the image into this exact JSON shape:

{
  "sections": [
    { "section_name": "Exercise O-1", "answers": { "1": "A", "2": "B", "3": "C" } }
  ]
}

ANSWER RULES:
1. Include ALL sections in the image; question numbers may restart per section.
2. answers keys are the question numbers as strings ("1", "2", …).
3. Single-correct answers are a letter ("A"–"D"); multiple-correct join letters ("AC"); numeric/text answers verbatim.
4. If no section name is printed, use "General".
5. Use LaTeX for math; return valid, complete JSON only — no prose, no trailing commas.`;
}

/**
 * The worked-solution extraction prompt. A solution PDF has the reasoning/steps for each question,
 * and usually restates the final answer. We capture BOTH so the solution can back-fill an answer the
 * answer sheet was missing, while also giving the verifier the full explanation text.
 */
export function solutionPrompt(document: Document): string {
  return `You are given an image from an exam SOLUTIONS booklet (${context(document)}).
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
4. answer: the final answer if the solution states one (letter "A"–"D", joined letters like "AC", or a numeric/text value); use null if no final answer is given.
5. If no section name is printed, use "General".
6. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`;
}
