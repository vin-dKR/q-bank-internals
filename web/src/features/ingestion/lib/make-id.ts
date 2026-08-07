/** A short unique id for client-side draft entities (chapters, topics, type blocks). */
export function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
