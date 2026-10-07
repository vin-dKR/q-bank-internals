import { z } from 'zod';

/**
 * The controlled vocabulary shared across the pipeline (ingestion, documents, questions). Lives in
 * `common/` because more than one feature needs it — never re-declared per feature (§6).
 */

/** The commonly-used exams, offered as first-class dropdown options. */
export const KNOWN_EXAMS = ['JEE', 'NEET', 'BOARDS'] as const;

/**
 * School-grade labels offered when a chapter is filed under CBSE. Keep the display value canonical so
 * the same class survives cut/upload, verification, and the published bank without a second mapping.
 */
export const CBSE_CLASS_NAMES = [
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
] as const;

/**
 * Board-level papers need a school class. `BOARDS` is the app's generic board option, while some
 * imports use the explicit `CBSE` name; treat both alike without closing the dynamic exam vocabulary.
 */
export function isCbseExam(exam: string | null | undefined): boolean {
  return /\b(?:cbse|boards?)\b/i.test(exam?.trim() ?? '');
}

/** A class can optionally help classify board material and NCERT textbooks/modules. */
export function shouldCollectClassName(
  exam: string | null | undefined,
  module: string | null | undefined,
): boolean {
  return isCbseExam(exam) || /\bncert\b/i.test(module?.trim() ?? '');
}

/**
 * Exam a chapter's questions belong to. Kept dynamic like {@link QuestionTypeSchema}: the known
 * exams above are offered as defaults, but the masters Drive tree can introduce new exams, so any
 * non-empty string is accepted.
 */
export const ExamSchema = z.union([z.enum(KNOWN_EXAMS), z.string().min(1)]);
export type Exam = z.infer<typeof ExamSchema>;

/** The commonly-used source/coaching modules, offered as first-class dropdown options. */
export const KNOWN_MODULES = ['Allen', 'Motion', 'Resonance', 'PW', 'Unacademy'] as const;

/**
 * Source/coaching module the material comes from. Kept dynamic like {@link ExamSchema} — the
 * masters Drive tree can introduce new modules.
 */
export const ModuleSchema = z.union([z.enum(KNOWN_MODULES), z.string().min(1)]);
export type Module = z.infer<typeof ModuleSchema>;

/**
 * Which role a chapter PDF has within one upload group.
 *
 * `companion` is a deliberately distinct role for a grouped Answer + Solution PDF: unlike the
 * historical `answer` and `solution` siblings, both are read from the same source document.
 */
export const ChapterKindSchema = z.enum(['question', 'answer', 'solution', 'companion']);
export type ChapterKind = z.infer<typeof ChapterKindSchema>;

/**
 * Where a chapter's questions originate: previous-year papers, a coaching module, or a textbook.
 * The operator picks this once per chapter so every extracted question records its provenance.
 */
export const KNOWN_SOURCES = ['pyq', 'module', 'textbook'] as const;

/**
 * Question source. Kept dynamic like {@link ExamSchema} / {@link ModuleSchema} — the three known
 * sources above seed the dropdown, but any non-empty string is accepted for a future source kind.
 */
export const SourceSchema = z.union([z.enum(KNOWN_SOURCES), z.string().min(1)]);
export type Source = z.infer<typeof SourceSchema>;

/**
 * The predefined question categories, offered as first-class dropdown options. This list is the
 * vocabulary for topic-level question-type configs. Structure detection can propose a category
 * supported by reviewed OCR text; content extraction uses the operator-approved type from here.
 * Neither step invents categories. Names follow the existing snake_case convention.
 */
export const KNOWN_QUESTION_TYPES = [
  'single_correct', // MCQ, exactly one option correct
  'multi_correct', // MCQ, one or more options correct
  'integer', // integer / numerical-value answer
  'matrix', // matrix match (column matching)
  'comprehension', // passage-based question group
  'assertion_reason', // assertion (A) + reason (R) evaluation
  'true_false', // true / false judgement
  'fill_blank', // fill in the blank
  'subjective', // subjective / descriptive, no options
] as const;

/**
 * Question type is kept dynamic: the known categories above are offered as defaults, but a section
 * may carry a custom category, so any non-empty string is accepted.
 */
export const QuestionTypeSchema = z.union([z.enum(KNOWN_QUESTION_TYPES), z.string().min(1)]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/**
 * Per-question difficulty. A CLOSED vocabulary (unlike the exam/type dynamic unions): the AI classifies
 * every extracted question as exactly one of these, and the operator picks from the same three on the
 * Verify screen. Resolved to the `Level` dictionary (easy→hard rank 1/2/3) by the publisher.
 */
export const KNOWN_LEVELS = ['easy', 'medium', 'hard'] as const;
export const LevelSchema = z.enum(KNOWN_LEVELS);
export type Level = z.infer<typeof LevelSchema>;
