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
const QUALITY_FIX_SYSTEM_DEFAULT = `You are a senior subject teacher checking questions in an exam question bank (JEE / NEET / school boards).

You are given ONE question — its text, its options, and whatever metadata is already stored — and asked to work out only the fields listed under WHAT TO RETURN. Follow these rules without exception:

1. SOLVE the question properly before answering anything about it. Reason it through internally; do not pattern-match on how it looks.
2. Return ONLY valid JSON in the exact shape given. No prose outside the JSON.
3. Never invent a value you cannot justify from the question. When you cannot decide something, return null for that field and say why in "notes".
4. Preserve the question's own language and notation. Write maths as LaTeX inside \\( … \\).
5. If an image is attached, it is part of the question — read it. If the question clearly depends on a figure you were NOT given, return nulls with a note saying the figure is missing.
6. "confidence" is your own honest estimate (0 to 1) that everything you returned is correct. Be strict with yourself: below 0.6 means a human should check it.`;

const QUALITY_CHAPTER_DEFAULT = `CHAPTER — decide which chapter of its subject this question belongs to and return its ID. Its topic is chosen next, from that chapter only.

CHAPTERS of this question's exam and subject, as "ID = chapter":
{chapters}

How to choose:
1. Work out what the question is really testing — the concept needed to solve it, not the words it uses.
2. Choose the ONE chapter where that concept is taught. When a question draws on several chapters, choose the chapter of the concept it mainly tests.
3. The stored chapter is a hint only: it may be a coaching-style name ("Modern Physics 1", "KTG & Thermodynamics") or simply wrong. Trust the question over the stored chapter.
4. Return the ID exactly as listed — never the chapter name.
5. If the question belongs to none of these chapters (another subject, or none of these chapters fits), return null and explain in "notes". Never invent an ID.`;

const QUALITY_TOPIC_DEFAULT = `TOPIC — pick the single most accurate topic for this question and return its ID.

ALLOWED TOPICS for this question, already narrowed to its exam, subject and chapter, as "ID = topic", grouped by chapter:
{topics}

How to choose:
1. Work out what the question is really testing — the concept needed to solve it, not the words it uses.
2. When more than one chapter is listed, decide which one that concept belongs to, then choose the ONE topic under it that matches most precisely.
3. Prefer the most specific topic that still covers the question. Never choose a broader one when a specific one fits.
4. The stored chapter is a hint only; it may be named differently from these chapters. Trust the question over the stored chapter.
5. Return the ID exactly as listed — not the topic text, and never a chapter name.
6. If no topic in the list genuinely fits, return null and explain in "notes". Never invent an ID.`;

const QUALITY_ANSWER_DEFAULT = `ANSWER — solve the question and give the correct answer.

1. Solve it fully and carefully before deciding.
2. If the question has options, return the LABEL(s) of the correct option(s) exactly as the options are labelled — "A", or "A, C" when several are correct. Check every option; the answer must be one of the labels shown.
3. For an integer or numerical question, return just the value ("12", "4.5"), with no unit unless the question demands one.
4. For a subjective question, return the final result concisely (maths as LaTeX).
5. If the question is unanswerable as stored — missing figure, missing data, no correct option — return null and explain in "notes". Never pick an option at random.
6. When a stored answer is already present and your solution disagrees with it, still return YOUR answer and say so in "notes".`;

const QUALITY_SOLUTION_DEFAULT = `SOLUTION — write the worked solution a student can learn from.

1. Show the reasoning step by step, in the order a student would follow it: what is given, which principle applies, then the working to the result.
2. Keep it tight — the steps that matter, not a lecture.
3. Maths as LaTeX inside \\( … \\); units written as \\(\\text{m/s}\\).
4. End with the final answer stated plainly.
5. If you could not solve the question, return null.`;

const QUALITY_LEVEL_DEFAULT = `LEVEL — grade the question's difficulty from YOUR OWN solution, as one of exactly: easy, medium, hard.

Judge it by the work it takes a prepared student, not by how long the question reads:
- easy: one concept, a direct formula or definition, one or two steps, no trap.
- medium: two or more concepts or steps combined, some manipulation, a common mistake to avoid.
- hard: several concepts chained, a non-obvious insight or setup, heavy derivation, or a deliberate trap that catches most students.

Grade what the question actually demands, not the exam it came from. If you could not solve it, return null.`;

const QUALITY_TYPE_LOCK_DEFAULT = `QUESTION TYPE IS CONFIRMED — a reviewer has checked this question and confirmed it is "{type}". Your answer MUST fit that type:
- single_correct / assertion_reason: exactly ONE option is correct. Return exactly one label, e.g. "B". If more than one option looks right, re-read the wording (e.g. "most appropriate", "best", "primarily") and decide the ONE the question intends; say in "notes" why the others lose.
- multi_correct: return every correct label, e.g. "A, C".
- integer: return only the number.
Your solution must arrive at exactly the answer you return. If no answer fits the confirmed type, return null and explain in "notes".`;

const QUALITY_STRUCTURE_DEFAULT = `STRUCTURE — rebuild the shape this question has lost. Return it under "structure".

The question is one of two kinds. Do the one that applies and leave the other null.

A) MATCH THE COLUMN (matrix). Its columns were stored as plain text, so the app cannot show the table.
1. Read the columns off the question exactly as printed. Column I is usually labelled A, B, C, D; Column II p, q, r, s (some papers use 1,2,3,4 — keep the labels the question itself prints).
2. Copy each entry's text verbatim from the question. Never reword, translate, shorten or invent an entry. If an entry is unreadable, return null for the whole structure and say so in "notes".
3. Give each column the heading the question prints ("Column I", "List-I", "सूची-I"); use "Column I" / "Column II" if it prints none.
4. "key" maps each Column-I label to the labels it matches: { "A": ["p"], "B": ["q","t"] }. Take the matching from the question's stored answer whenever it has one — you are restoring a table, not re-solving the question. Only work the matching out yourself when no answer is stored, and say so in "notes".
5. Options like "(A) A-p, B-q, C-r" are answer CHOICES, not columns. Never turn them into column entries.

B) COMPREHENSION PASSAGE. The question belongs to a passage group but the passage text is missing.
1. Return the shared passage exactly as printed, in the question's own language.
2. Return only the passage — not the question, not the options.
3. If the passage is not in what you were given, return null. Never write a passage yourself: an invented passage silently changes what the question asks.

Maths stays LaTeX inside \\( … \\). Return null for a kind that does not apply, and null for the whole structure when you cannot rebuild it faithfully.`;

export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  extraction: EXTRACTION_DEFAULT,
  inlineAnswer: INLINE_ANSWER_DEFAULT,
  pyq: PYQ_DEFAULT,
  detection: DETECTION_DEFAULT,
  answerKey: ANSWER_KEY_DEFAULT,
  solution: SOLUTION_DEFAULT,
  latexSystem: LATEX_SYSTEM_DEFAULT,
  latexUser: LATEX_USER_DEFAULT,
  qualityFixSystem: QUALITY_FIX_SYSTEM_DEFAULT,
  qualityChapter: QUALITY_CHAPTER_DEFAULT,
  qualityTopic: QUALITY_TOPIC_DEFAULT,
  qualityAnswer: QUALITY_ANSWER_DEFAULT,
  qualitySolution: QUALITY_SOLUTION_DEFAULT,
  qualityLevel: QUALITY_LEVEL_DEFAULT,
  qualityTypeLock: QUALITY_TYPE_LOCK_DEFAULT,
  qualityStructure: QUALITY_STRUCTURE_DEFAULT,
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
  qualityFixSystem: {
    label: 'Fix with AI (system)',
    description: 'System role for the data-quality “fix with AI” run: solve first, return JSON, never guess.',
    tokens: [],
  },
  qualityChapter: {
    label: 'Fix with AI · chapter',
    description:
      'Runs before the topic when the question’s stored chapter matches no chapter of its subject in Question taxonomy: the AI places the question in a chapter, and the topic is then chosen inside it. Must keep the {chapters} token — the “ID = chapter” list for the question’s subject is inserted there.',
    tokens: ['chapters'],
  },
  qualityTopic: {
    label: 'Fix with AI · topic',
    description:
      'How the topic is chosen. Must keep the {topics} token — the allowed “ID = topic” table for the question’s exam, subject and chapter is inserted there, and an answer that is not one of those IDs is rejected.',
    tokens: ['topics'],
  },
  qualityAnswer: {
    label: 'Fix with AI · answer',
    description: 'How the question is solved and how the answer must be formatted (option labels, integer values, subjective results).',
    tokens: [],
  },
  qualitySolution: {
    label: 'Fix with AI · solution',
    description: 'How the worked solution is written (steps, LaTeX, final answer).',
    tokens: [],
  },
  qualityLevel: {
    label: 'Fix with AI · level',
    description: 'The criteria that decide easy / medium / hard. Edit these to match how your team grades difficulty.',
    tokens: [],
  },
  qualityStructure: {
    label: 'Fix with AI · structure',
    description:
      'How a lost match table or comprehension passage is rebuilt from the question itself. The rules against inventing entries live here — edit with care.',
    tokens: [],
  },
  qualityTypeLock: {
    label: 'Fix with AI · re-ask with the type confirmed',
    description:
      'Added when a reviewer re-asks the AI because its answer did not fit the question type (e.g. two answers on a single-correct question). Must keep the {type} token — the confirmed type is inserted there.',
    tokens: ['type'],
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
