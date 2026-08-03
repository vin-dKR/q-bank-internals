import { z } from 'zod';

/**
 * The controlled vocabulary shared across the pipeline (ingestion, documents, questions). Lives in
 * `common/` because more than one feature needs it — never re-declared per feature (§6).
 */

/** Exam a chapter's questions belong to. */
export const ExamSchema = z.enum(['JEE', 'NEET', 'BOARDS']);
export type Exam = z.infer<typeof ExamSchema>;

/** Source/coaching module the material comes from. */
export const ModuleSchema = z.enum(['Allen', 'Motion', 'Resonance', 'PW', 'Unacademy']);
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
