/**
 * Case, punctuation and "&" vs "and" differ harmlessly between the bank and a syllabus; the words do not.
 * Used to match a question's stored exam/subject/chapter against a syllabus, and to tell two uploaded
 * exams apart.
 */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Whether `key` (an already-normalised name) is this thing's own name or one of its aliases. */
export function isCalled(key: string, name: string, aliases: readonly string[]): boolean {
  return [name, ...aliases].some((candidate) => nameKey(candidate) === key);
}
