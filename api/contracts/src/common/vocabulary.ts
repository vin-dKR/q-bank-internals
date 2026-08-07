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

/**
 * The predefined question categories, offered as first-class dropdown options. This list is the
 * operator's vocabulary for topic-level question-type configs: the AI extracts against a type chosen
 * from here and never picks or invents one (e.g. it can't relabel "only one option correct" as a
 * generic MCQ). Names follow the existing snake_case convention.
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
