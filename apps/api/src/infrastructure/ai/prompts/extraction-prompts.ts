import type { Document } from '@ingest/contracts';

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
};

/** The question-extraction prompt for a document, chosen by its question type. */
export function questionPrompt(document: Document): string {
  const typeRule = document.questionType ? TYPE_RULES[document.questionType] : undefined;
  return [
    `You are given an image of an exam question paper (${context(document)}).`,
    BASE_RULES.trim(),
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
