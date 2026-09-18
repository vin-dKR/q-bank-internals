/** Up to two uppercase initials from a name/email, for the row monogram. Falls back to "?". */
export function initials(source: string): string {
  const cleaned = source.trim();
  if (!cleaned) return '?';
  const words = cleaned.split(/[\s@._-]+/).filter(Boolean);
  const first = words[0] ?? cleaned;
  if (words.length <= 1) return first.slice(0, 2).toUpperCase();
  const second = words[1] ?? '';
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}
