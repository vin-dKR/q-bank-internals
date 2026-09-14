/**
 * The exams every account sees when its `allowedExams` is empty — the product default of
 * "JEE / NEET / Boards". These are real `exam_name` VALUES as tagged in the main bank (matched
 * case-insensitively by the app). Mirrors DEFAULT_ALLOWED_EXAMS in the main app
 * (eduents: constant/question-preferences.ts) — keep the two in step.
 *
 * The ASSIGNABLE exams are NOT hardcoded: they are the live distinct `exam_name` values read from the
 * bank (see ExamAccessStore.listExamNames), so a new exam becomes assignable the moment its first
 * question is tagged — exactly what the main app's exam filter dropdown shows.
 */
export const DEFAULT_EXAM_IDS: readonly string[] = ['JEE', 'NEET', 'BOARDS'];
