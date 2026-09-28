import type { Document } from '@ingest/contracts';
import { KNOWN_LEVELS, KNOWN_QUESTION_TYPES, PAPER_METADATA_FIELDS } from '@ingest/contracts';
import {
  topicBindingForPage,
  type AnswerExtractionScope,
  type MastersSnapshot,
} from '../../../modules/extraction/index.js';
import { slugForKind } from '../../../shared/taxonomy/fold-maps.js';
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

/**
 * The detailed chemistry + SMILES policies are intentionally large. Apply them when the source is
 * known to be chemistry (or an operator supplied a policy), while retaining a short safety rule for
 * every other paper. This keeps ordinary physics/math extraction inexpensive without making a
 * chemistry upload silently lose its rendering contract.
 */
function isChemistryContext(document: Document): boolean {
  const subject = document.subject?.trim();
  if (subject) return /\bchem(?:istry|ical)?\b/i.test(subject);
  return /\b(?:chem(?:istry|ical)?|organic|inorganic|stoichiometr|mole concept|periodic table|electrochem)\b/i
    .test([document.path.module, document.path.chapter, document.path.section, document.sectionName ?? ''].join(' '));
}

function chemistryExtractionRules(document: Document, overrides: PromptOverrides): string[] {
  const hasOperatorRule = Boolean(overrides.chemistry?.trim() || overrides.smiles?.trim());
  if (hasOperatorRule || isChemistryContext(document)) {
    return [resolvePrompt(overrides, 'chemistry'), resolvePrompt(overrides, 'smiles')].filter(Boolean);
  }
  return [
    'CHEMISTRY SAFETY (only if chemical notation appears): preserve a printed formula, ion, or reaction as inline mhchem such as \\(\\ce{H2O}\\) or \\(\\ce{2H2 + O2 -> 2H2O}\\); never put ordinary prose or units in \\ce, and leave an unreadable drawn molecular structure for its image rather than inventing it.',
  ];
}

const TYPE_RULES: Record<string, string> = {
  single_correct:
    'This is a SINGLE CORRECT type: preserve every printed option and its actual label/count; exactly one option is correct when an answer is shown.',
  multi_correct:
    'This is a MULTIPLE CORRECT type: preserve every printed option and its actual label/count; one or more options may be correct.',
  integer: 'This is an INTEGER type: the answer is a number; options is usually an empty array [].',
  matrix:
    'This is a MATRIX MATCH (match-the-column) type. Return ONE JSON entry for the whole question. Put ONLY the instruction/stem (e.g. "Match Column I with Columns II and III") in question_text — do NOT copy the columns into it. Add a "columns" field: an array of EVERY column in printed order (there are usually TWO, sometimes THREE), each { "title": the column heading e.g. "Column I (Velocity)", "entries": [ { "label": the printed label e.g. "A"/"p"/"t", "body": that entry\'s text with math as LaTeX } ] }. ALSO fill "options" with the printed multiple-choice ANSWER CHOICES the student selects from (usually four, labelled (A)(B)(C)(D); normalize (1)(2)(3)(4) to (A)(B)(C)(D)): keep the SAME string form as every other type — an array of strings each prefixed "(A) …", "(B) …", where the text is that choice\'s FULL matching EXACTLY as printed, e.g. "(A) A-i, B-ii, C-iii, D-iv". Use an empty array [] when the page prints no readable answer choices. If the page prints the correct matching (or marks the correct choice), also add a "match" field mapping each FIRST-column label to the labels it matches, e.g. { "A": ["p","t"], "B": ["q","u"] }; omit it when the answer is not shown on the question page. When printed answer choices exist, the canonical "answer" is the selected choice label only (for example "C"), NEVER the mapping text; use mapping text as "answer" only for a genuine direct-response matrix with no printed choices. Never reconstruct, complete, or invent a missing/illegible choice panel: return options [] and preserve the complete matching key. The server generates verified choices only after it validates that key.',
  comprehension:
    'This is a COMPREHENSION type: a shared passage is followed by several sub-questions of ANY type. Return ONE JSON entry PER SUB-QUESTION. Put ONLY that sub-question\'s own text in question_text — do NOT copy the passage into it. Add a "passage" field to every sub-question carrying the FULL shared passage VERBATIM, byte-for-byte IDENTICAL across all sub-questions that share it (this is how they are grouped). Add a "question_type" field to EACH sub-question naming ITS OWN type — one of "single_correct", "multi_correct", "integer", "matrix", "assertion_reason", "true_false", "fill_blank", "subjective" — because a comprehension group can mix types; use "single_correct" when unsure. question_number is each sub-question\'s printed number; options are that sub-question\'s own choices.',
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
    'SINGLE CORRECT: each answer is exactly ONE actual printed choice label (for example A–E, 1–5, or I–IV). Preserve its printed label; normalize 1–4 to A–D only when the page itself uses the canonical A–D choice convention.',
  multi_correct:
    'MULTIPLE CORRECT: each answer is EVERY correct printed choice label in printed order. Use compact "AC" only for one-character A/B/C-style labels; otherwise separate labels clearly, e.g. "1, 3" or "I, III".',
  integer:
    'INTEGER / NUMERICAL: each answer is the exact numeric value as printed (integer or decimal), with no surrounding text and no units unless the printed answer itself carries them.',
  matrix:
    'MATRIX MATCH: first inspect the question layout. When it prints selectable answer choices containing full matchings, return ONLY the correct printed choice label (for example "C" or "3"), never the mapping text. The matching table can still be extracted as "match" when visible. Only when there are truly NO printed answer choices (a direct-response matrix) return the first-column label → matched-label mapping, one group per first-column label, e.g. "A→P,Q; B→R; C→S,T; D→P".',
  assertion_reason:
    'ASSERTION-REASON: each answer is the single chosen printed option label for the standard evaluation of the Assertion and the Reason. In the explanation, state which of the Assertion and the Reason are true and whether the Reason correctly explains the Assertion.',
  comprehension:
    'COMPREHENSION: give ONE answer PER SUB-QUESTION, keyed by that sub-question\'s own printed number (each sub-question is a separate entry); each value is the option letter(s) or value for that sub-question.',
  true_false:
    'TRUE/FALSE: each answer is "True" or "False" — or the printed option letter (e.g. "A" for True, "B" for False) when the paper labels the choices.',
  fill_blank:
    'FILL IN THE BLANK: each answer is the exact word/phrase/value that fills the blank, verbatim, with math as LaTeX.',
  subjective:
    'SUBJECTIVE/DESCRIPTIVE: there is no option letter. Copy the complete final result, statement, derivation conclusion, or requested value exactly enough to verify the response, preserving all math/units/conditions as printed. Do NOT replace it with a guessed single word or option label. The solution prompt additionally puts the full intermediate working in "explanation".',
};

/**
 * Resolve the question type for a page exactly as the persisted questions are stamped: the operator's
 * topic binding when the page is covered by a block (fixed, so the model cannot re-classify), else the
 * document-level type. Shared by the question, answer, and solution prompts so all three agree.
 */
function resolveQuestionType(
  document: Document,
  pageNumber: number,
  scope?: AnswerExtractionScope,
): string | null {
  // Bound sibling pages do not share the question PDF's page numbering or topic map. When a scope is
  // present, even an explicit null must win — falling back to the sibling's first-leaf type would give
  // a mixed/unknown leaf the wrong answer grammar.
  if (scope) return scope.questionType;
  return topicBindingForPage(document.topics, pageNumber)?.questionType ?? document.questionType;
}

/**
 * Context appended to a separate answer/solution pass. The operator's cut binding, not a heading the
 * model happens to OCR, is the authoritative pairing signal. This is intentionally compact because it
 * is sent on every selected sibling page.
 */
function answerSourceScopeRule(
  scope: AnswerExtractionScope | undefined,
  source: 'answer key' | 'solution',
): string {
  if (!scope) return '';
  const leaf = JSON.stringify(scope.sectionName);
  const type = scope.questionType
    ? `The corresponding questions are fixed as type "${scope.questionType}".`
    : 'The corresponding questions have mixed or unspecified types; preserve each printed answer format exactly.';
  const questionPages = `${String(scope.questionPageRange.from)}–${String(scope.questionPageRange.to)}`;
  const sourcePages = `${String(scope.sourcePageRange.from)}–${String(scope.sourcePageRange.to)}`;
  const pairing = source === 'answer key'
    ? 'Return only the final answer value for each printed question number; never manufacture an explanation from an answer key.'
    : 'For each printed question number, keep its final answer in "answer" and all working for that same question in "explanation"; stop before the next numbered solution.';
  return [
    `BOUND ${source.toUpperCase()} SCOPE (authoritative): these source pages ${sourcePages} are bound only to question leaf ${leaf} (question-PDF pages ${questionPages}).`,
    type,
    `Return exactly one section object with "section_name": ${leaf}, even if this page has no heading or prints a different heading. Use the PRINTED QUESTION NUMBER as every map key — never an option label, matrix row label, page number, or visual order.`,
    `${pairing} Do not pull entries from an adjacent section or guess an entry that is not visible in this bound page range.`,
  ].join('\n');
}

/** The answer/solution page belongs to the question document's path, not necessarily the sibling's first type. */
function answerSourceContext(document: Document, scope?: AnswerExtractionScope): string {
  if (!scope) return context(document);
  const parts = [
    `Module: ${document.path.module}`,
    `Chapter: ${document.path.chapter}`,
    `Bound question leaf: ${scope.sectionName}`,
  ];
  if (scope.questionType) parts.push(`Question type: ${scope.questionType}`);
  return parts.join(' | ');
}

/**
 * Whether the questions on a page should be extracted as PYQ: the segment's per-node toggle when the
 * page is covered by a block, else the document-level PYQ flag (legacy whole-chapter PYQ uploads).
 */
function resolvePyq(document: Document, binding: ReturnType<typeof topicBindingForPage>): boolean {
  return binding?.pyq ?? document.pyq;
}

/**
 * Ask the model to CLASSIFY each question — the "AI picks the dictionary ids" step. Every question
 * object also carries its own `question_type` (from the closed vocabulary, resolved to the bank's
 * QuestionType FK on publish) and a `difficulty` (easy/medium/hard, resolved to the Level FK). When the
 * operator filed the page under a type, it is offered as a strong hint the model keeps unless a
 * question is clearly a different type — so a mixed PYQ page is classified per question, and a uniform
 * coaching section stays on its known type.
 */
function classificationRule(expectedType: string | null, masters?: MastersSnapshot): string {
  // The allowed vocabulary comes from the LIVE questionType / level masters when present (so an operator
  // edit is reflected with no code change), falling back to the built-in constants when no snapshot is
  // available (e.g. the unconfigured taxonomy store). questionType rows are presented as the pipeline
  // SLUG the model must emit (single/multi get the `_correct` suffix) paired with their display name.
  const configuredRows = masters && masters.questionType.length > 0
    ? masters.questionType.map((row) => ({ slug: slugForKind(row.kind) ?? row.key, name: row.name }))
    : [];
  // The live master tree may omit a built-in extraction kind (notably true/false and fill-in-the-
  // blank). Keep the vocabulary complete while still allowing custom operator-managed keys.
  const knownRows = (KNOWN_QUESTION_TYPES as readonly string[]).map((slug) => ({ slug, name: slug }));
  const typeRows = [...configuredRows, ...knownRows].filter(
    (row, index, rows) => rows.findIndex((candidate) => candidate.slug === row.slug) === index,
  );
  const levelRows = masters && masters.level.length > 0
    ? masters.level.map((row) => ({ slug: row.key, name: row.name }))
    : (KNOWN_LEVELS as readonly string[]).map((slug) => ({ slug, name: slug }));
  const types = typeRows.map((row) => row.slug).join('", "');
  const levels = levelRows.map((row) => row.slug).join('", "');
  const typeLegend = typeRows.map((row) => `    • "${row.slug}" — ${row.name}`).join('\n');
  const difficultyRule = `- "difficulty": how hard the question is for a student preparing for this exam — exactly one of "${levels}" (easy = direct recall or a single step, medium = a couple of steps, hard = multi-step or conceptually tricky).`;
  if (expectedType && expectedType !== 'comprehension') {
    return [
      `TYPE LOCK: this cut was explicitly configured as "${expectedType}". Emit that exact value in "question_type" for EVERY question on this page; do not reclassify it from OCR or a neighbouring heading.`,
      difficultyRule,
    ].join('\n');
  }
  const typeHint = expectedType === 'comprehension'
    ? 'This page is a COMPREHENSION container: each sub-question still needs its own printed type; do not emit "comprehension" as a child type.'
    : 'Pick the type that matches how each question is actually printed.';
  return [
    'CLASSIFY EACH QUESTION using ONLY the operator-managed masters vocabulary below — never invent a type or difficulty. In addition to question_number, question_text and options, add TWO more fields to EVERY question object (and, for a comprehension, to every sub-question):',
    `- "question_type": the question's own type, exactly one of "${types}". ${typeHint}\n  The current question-type masters (choose from these only):\n${typeLegend}`,
    difficultyRule,
  ].join('\n');
}

/** Compact output-shape guard for unbound/mixed pages, without paying for every full type rule. */
function detectedTypeStructureRule(): string {
  return [
    'DETECTED-TYPE SHAPE (required when this page is mixed/unbound):',
    '- matrix: keep only the instruction in question_text; return every match column in columns, printed student choices separately in options, and match only when a key is visible.',
    '- comprehension: one object per child; repeat the identical shared passage in passage and give each child its own question_type.',
    '- integer, fill_blank, subjective: options is [] unless choices are actually printed; preserve every unit, blank, and answer-format condition.',
    '- all choice types: preserve every printed choice label/count and never turn a matrix row/table label into an option.',
  ].join('\n');
}

/**
 * The question-extraction prompt for one page of a document. The model classifies each question's own
 * type + difficulty (see {@link classificationRule}); a concrete operator topic-config type is a
 * lock (and selects the type-specific extraction rule). When the paper's answer layout is
 * `inline`, an extra rule tells the model to read each question's printed answer key in the same pass.
 */
export function questionPrompt(
  document: Document,
  pageNumber: number,
  overrides: PromptOverrides,
  masters?: MastersSnapshot,
): string {
  const binding = topicBindingForPage(document.topics, pageNumber);
  const expectedType = binding?.questionType ?? document.questionType;
  const typeRule = expectedType ? TYPE_RULES[expectedType] : undefined;
  // A configured type is authoritative; unbound/PYQ pages classify freely and receive a compact
  // structural contract for whatever type they detect.
  const bindingNote = binding?.questionType
    ? `The operator locked this page (topic "${binding.matchKey}") as "${binding.questionType}" — keep that type exactly for every ordinary question on this page.`
    : '';
  return [
    `You are given an image of an exam question paper (${context(document)}).`,
    bindingNote,
    resolvePrompt(overrides, 'extraction'),
    typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : '',
    classificationRule(expectedType, masters),
    expectedType ? '' : detectedTypeStructureRule(),
    ...chemistryExtractionRules(document, overrides),
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
 * Re-extraction has its own compact output shape, so an operator's normal extraction override cannot
 * replace that envelope. It can still add content-reading instructions; only actual overrides are sent,
 * which avoids paying the full base prompt again on every interactive re-read.
 */
function reExtractOverrideRules(
  overrides: PromptOverrides,
  context: {
    sourceKind?: 'question' | 'answer' | 'solution' | 'companion';
    fieldTarget?: 'answer' | 'solution';
    inlineAnswers?: boolean;
  } = {},
): string {
  const overridesToApply: Array<[keyof PromptOverrides, string]> = [
    ['extraction', 'EXTRACTION'],
    ['chemistry', 'CHEMISTRY'],
    ['smiles', 'DRAWN-STRUCTURE'],
  ];
  if (context.sourceKind === 'answer') overridesToApply.push(['answerKey', 'ANSWER-KEY']);
  if (context.sourceKind === 'solution') overridesToApply.push(['solution', 'SOLUTION']);
  if (context.sourceKind === 'companion') {
    if (context.fieldTarget !== 'solution') overridesToApply.push(['answerKey', 'ANSWER-KEY']);
    if (context.fieldTarget !== 'answer') overridesToApply.push(['solution', 'SOLUTION']);
  }
  if (context.sourceKind === 'question' && context.inlineAnswers) {
    overridesToApply.push(['inlineAnswer', 'INLINE-ANSWER']);
  }
  const rules = overridesToApply
    .flatMap(([key, label]) => {
      const value = overrides[key]?.trim();
      return value ? [`${label} OVERRIDE:\n${value}`] : [];
    });
  return rules.length > 0
    ? `OPERATOR PROMPT OVERRIDES — apply their content-reading/pairing rules, but the target-only JSON shape below remains authoritative:\n${rules.join('\n\n')}`
    : '';
}

/**
 * Re-extract ONE already-extracted question from its source page (the verify screen's "read the page
 * again" button). Unlike {@link questionPrompt}, which pulls every question on the page, this targets
 * a single question by its printed number (with the current stem as a fallback hint). A sibling answer
 * or solution page uses a field-specific prompt so it is never misread as a second question paper.
 */
export function reExtractQuestionPrompt(target: {
  questionNumber: number | null;
  stemHint: string;
  questionType: string | null;
  sourceKind?: 'question' | 'answer' | 'solution' | 'companion';
  fieldTarget?: 'answer' | 'solution';
  inlineAnswers?: boolean;
}, overrides: PromptOverrides = {}): string {
  const hint = target.stemHint.replace(/\s+/g, ' ').trim().slice(0, 120);
  const typeRule = target.questionType ? TYPE_RULES[target.questionType] : undefined;
  const answerRule = target.questionType ? ANSWER_TYPE_RULES[target.questionType] : undefined;
  const isMatrix = target.questionType === 'matrix';
  const sourceKind = target.sourceKind ?? 'question';
  const fieldTarget = target.fieldTarget;
  const sourceIntro = sourceKind === 'answer'
    ? 'You are given an image from an exam ANSWER KEY.'
    : sourceKind === 'solution'
      ? 'You are given an image from an exam SOLUTIONS / EXPLANATIONS booklet.'
      : sourceKind === 'companion'
        ? 'You are given an image from one grouped exam ANSWER KEY + SOLUTIONS companion booklet.'
      : 'You are given an image of one page from an exam question paper.';
  const targetReadInstruction = sourceKind === 'answer'
    ? `Find the final answer — and any worked reasoning printed in this same source — for question number ${target.questionNumber === null ? '(unknown)' : String(target.questionNumber)}${hint ? `, whose question begins: "${hint}"` : ''}.`
    : sourceKind === 'solution'
      ? `Find ONLY the worked solution printed for question number ${target.questionNumber === null ? '(unknown)' : String(target.questionNumber)}${hint ? `, whose question begins: "${hint}"` : ''}.`
      : sourceKind === 'companion'
        ? `Find ${fieldTarget === 'answer' ? 'the final answer' : fieldTarget === 'solution' ? 'the worked solution and final answer when stated' : 'the final answer and any worked solution'} for question number ${target.questionNumber === null ? '(unknown)' : String(target.questionNumber)}${hint ? `, whose question begins: "${hint}"` : ''}.`
      : `Re-read the SINGLE question printed as number ${
        target.questionNumber === null ? '(unknown)' : String(target.questionNumber)
      }${hint ? `, which begins: "${hint}"` : ''} and extract only that one question.`;
  const sourceRule = sourceKind === 'answer'
    ? 'ANSWER-KEY SOURCE RULES: Locate the exact printed question number, never an option/table row. Return stem as "", options as [], columns as [], omit match, and put the final answer value in answer. If this same source also prints worked reasoning, preserve it completely in explanation; otherwise explanation is null. If no answer is visible, return answer as "". Do not invent question text, choices, working, or a visual figure transcription.'
    : sourceKind === 'solution'
      ? 'SOLUTION SOURCE RULES: Locate the exact printed question number, never an option/table row. Return stem as "", options as [], columns as [], omit match, answer as the final result when stated (else ""), and explanation as the COMPLETE working for that same question (else null). Stop at the next numbered solution; do not invent question text or choices.'
      : sourceKind === 'companion'
        ? `COMPANION SOURCE RULES: Locate the exact printed question number, never an option/table row. Return stem as "", options as [], columns as [], and omit match. ${fieldTarget === 'answer' ? 'Return the final answer; explanation is null unless the same page visibly includes its working.' : fieldTarget === 'solution' ? 'Return the final answer when stated and the COMPLETE same-number working.' : 'Return both the final answer when stated and the COMPLETE same-number working.'} Stop at the next numbered entry; do not invent question text or choices.`
      : target.inlineAnswers
        ? 'INLINE PAIRING RULE: this question PDF prints answers/solutions beside the questions. The next numbered QUESTION is the boundary; "Ans.", "Solution", a caption, or a line break is not. Keep everything after this question and before the next numbered question paired to this one.'
        : '';
  return [
    sourceIntro,
    targetReadInstruction,
    reExtractOverrideRules(overrides, {
      sourceKind,
      ...(fieldTarget ? { fieldTarget } : {}),
      ...(target.inlineAnswers ? { inlineAnswers: true } : {}),
    }),
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
2. options: one entry per printed choice. Preserve each short printed label and the actual count (A–E, 1–5, I–IV, etc.); normalize 1–4 to A–D only when the layout explicitly presents canonical A–D choices. Never repeat or merge labels, and never use a matrix column label as an option. Set is_correct true only when the page marks that choice as correct, else false.
3. For a question with no options, use an empty array [].
4. columns/match: leave "columns" as [] and OMIT "match" UNLESS this is a MATRIX MATCH question (see the type-specific rule).
5. answer: use "" when the page does not indicate the correct answer (question papers usually do not).
6. explanation: use null when no worked solution is printed on this page.
7. Preserve all math as LaTeX, and write any chemistry (formulae, ions, reactions) with mhchem \\(\\ce{...}\\) — e.g. \\(\\ce{H2O}\\), \\(\\ce{SO4^2-}\\), \\(\\ce{2H2 + O2 -> 2H2O}\\); one whole reaction per \\ce, keep units/quantities as ordinary math (not \\ce), and never wrap prose words in \\ce. A molecule DRAWN as a 2-D diagram (a benzene ring, a skeletal/organic structure) is written inline as <smiles>RAW_SMILES</smiles> — e.g. <smiles>c1ccccc1</smiles>, <smiles>Oc1ccccc1</smiles> — never as \\ce and never wrapped in \\( \\); leave a wedge/dash-stereo or unreadable drawing for image. Return valid, complete JSON only — no prose, double-quoted keys/strings, no trailing commas.`,
    sourceRule,
    sourceKind === 'question' && isMatrix
      ? 'MATRIX MATCH: put ONLY the instruction/stem in "stem" — do NOT copy the columns into it. Fill "columns" — an array of EVERY printed column in order (usually two, sometimes three), each { "title": the heading, "entries": [ { "label": the printed label e.g. "A"/"p"/"t", "body": that entry\'s text with math as LaTeX } ] }. ALSO fill "options" with the printed multiple-choice ANSWERS (usually four), each { "label": one of "A"–"D" in printed order (normalize (1)(2)(3)(4)), "body": that choice\'s FULL matching text EXACTLY as printed, e.g. "A-i, B-ii, C-iii, D-iv, E-v", "is_correct": true only for the choice the page marks correct else false }. When printed choices exist, write the canonical "answer" as ONLY the selected choice label (for example "C"), never the expanded matching. When the page also prints the matching, add "match" mapping each first-column label to the labels it matches, e.g. { "A": ["iv"], "B": ["v"] }. Use a mapping string as "answer" only for a genuine direct-response matrix with no printed choices; omit "match" when no matching is shown. Never reconstruct or invent unreadable/missing choices: return options [] and preserve the key; the server adds verified generated choices only after key validation.'
      : (sourceKind === 'question'
        ? (typeRule ? `TYPE-SPECIFIC RULE:\n${typeRule}` : '')
        : (answerRule ? `ANSWER TYPE-SPECIFIC RULE:\n${answerRule}` : '')),
  ]
    .filter(Boolean)
    .join('\n\n');
}

type GroupReExtractPromptMember = {
  questionNumber: number | null;
  stemHint: string;
  questionType: string | null;
};

/** Compact structural contract for a group child — a group can mix these types. */
function groupMemberStructureRule(type: string | null): string {
  switch (type) {
    case 'matrix':
      return 'MATRIX: keep only the instruction in stem; put every printed match column in columns. Keep the printed student-selectable choices (A/B/C/D/etc.) in options. If a key is shown, match maps first-column labels to their targets. The answer is the selected option label when choices exist; never replace it with a mapping. If choices are unreadable or absent, leave options empty; do not invent a panel because the server creates verified choices only after validating the complete key.';
    case 'single_correct':
    case 'multi_correct':
    case 'assertion_reason':
    case 'true_false':
      return 'CHOICE: preserve every printed choice in options, in printed order. Do not invent missing choices.';
    case 'integer':
    case 'fill_blank':
    case 'subjective':
      return 'FREE RESPONSE: use options [] unless choices are actually printed; preserve every blank, unit, and answer-format instruction.';
    default:
      return 'PRESERVE: retain the existing printed structure exactly; do not classify or convert this child to another type.';
  }
}

/**
 * Re-extract a COMPREHENSION GROUP from one or more source pages (BLA-147). The operation has two
 * explicit scopes: passage-only, which cannot alter member questions, and a full passage + members
 * re-read. Each child carries its pre-existing type in the prompt, instead of treating the first child
 * as a group-wide type; this keeps a matrix/int/multiple-choice mix structurally safe.
 */
export function reExtractGroupPrompt(target: {
  mode: 'passage_only' | 'passage_and_questions';
  members: readonly GroupReExtractPromptMember[];
  passageHint: string;
  sourceKind?: 'question' | 'answer' | 'solution' | 'companion';
  fieldTarget?: 'answer' | 'solution';
  inlineAnswers?: boolean;
}, overrides: PromptOverrides = {}): string {
  const hint = target.passageHint.replace(/\s+/g, ' ').trim().slice(0, 120);
  const sourceKind = target.sourceKind ?? 'question';
  const fieldTarget = target.fieldTarget;
  const sourceIntro = sourceKind === 'answer'
    ? 'You are given source-page images from an exam ANSWER KEY for an existing comprehension group.'
    : sourceKind === 'solution'
      ? 'You are given source-page images from an exam SOLUTIONS booklet for an existing comprehension group.'
      : sourceKind === 'companion'
        ? 'You are given source-page images from one grouped exam ANSWER KEY + SOLUTIONS companion booklet for an existing comprehension group.'
      : 'You are given one or more source-page images from an exam COMPREHENSION block: a shared passage followed by several sub-questions.';
  const sourceRule = sourceKind === 'answer'
    ? 'ANSWER-KEY SOURCE RULE: do not invent passage/stems/options/table data. For each visible target member, return only its final answer and null explanation.'
    : sourceKind === 'solution'
      ? 'SOLUTION SOURCE RULE: do not invent passage/stems/options/table data. For each visible target member, return its final answer when stated and the complete same-number explanation; stop at the next numbered solution.'
      : sourceKind === 'companion'
        ? `COMPANION SOURCE RULE: do not invent passage/stems/options/table data. For each visible target member, return ${fieldTarget === 'answer' ? 'its final answer (and no explanation unless the same page visibly includes it)' : fieldTarget === 'solution' ? 'the final answer when stated plus complete same-number explanation' : 'the final answer when stated plus complete same-number explanation'}.`
      : target.inlineAnswers
        ? 'INLINE PAIRING RULE: answers and working belong to the preceding question until the next numbered QUESTION, not to a heading, caption, or line break.'
        : '';
  const memberLines = target.members.map((member, index) => {
    const number = member.questionNumber === null ? 'unnumbered' : `question ${String(member.questionNumber)}`;
    const stem = member.stemHint.replace(/\s+/g, ' ').trim().slice(0, 72);
    return `${String(index)} | ${number} | fixed type: ${member.questionType ?? 'unknown'}${stem ? ` | begins: "${stem}"` : ''}`;
  }).join('\n');

  if (target.mode === 'passage_only') {
    return [
      sourceIntro,
      hint
        ? `Re-read ONLY the shared passage whose current text begins: "${hint}". Do not read, add, or modify any sub-question.`
        : `Re-read ONLY the shared passage immediately preceding the first target member (${target.members[0]?.questionNumber === null ? 'unnumbered' : `question ${String(target.members[0]?.questionNumber)}`}). Do not read, add, or modify any sub-question.`,
      reExtractOverrideRules(overrides, {
        sourceKind,
        ...(fieldTarget ? { fieldTarget } : {}),
        ...(target.inlineAnswers ? { inlineAnswers: true } : {}),
      }),
      `Return ONLY this exact JSON shape:\n\n{\n  "passage": "the FULL shared passage VERBATIM, math as LaTeX like \\\\( \\\\sqrt{3} \\\\)"\n}`,
      'RULES:\n1. Copy the complete shared passage exactly once; do not include any numbered sub-question.\n2. Preserve math as LaTeX. Write chemistry formulae/reactions with mhchem, for example \\(\\ce{H2O}\\) and \\(\\ce{2H2 + O2 -> 2H2O}\\).\n3. Return valid JSON only — no prose, markdown fence, or extra keys.',
    ].join('\n\n');
  }

  const distinctTypes = [...new Set(target.members.map((member) => member.questionType ?? 'unknown'))];
  const structuralRules = distinctTypes.map((type) => `- ${type}: ${groupMemberStructureRule(type === 'unknown' ? null : type)}`).join('\n');
  return [
    sourceIntro,
    `${hint ? `Re-read the comprehension block whose passage begins: "${hint}".` : 'Re-read the shared passage immediately before the target members.'} Return exactly the existing members below — no adjacent question, invented child, or changed type.`,
    `TARGET MEMBERS (member_index is zero-based and is the stable identity to return):\n${memberLines}`,
    reExtractOverrideRules(overrides, {
      sourceKind,
      ...(fieldTarget ? { fieldTarget } : {}),
      ...(target.inlineAnswers ? { inlineAnswers: true } : {}),
    }),
    `Return ONLY this exact JSON shape:\n\n{
  "passage": "the FULL shared passage VERBATIM, math as LaTeX like \\\\( \\\\sqrt{3} \\\\)",
  "questions": [
    {
      "member_index": 0,
      "question_number": 1,
      "stem": "ONLY this sub-question's own text — do NOT copy the passage into it",
      "options": [ { "label": "A", "body": "…", "is_correct": false } ],
      "columns": [ { "title": "Column I", "entries": [ { "label": "A", "body": "…" } ] } ],
      "match": { "A": ["p"] },
      "answer": "the printed final answer, or \\"\\" when absent",
      "explanation": "the printed working, or null when absent"
    }
  ]
}`,
    `MEMBER TYPE CONTRACTS:\n${structuralRules}`,
    sourceRule,
    `RE-EXTRACT RULES:
1. Return one object for EVERY target member and use its exact member_index. Keep question_number as printed (or null); never use a matrix row label or option label as a question number.
2. passage is the FULL shared passage exactly once, VERBATIM. NEVER repeat it inside stem. stem contains ONLY the member's own question.
3. options contains only that member's printed answer choices. Labels follow printed order; normalize bare (1)(2)(3)(4) to A/B/C/D only when they are actual choices. Never turn matrix column labels into options.
4. columns is [] and match is omitted for every non-matrix child. For a matrix child, preserve the full table AND the separate selectable answer options; do not flatten columns into stem/options.
5. answer is "" if this source does not state it. explanation is null if this source does not print working. Never guess either one.
6. Preserve math as LaTeX. Write chemistry formulae/reactions with mhchem, for example \\(\\ce{H2O}\\) and \\(\\ce{SO4^2-}\\). For an unreadable drawn molecule, preserve it for an image rather than inventing SMILES.
7. Return valid, complete JSON only — no prose, markdown fence, or trailing commas.`,
  ].join('\n\n');
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
  scope?: AnswerExtractionScope,
): string {
  const questionType = resolveQuestionType(document, pageNumber, scope);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  const chemistryOverride = overrides.chemistry?.trim();
  const answerChemistryRule = chemistryOverride
    ? `CHEMISTRY OVERRIDE:\n${chemistryOverride}`
    : 'CHEMISTRY ANSWER RULE: preserve every printed formula, ion, and reaction with mhchem inside inline math (for example \\(\\ce{H2O}\\), \\(\\ce{SO4^2-}\\), \\(\\ce{2H2 + O2 -> 2H2O}\\)); keep numbers with units as ordinary math and never rewrite a printed chemical name.';
  return [
    fillTokens(resolvePrompt(overrides, 'answerKey'), { context: answerSourceContext(document, scope) }),
    answerSourceScopeRule(scope, 'answer key'),
    typeRule ? `ANSWER TYPE-SPECIFIC RULE:\n${typeRule}` : '',
    answerChemistryRule,
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
  scope?: AnswerExtractionScope,
): string {
  const questionType = resolveQuestionType(document, pageNumber, scope);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  return [
    fillTokens(resolvePrompt(overrides, 'solution'), { context: answerSourceContext(document, scope) }),
    answerSourceScopeRule(scope, 'solution'),
    typeRule ? `ANSWER TYPE-SPECIFIC RULE:\n${typeRule}` : '',
    ...chemistryExtractionRules(document, overrides),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One grouped companion PDF can alternate terse answer-key pages and full worked-solution pages.
 * It is deliberately read once into the same `answer` + `explanation` entry shape, so we never
 * duplicate the PDF or force a page to pretend it has only one role.
 */
export function companionPrompt(
  document: Document,
  pageNumber: number,
  overrides: PromptOverrides,
  scope?: AnswerExtractionScope,
): string {
  const questionType = resolveQuestionType(document, pageNumber, scope);
  const typeRule = questionType ? ANSWER_TYPE_RULES[questionType] : undefined;
  const answerOverride = overrides.answerKey?.trim();
  const solutionOverride = overrides.solution?.trim();
  return [
    `You are given one page from a GROUPED EXAM ANSWER KEY + SOLUTIONS companion PDF (${answerSourceContext(document, scope)}).`,
    answerSourceScopeRule(scope, 'solution'),
    `Return ONLY this exact JSON shape:

{
  "sections": [
    {
      "section_name": "Exercise O-1",
      "solutions": {
        "1": { "answer": "A", "explanation": null },
        "2": { "answer": "B", "explanation": "Complete worked reasoning…" }
      }
    }
  ]
}`,
    'COMPANION RULES:\n1. Include every visible section and use printed question numbers as keys.\n2. Every entry contains BOTH keys: answer is the final value when printed (else null); explanation is the full same-number working when printed (else null).\n3. A terse answer-key page therefore yields explanation: null; a worked-solution page yields the complete explanation and its final answer when stated. Never borrow content across numbered entries.\n4. Preserve math as LaTeX and do not invent a transcription for a figure; keep its question-number pairing for Verify cropping.\n5. Return valid JSON only — no prose or markdown fence.',
    typeRule ? `ANSWER TYPE-SPECIFIC RULE:\n${typeRule}` : '',
    answerOverride ? `ANSWER-KEY OVERRIDE (content rules only; keep the companion JSON shape):\n${answerOverride}` : '',
    solutionOverride ? `SOLUTION OVERRIDE (content rules only; keep the companion JSON shape):\n${solutionOverride}` : '',
    ...chemistryExtractionRules(document, overrides),
  ]
    .filter(Boolean)
    .join('\n\n');
}
