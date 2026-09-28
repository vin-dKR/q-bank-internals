import { fillTokens, resolvePrompt, type PromptOverrides } from '../../../modules/prompts/index.js';

/**
 * Kept outside the operator-editable base prompt so an inline-paper scan cannot accidentally lose
 * its destination guard when somebody customises the ordinary question-paper detector wording.
 * An answer/solution target is useful only when the page itself labels that field; otherwise it is
 * safer to leave the figure as a normal question/option candidate than to attach it to the wrong
 * published field.
 */
const INLINE_FIELD_TARGET_RULES = `

=============================
INLINE ANSWER / SOLUTION FIELDS
=============================
This is a QUESTION PDF that may print an answer key and/or worked explanation INLINE with each
numbered question. In addition to "question" and "option", you may set a detection's "target" to
"answer" or "solution" ONLY when all of the following are visibly true:
1. The graphic sits inside the SAME numbered question block (from this question number up to, but
   not including, the next numbered QUESTION).
2. A nearby explicit printed field marker identifies it: "Ans.", "Answer", "Answer key", "Sol.",
   "Solution", "Explanation", or an unambiguous equivalent.
3. The marker identifies the figure's FIELD, not merely a cross-reference in prose.

Use "answer" for a figure under an explicit answer/final-answer marker. Use "solution" for a figure
under an explicit solution/explanation/working marker. Do NOT infer either target from position,
colour, a nearby formula, or the fact that the question is already answered. If the evidence is not
explicit, return "question" or "option" as usual. Preserve the question number and first-line
snippet for every inline-field figure. Several distinct answer or solution figures for one question
must be returned as separate tight boxes.`;

/**
 * Diagram-detection prompt, ported from the Python image-auto-cropper
 * (`backend/services/openai_detector.py`). The default wording is faithful to the original — vision
 * models are sensitive to phrasing — but the operator can override it from the prompt settings; the
 * `{imgWidth}`/`{imgHeight}` tokens are filled with the page's pixel dimensions here.
 */
export function detectorPrompt(
  imgWidth: number,
  imgHeight: number,
  overrides: PromptOverrides,
  options: { inlineAnswerFields?: boolean } = {},
): string {
  const base = fillTokens(resolvePrompt(overrides, 'detection'), { imgWidth, imgHeight });
  return options.inlineAnswerFields ? `${base}${INLINE_FIELD_TARGET_RULES}` : base;
}
