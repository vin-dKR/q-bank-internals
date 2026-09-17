/**
 * Pure, dependency-free canonicalization for the Question taxonomy.
 *
 * This is a VERBATIM copy of eduents' `lib/taxonomy/foldMaps.ts` (the single source of truth for how
 * a dirty raw string folds to a canonical dictionary entry), kept byte-identical in its logic so the
 * two writers of the shared bank NEVER drift and the bank can never re-dirty. It is imported by the
 * masters module (dictionary CRUD + seeding), the publish taxonomy resolver, and extraction. It has
 * NO imports on purpose so it stays a safe verbatim copy — see eduents docs/DB_REDESIGN_PLAN.md §9 and
 * docs/QUESTION_WRITE_CONTRACT.md §2.
 *
 * The `canonicalizeMaster` dispatcher + `CANONICAL_*` seed lists at the bottom are ADDITIVE ingest-side
 * conveniences (masters seeding + exam/topic key rules); they do not alter any fold logic above.
 *
 * CLOSED vs OPEN vocabularies:
 *   - question_type is CLOSED: 7 canonical kinds. An unrecognised value returns null (FK stays null,
 *     raw preserved) rather than polluting the dictionary with junk like "CBSE" / "Quantum number".
 *   - subject / chapter / section are OPEN: a genuinely new value self-registers (like Exam), except
 *     for an explicit junk/low-confidence deny-list.
 */

export type Canonical = { key: string; name: string; kind?: string };

/** Case-fold + collapse internal whitespace. The matching key everywhere. */
export const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A stable slug for auto-registered (open-vocab) values. */
export const slug = (s: string): string =>
  norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || '_';

// ── Universal junk: raw values carrying no taxonomic meaning → FK null ──
const JUNK = new Set(['', 'na', 'n/a', 'none', 'null', '-', 'all', 'asdf', 'assadfdf']);

/** Section values that are real strings but too ambiguous to key (default #5). */
const SECTION_LOW_CONFIDENCE = new Set(['a', '1', '2', '3', '4', '5', 'all sections']);

export function isJunk(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  return JUNK.has(norm(raw));
}

// ─────────────────────────── question_type (CLOSED) ───────────────────────────
// kind ∈ single | multi | subjective | comprehension | matrix | integer | assertion_reason
const QUESTION_TYPE: Record<string, Canonical> = {};
function regType(kind: string, name: string, spellings: string[]): void {
  for (const s of spellings) QUESTION_TYPE[norm(s)] = { key: kind, name, kind };
}
regType('single', 'Single Correct', [
  'single_correct', 'SINGLE CORRECT TYPE QUESTIONS', 'Single Correct Type Questions',
  'Single Correct Type', 'SINGLE CORRECT', 'Single Correct', 'Single correct',
  'SINGLE CORRECT CHOICE TYPE', 'STRAIGHT OBJECTIVE TYPE',
  'SELECT THE CORRECT ALTERNATIVE (ONLY ONE CORRECT ANSWER)',
  'SELECT ONLY ONE IS CORRECT OPTIONS',
  'MULTIPLE CHOICE QUESTIONS WITH ONE CORRECT ANSWER', 'SINGLE CHOICE OBJECTIVE TYPE',
]);
regType('multi', 'Multiple Correct', [
  'MULTIPLE CORRECT TYPE QUESTIONS', 'Multiple Correct Type Questions', 'multi_correct',
  'MORE THAN ONE MAY BE CORRECT',
  'SELECT THE CORRECT ALTERNATIVES (ONE OR MORE THEN ONE CORRECT ANSWERS)',
  'SELECT MORE THAN ONE IS CORRECT OPTIONS', 'MULTIPLE OBJECTIVE TYPE',
  'MULTIPLE CORRECT CHOICE TYPE', 'Multiple Correct', 'MULTIPLE CORRECT',
]);
regType('subjective', 'Subjective', [
  'Subjective', 'SUBJECTIVE', 'subjective', 'Subjective Type', 'FILL IN THE BLANKS', 'TRUE/FALSE',
]);
regType('comprehension', 'Comprehension', [
  'COMPREHENSION TYPE QUESTIONS', 'Comprehension Type Questions', 'comprehension',
  '[COMPREHENSION TYPE]', 'COMPREHENSION TYPE',
]);
regType('matrix', 'Matrix Match', [
  'MATRIX MATCH TYPE QUESTION', 'matrix', 'Matrix Match Type Question',
  'MATRIX MATCH TYPE QUESTIONS', 'Matrix Match',
  'MATCHING LIST TYPE 1 × 3 Q. (THREE LIST TYPE Q.)',
  'MATCHING LIST TYPE (4 x 4 x 4) MULTIPLE OPTION CORRECT', 'MATRIX MATCH TYPE', 'MATRIX TYPE',
]);
regType('integer', 'Integer', ['integer']);
regType('assertion_reason', 'Assertion & Reason', [
  'REASONING TYPE', 'Assertion & Reasoning type questions', 'Asseration and Reason', '[REASONING TYPE]',
]);

/** All canonical question kinds, for seeding + UI. */
export const QUESTION_KINDS: Canonical[] = [
  { key: 'single', name: 'Single Correct', kind: 'single' },
  { key: 'multi', name: 'Multiple Correct', kind: 'multi' },
  { key: 'subjective', name: 'Subjective', kind: 'subjective' },
  { key: 'comprehension', name: 'Comprehension', kind: 'comprehension' },
  { key: 'matrix', name: 'Matrix Match', kind: 'matrix' },
  { key: 'integer', name: 'Integer', kind: 'integer' },
  { key: 'assertion_reason', name: 'Assertion & Reason', kind: 'assertion_reason' },
];

// ─────────────────────────────── level (CLOSED) ───────────────────────────────
// Difficulty: easy | medium | hard, ranked for easy→hard sorting. Brand-new dimension — no legacy
// data — so aliases are liberal to absorb whatever spelling the ingest/editor difficulty picker sends.
const LEVEL: Record<string, Canonical> = {};
const LEVEL_RANK: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
function regLevel(key: string, name: string, spellings: string[]): void {
  for (const s of spellings) LEVEL[norm(s)] = { key, name, kind: key };
}
regLevel('easy', 'Easy', ['easy', 'e', '1', 'low', 'beginner', 'basic']);
regLevel('medium', 'Medium', ['medium', 'med', 'm', '2', 'moderate', 'intermediate', 'average']);
regLevel('hard', 'Hard', ['hard', 'h', '3', 'difficult', 'tough', 'advanced', 'high']);

/** All canonical levels, for seeding + UI. */
export const LEVELS: { key: string; name: string; rank: number }[] = [
  { key: 'easy', name: 'Easy', rank: 1 },
  { key: 'medium', name: 'Medium', rank: 2 },
  { key: 'hard', name: 'Hard', rank: 3 },
];

export const levelRank = (key: string): number | null => LEVEL_RANK[key] ?? null;

/** CLOSED vocab: recognised → canonical; junk/unknown → null. */
export function canonicalizeLevel(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  return LEVEL[norm(raw as string)] ?? null;
}

// ─────────────────────────────── subject (OPEN) ───────────────────────────────
const SUBJECT: Record<string, Canonical> = {};
function regSubject(key: string, name: string, spellings: string[]): void {
  for (const s of spellings) SUBJECT[norm(s)] = { key, name };
}
regSubject('physics', 'Physics', ['Physics']);
regSubject('mathematics', 'Mathematics', ['Mathematics', 'Math', 'Maths']);
regSubject('chemistry', 'Chemistry', ['Chemistry']);
regSubject('biology', 'Biology', ['Biology']);
regSubject('hindi', 'Hindi', ['Hindi']);
regSubject('english', 'English', ['English']);
regSubject('social_science', 'Social Science', ['Social Science', 'SST']);
regSubject('science', 'Science', ['Science']);
regSubject('math_and_science', 'Mathematics and Science', ['Mathematics and Science']);
regSubject('cdp', 'Child Development and Pedagogy', ['Child Development and Pedagogy', 'CDP']);
regSubject('khorta', 'Khorta', ['Khorta']);
regSubject('bengali', 'Bengali', ['Bengla', 'Bengali']);

// ─────────────────────────────── section (OPEN) ───────────────────────────────
const SECTION: Record<string, Canonical> = {};
function regSection(key: string, name: string, spellings: string[]): void {
  for (const s of spellings) SECTION[norm(s)] = { key, name };
}
regSection('exercise_o1', 'Exercise (O-1)', ['EXERCISE (O-1)', 'EXERCISE # O-1']);
regSection('exercise_o2', 'Exercise (O-2)', ['EXERCISE (O-2)', 'EXERCISE # O-2']);
regSection('exercise_s1', 'Exercise (S-1)', ['EXERCISE (S-1)', 'EXERCISE # S-1']);
regSection('exercise_s2', 'Exercise (S-2)', ['EXERCISE (S-2)', 'EXERCISE # S-2']);
regSection('exercise_jm', 'Exercise (JEE Main)', ['EXERCISE (J-M)', 'EXERCISE (JM)', 'EXERCISE # J-MAINS']);
regSection('exercise_ja', 'Exercise (JEE Advanced)', ['EXERCISE (J-A)', 'EXERCISE (JA)', 'EXERCISE # J-ADVANCE']);
regSection('exercise_1', 'Exercise 1', [
  'Exercise-1', 'EXERCISE-I', 'Excerise-1', 'EXERCISE-I (Conceptual Questions)', 'EXERCISE-1', 'Exercise-I',
]);
regSection('exercise_2', 'Exercise 2', ['Excerise-2', 'Exercise-2', 'EXERCISE-II', 'EXERCISE-2']);
regSection('exercise_3', 'Exercise 3', ['Excerise-3', 'Exercise-3', 'EXERCISE-3', 'EXERCISE-III']);
regSection('exercise_cbse', 'Exercise (CBSE)', ['EXERCISE (CBSE)']);
regSection('pyq', 'Previous Year Questions', ['PYQ']);
regSection('exercise_eh', 'Exercise (EH)', ['EXERCISE (EH)', 'EXERCISE (EH0100)']);
regSection('exercise_e', 'Exercise (E)', ['EXERCISE (E)']);
regSection('exercise_wa', 'Exercise (WA)', ['EXERCISE (WA)']);
regSection('exercise_rd', 'Exercise (RD)', ['EXERCISE (RD)']);
regSection('exercise_kt', 'Exercise (KT)', ['EXERCISE (KT)']);

// ──────────────────────────── public canonicalizers ────────────────────────────

/** CLOSED vocab: recognised → canonical; junk/unknown → null (remediate). */
export function canonicalizeQuestionType(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  return QUESTION_TYPE[norm(raw as string)] ?? null;
}

export function canonicalizeSubject(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  const k = norm(raw as string);
  return SUBJECT[k] ?? { key: slug(raw as string), name: (raw as string).trim() };
}

export function canonicalizeSection(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  const k = norm(raw as string);
  if (SECTION_LOW_CONFIDENCE.has(k)) return null;
  return SECTION[k] ?? { key: slug(raw as string), name: (raw as string).trim() };
}

export function canonicalizeChapter(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  return { key: slug(raw as string), name: (raw as string).trim() };
}

export type Dimension = 'subject' | 'chapter' | 'section' | 'questionType' | 'level';

export function canonicalize(dim: Dimension, raw: string | null | undefined): Canonical | null {
  switch (dim) {
    case 'subject': return canonicalizeSubject(raw);
    case 'chapter': return canonicalizeChapter(raw);
    case 'section': return canonicalizeSection(raw);
    case 'questionType': return canonicalizeQuestionType(raw);
    case 'level': return canonicalizeLevel(raw);
  }
}

/**
 * Structural override for question kind: a row with a passage/group is a comprehension, a row with
 * match data is a matrix — regardless of the (often junk) type string. The read path keeps the same
 * OR-fallback on group_id / match_columns, so this only DENORMALISES what structure already implies.
 */
export function deriveKindFromStructure(row: {
  group_id?: unknown; passage?: unknown; match_columns?: unknown; match_key?: unknown;
}): string | null {
  if (row.group_id != null || (typeof row.passage === 'string' && row.passage.trim())) return 'comprehension';
  if (row.match_columns != null || row.match_key != null) return 'matrix';
  return null;
}

// ─────────────────────── ADDITIVE ingest helpers (below) ───────────────────────
// Everything above is a verbatim copy of eduents foldMaps. The rest is ingest-only: a 7-dimension
// dispatcher covering exam/topic (which eduents resolves elsewhere) and canonical seed lists for the
// masters "Seed canonical" action. None of this changes the fold logic above.

/** Exam key rule mirrors eduents' resolveOrCreateExam: `norm(name)`; junk → null. */
export function canonicalizeExam(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  return { key: norm(raw as string), name: (raw as string).trim() };
}

/** Topic is a Phase-2 open dimension; slug its raw value into a stable key. */
export function canonicalizeTopic(raw: string | null | undefined): Canonical | null {
  if (isJunk(raw)) return null;
  return { key: slug(raw as string), name: (raw as string).trim() };
}

/** The full set of managed masters dimensions. */
export type MasterDimension =
  | 'exam' | 'subject' | 'chapter' | 'section' | 'questionType' | 'level' | 'topic';

/** One-stop canonicalizer across every managed dimension (junk / unknown-closed → null). */
export function canonicalizeMaster(dim: MasterDimension, raw: string | null | undefined): Canonical | null {
  switch (dim) {
    case 'exam': return canonicalizeExam(raw);
    case 'subject': return canonicalizeSubject(raw);
    case 'chapter': return canonicalizeChapter(raw);
    case 'section': return canonicalizeSection(raw);
    case 'questionType': return canonicalizeQuestionType(raw);
    case 'level': return canonicalizeLevel(raw);
    case 'topic': return canonicalizeTopic(raw);
  }
}

/** Whether a dimension's vocabulary is closed (fixed kinds/levels) — create is restricted to it. */
export const CLOSED_MASTER_DIMENSIONS: ReadonlySet<MasterDimension> = new Set(['questionType', 'level']);

/** Distinct canonical rows behind a fold registry, aliases collected from every spelling that folds in. */
function canonicalRows(registry: Record<string, Canonical>): { key: string; name: string; aliases: string[] }[] {
  const byKey = new Map<string, { key: string; name: string; aliases: Set<string> }>();
  for (const canon of Object.values(registry)) {
    const row = byKey.get(canon.key) ?? { key: canon.key, name: canon.name, aliases: new Set<string>() };
    row.aliases.add(canon.name);
    byKey.set(canon.key, row);
  }
  return [...byKey.values()].map((r) => ({ key: r.key, name: r.name, aliases: [...r.aliases] }));
}

/** Curated canonical subjects — the "Seed canonical" starting set for the Subject master. */
export const CANONICAL_SUBJECTS = canonicalRows(SUBJECT);
/** Curated canonical sections — the "Seed canonical" starting set for the Section master. */
export const CANONICAL_SECTIONS = canonicalRows(SECTION);

// The ingest operator/AI vocabulary (contracts KNOWN_QUESTION_TYPES) uses tokens the eduents bank's
// dirty spellings never contained, so register them here as additive aliases that fold to the SAME
// canonical kind eduents converges on — `true_false`/`fill_blank` → subjective (matching eduents'
// "TRUE/FALSE"/"FILL IN THE BLANKS"), `assertion_reason` → its own kind. This leaves the verbatim
// block above untouched while ensuring every value the ingest pipeline emits resolves to the right
// QuestionType row instead of returning null. `single_correct`/`multi_correct`/`integer`/`matrix`/
// `comprehension`/`subjective` already fold via the block above.
regType('subjective', 'Subjective', ['true_false', 'fill_blank']);
regType('assertion_reason', 'Assertion & Reason', ['assertion_reason']);
