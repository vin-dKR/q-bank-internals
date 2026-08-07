import { z } from 'zod';

/**
 * The controlled vocabulary shared across the pipeline (ingestion, documents, questions). Lives in
 * `common/` because more than one feature needs it — never re-declared per feature (§6).
 */

/** The commonly-used exams, offered as first-class dropdown options. */
export const KNOWN_EXAMS = ['JEE', 'NEET', 'BOARDS'] as const;

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

/** Whether a chapter PDF holds the questions, the answers, or the worked solutions. */
export const ChapterKindSchema = z.enum(['question', 'answer', 'solution']);
export type ChapterKind = z.infer<typeof ChapterKindSchema>;

/** The commonly-used question categories, offered as first-class dropdown options. */
export const KNOWN_QUESTION_TYPES = [
  'single_correct',
  'multi_correct',
  'integer',
  'matrix',
  'comprehension',
] as const;

/**
 * Question type is kept dynamic: the known categories above are offered as defaults, but a section
 * may carry a custom category, so any non-empty string is accepted.
 */
export const QuestionTypeSchema = z.union([z.enum(KNOWN_QUESTION_TYPES), z.string().min(1)]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;
