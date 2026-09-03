import type { PromptKey } from '@ingest/contracts';

/**
 * The single source of truth for every editable AI prompt: its default text (with `{token}` placeholders
 * where the builder substitutes run-time values) and the operator-facing metadata. The prompt builders
 * read the effective text through {@link resolvePrompt}; the prompts API lists these defaults so the UI
 * can show, edit, and reset each one. Adding a prompt is: a key in the contract + an entry here + one
 * builder line.
 */

/** A sparse map of operator overrides, keyed by prompt; a missing key means "use the default". */
export type PromptOverrides = Partial<Record<PromptKey, string>>;

const EXTRACTION_DEFAULT = `Extract ONLY the core information for each question into this exact JSON shape:

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
9. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`;

const INLINE_ANSWER_DEFAULT = `INLINE ANSWER-KEY RULE (this paper prints each answer next to its question):
This is an inline-answer paper: the correct answer — and often a worked solution/explanation — is printed immediately after each question, before the next question begins (e.g. "Answer Key : (3)", "Ans. (B)", "Sol. …"). For EVERY question you MUST:
- Read that question's OWN printed answer and put it in that question's "answer" field, formatted per the TYPE-SPECIFIC RULE (normalize (1)(2)(3)(4) to A/B/C/D for option types; the exact number for integer/numerical types).
- Also mark the matching option's correctness where options are extracted.
- If a worked solution/explanation is printed for that question, put its FULL text (math as LaTeX) in that same question's "explanation" field; omit "explanation" only when none is printed.
CRITICAL PAIRING: the answer and explanation belong to the question they are printed under — never attach question N's answer or explanation to question N+1. The next numbered question marks the boundary; everything between question N and question N+1 (its answer + solution) is question N's. Never guess an answer or explanation the page does not print.`;

const PYQ_DEFAULT = `PREVIOUS-YEAR QUESTION (PYQ) RULE:
These are previous-year exam questions. For EACH question, read the SOURCE exam and year printed on the page — usually shown beside the question, e.g. "[NEET 2019]", "(JEE Main 2021)", "AIEEE 2011" — and add these two fields to that question object:
- "pyq_exam": the exam the question originally appeared in (e.g. "NEET", "JEE Main"). Omit when the page does not print it.
- "pyq_year": the year as printed (e.g. "2019"). Omit when the page does not print it.
This SOURCE exam/year is distinct from the target exam/subject in the context above. Never guess; omit any field the page does not actually show.`;

const DETECTION_DEFAULT = `You are an expert OCR and layout-analysis system for scanned examination papers.

The attached image is a question paper. Its pixel dimensions are {imgWidth} px wide × {imgHeight} px tall.

=============================
TASK: DETECT DIAGRAMS
=============================
1. Identify every question by its number (1, 2, 3 … or Q1, Q2 …).
2. For each question, detect if there is an associated GRAPHICAL ELEMENT (diagram, figure, graph, illustration, or shape).
   A single question may have SEVERAL graphical elements: one in its stem, and/or one inside EACH of its
   answer options when the options themselves are pictures. Report every element as its own entry in
   "detections" (repeating the same q_no).
3. Provide a TIGHT bounding box around only the visual/graphical pixels of that element. Trace the
   outermost ink of the diagram (including its labels only when they are part of the diagram), then add
   at most 4 pixels of padding. Do not include surrounding whitespace, question prose, answer text,
   option labels, page decorations, or another nearby diagram.
4. For every question that HAS a diagram, also copy the first line of that question's text verbatim
   (the words right after the question number, up to ~12 words) into "question_text". This is used to
   attach the cropped figure to the correct question, so transcribe it exactly as printed.
5. Separately, for EVERY numbered question on the page (whether or not it has a diagram), report its
   position: "y_top" = the vertical pixel (0 … {imgHeight}) of the TOP of that question's
   first line, and "x_left" = the horizontal pixel (0 … {imgWidth}) of the LEFT edge of the
   question number. A cropped figure is attached to the question directly above it in the SAME COLUMN
   using these values, so on a two-column page x_left must correctly place each question in its column.

CORE RULES:
  1. The bbox MUST correspond to the ACTUAL POSITION of the diagram/drawing in the image.
  2. The bbox must NOT include question text, numbers, or option labels unless they are integral parts of the drawing.
  3. Do NOT simply box the question label area; you must find the graphic itself wherever it is located in the original image.
  4. If a question has no diagram or graphic, set has_image=false and bbox=null.
  5. If a question has a diagram, set has_image=true and provide the bbox.
  6. Set "target" to "question" when the diagram belongs to the question stem, or "option" when it
     belongs inside an answer choice. For option figures, set "option_label" to that choice's printed
     label (for example "A"); otherwise use null.
  7. When the answer choices (A)/(B)/(C)/(D) or (1)/(2)/(3)/(4) are themselves pictures — graphs,
     circuits, shapes, vector diagrams — report EACH choice's picture as its own detection with
     target "option" and that choice's printed label in "option_label". Never return one box spanning
     several option pictures, and never skip option pictures just because the stem has no diagram.
     Option detections must also carry the question's first line in "question_text".

=============================
BOUNDING BOX FORMAT
=============================
[x, y, width, height]  — integers, pixel coords relative to the full image
  x      = left  edge  (0 … {imgWidth})
  y      = top   edge  (0 … {imgHeight})
  width  = box width   (x + width  ≤ {imgWidth})
  height = box height  (y + height ≤ {imgHeight})

=============================
OUTPUT FORMAT
=============================
Return a JSON object with two arrays — "questions" and "detections" — in this exact shape, no prose,
no markdown. "questions" lists every numbered question with its "y_top"; "detections" lists the
diagrams — a question with several graphical elements appears once per element. "question_text" may
be "" only for questions with no diagram:
{
  "questions": [
    {"q_no": 1, "x_left": 60, "y_top": 140},
    {"q_no": 2, "x_left": 60, "y_top": 512}
  ],
  "detections": [
    {"q_no": 1, "has_image": false, "bbox": null, "question_text": ""},
    {"q_no": 2, "has_image": true, "target": "question", "option_label": null, "bbox": [x, y, w, h], "question_text": "If |P| = 20, then P in cartesian form is"},
    {"q_no": 3, "has_image": true, "target": "option", "option_label": "A", "bbox": [x, y, w, h], "question_text": "Which graph best represents the motion"},
    {"q_no": 3, "has_image": true, "target": "option", "option_label": "B", "bbox": [x, y, w, h], "question_text": "Which graph best represents the motion"}
  ]
}`;

const ANSWER_KEY_DEFAULT = `You are given an image of an exam answer sheet ({context}).
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
5. Use LaTeX for math; return valid, complete JSON only — no prose, no trailing commas.`;

const SOLUTION_DEFAULT = `You are given an image from an exam SOLUTIONS booklet ({context}).
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
6. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`;

const LATEX_SYSTEM_DEFAULT =
  'You are a LaTeX formatting expert. You wrap math and physical quantities in a passage using ' +
  'inline LaTeX delimiters \\(...\\). You never change, add, or remove any words — you only add ' +
  'delimiters and normalise math notation.';

const LATEX_USER_DEFAULT = `Wrap every mathematical expression and physical quantity in the text below using ONLY inline delimiters \\(...\\).

RULES
1. Wrap math: fractions, roots, powers/subscripts, Greek letters, equations, comparisons, symbols.
2. A physical quantity (a number followed by a unit, e.g. "m/sec", "kg", "m/s^2", "N", "°C") is math. Wrap the WHOLE thing — number AND unit — in one \\(...\\) group, and put the unit inside \\text{...}. Example: -3 m/sec  ->  \\(-3\\ \\text{m/sec}\\)
3. Units ALWAYS go inside \\text{...}, and every \\text{...} MUST sit inside \\(...\\). Never output a bare \\text{...} outside \\(...\\).
4. If the text already contains delimiters ($...$, \\[...\\], [...]) or a bare \\text{...}, convert them to correct \\(...\\) form.
5. Do NOT add, remove, reword, explain, or translate any text. Only wrap. Plain prose stays exactly as written, only its math/quantities get wrapped.
6. Preserve all spacing and punctuation outside the wrapped math.
7. If a value already sits inside correct \\(...\\), leave it; just fix the unit to \\text{...} if needed.

EXAMPLES
Input:  "6 \\text{ m/sec}"          Output: "\\(6\\ \\text{m/sec}\\)"
Input:  "-3 m/sec"                  Output: "\\(-3\\ \\text{m/sec}\\)"
Input:  "5 kg"                      Output: "\\(5\\ \\text{kg}\\)"
Input:  "x^2 + 5x - 6 = 0"          Output: "\\(x^2 + 5x - 6 = 0\\)"
Input:  "v = 20 m/s"                Output: "\\(v = 20\\ \\text{m/s}\\)"
Input:  "The ball moves at 9.8 m/s^2 downward"   Output: "The ball moves at \\(9.8\\ \\text{m/s}^2\\) downward"

Input text: "{text}"

Return valid JSON only: { "refined_text": "..." }`;

/** Default text for every editable prompt — what the builders fall back to and what "Reset" restores. */
export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  extraction: EXTRACTION_DEFAULT,
  inlineAnswer: INLINE_ANSWER_DEFAULT,
  pyq: PYQ_DEFAULT,
  detection: DETECTION_DEFAULT,
  answerKey: ANSWER_KEY_DEFAULT,
  solution: SOLUTION_DEFAULT,
  latexSystem: LATEX_SYSTEM_DEFAULT,
  latexUser: LATEX_USER_DEFAULT,
};

/** Operator-facing metadata + the `{tokens}` each prompt must keep, in display order. */
export const PROMPT_META: Record<PromptKey, { label: string; description: string; tokens: string[] }> = {
  extraction: {
    label: 'Question extraction',
    description: 'Core rules for reading questions off a page. The per-type rule, PYQ, and inline-answer blocks are appended automatically.',
    tokens: [],
  },
  inlineAnswer: {
    label: 'Inline answer key',
    description: 'Appended when a paper prints each answer next to its question, so extraction reads the answer + solution in the same pass.',
    tokens: [],
  },
  pyq: {
    label: 'PYQ source/year',
    description: 'Appended for a previous-year-questions segment, asking the model to read each question’s source exam + year off the page.',
    tokens: [],
  },
  detection: {
    label: 'Figure detection (scan / crop)',
    description: 'Drives every figure scan — single page, all pages, and auto-crop. Must keep the image-size tokens.',
    tokens: ['imgWidth', 'imgHeight'],
  },
  answerKey: {
    label: 'Answer-sheet extraction',
    description: 'Reads a separate answer sheet into a section → number → answer map. A per-type answer-format rule is appended.',
    tokens: ['context'],
  },
  solution: {
    label: 'Solution extraction',
    description: 'Reads a solutions booklet into a section → number → { answer, explanation } map. A per-type answer-format rule is appended.',
    tokens: ['context'],
  },
  latexSystem: {
    label: 'LaTeX fixer (system)',
    description: 'System role for the per-field “Fix LaTeX with AI” refiner.',
    tokens: [],
  },
  latexUser: {
    label: 'LaTeX fixer (instructions)',
    description: 'Instructions for wrapping math/units in \\(...\\). Must keep the {text} token where the field’s content is inserted.',
    tokens: ['text'],
  },
};

/** Substitute `{token}` placeholders; an unknown token is left intact so a typo is visible, not silent. */
export function fillTokens(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? String(tokens[key]) : whole,
  );
}

/** The effective text for a prompt: the operator's override when present, else the code default. */
export function resolvePrompt(overrides: PromptOverrides, key: PromptKey): string {
  return overrides[key] ?? PROMPT_DEFAULTS[key];
}
