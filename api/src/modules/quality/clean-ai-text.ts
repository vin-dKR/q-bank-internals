import { repairCorruptedEscapes } from './latex-rules.js';

/**
 * Terminal "bold/colour" sequences a model sometimes emits to emphasise a word (ESC [ 1 m …). They are
 * invisible in a terminal and render as boxes in a browser.
 */
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, 'g');

/** Is this character one a question's text must never contain? Newlines and tabs are kept. */
function isStray(code: number): boolean {
  const keep = code === 0x09 || code === 0x0a || code === 0x0d;
  return !keep && (code < 0x20 || (code >= 0x7f && code <= 0x9f));
}

/**
 * Make a model's text safe to store on a live question. Three passes, in an order that matters:
 *
 * 1. Repair corrupted LaTeX escapes FIRST — a form feed before "rac" is a broken `\frac`, and stripping it as a
 *    control character would lose the command instead of restoring it.
 * 2. Remove terminal escape sequences the model used for emphasis.
 * 3. Drop any remaining control character (the model's own emphasis markers, stray vertical tabs).
 */
export function cleanAiText(text: string): string {
  const repaired = repairCorruptedEscapes(text).replace(ANSI_SEQUENCE, '');
  // Control characters are single UTF-16 units, so a per-unit scan never splits a Devanagari or emoji sequence.
  let clean = '';
  for (let at = 0; at < repaired.length; at += 1) {
    if (!isStray(repaired.charCodeAt(at))) clean += repaired.charAt(at);
  }
  return clean;
}

/** {@link cleanAiText} for a nullable field, keeping null as "the model decided nothing". */
export function cleanAiField(text: string | null): string | null {
  return text === null ? null : cleanAiText(text);
}
