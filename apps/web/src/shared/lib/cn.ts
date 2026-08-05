/** Join conditional className parts — the one class-merging helper (keeps JSX class logic tidy). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
