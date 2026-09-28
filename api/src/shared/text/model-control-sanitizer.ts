/**
 * Remove non-content terminal/control artifacts that an AI can place in otherwise ordinary text.
 *
 * These are deliberately separate from LaTeX repairs: a raw ESC byte cannot be rendered in a browser,
 * but simply deleting it leaves the ANSI payload (`[1m`, `[0m`) visible. Strip the WHOLE escape sequence
 * first, then drop remaining controls and invisible formatting markers. Tabs and line breaks remain
 * valid document content.
 */

// Build these patterns from escaped source instead of placing terminal controls in RegExp literals.
// This keeps the sanitizer readable to linters and prevents a source editor from hiding the characters
// that the sanitizer itself must remove.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ST = String.fromCharCode(0x9c);
const C1_CSI_CHAR = String.fromCharCode(0x9b);
const C1_OSC_CHAR = String.fromCharCode(0x9d);
const C1_STRING_START = [0x90, 0x98, 0x9e, 0x9f]
  .map((code) => String.fromCharCode(code))
  .join('');

/** ANSI CSI, including an incomplete sequence so a malformed emphasis marker cannot leak `[1` text. */
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]?`, 'g');
/** ANSI operating-system command, terminated by BEL, ST, or end-of-text when malformed. */
const ANSI_OSC = new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\|${ST}|$)`, 'g');
/** Other ANSI string controls (DCS/SOS/PM/APC), which are all terminated by ST or end-of-text. */
const ANSI_STRING = new RegExp(`${ESC}[PX^_][\\s\\S]*?(?:${ESC}\\\\|${ST}|$)`, 'g');
/** Single-shift/control escape forms that do not use CSI/OSC. */
const ANSI_ESCAPE = new RegExp(`${ESC}(?:[()#%][0-?]*[ -/]*[@-~]?|[@-_])`, 'g');
/** Eight-bit variants occasionally copied from a terminal or OCR stream. */
const C1_CSI = new RegExp(`${C1_CSI_CHAR}[0-?]*[ -/]*[@-~]?`, 'g');
const C1_OSC = new RegExp(`${C1_OSC_CHAR}[\\s\\S]*?(?:${BEL}|${ST}|$)`, 'g');
const C1_STRING = new RegExp(`[${C1_STRING_START}][\\s\\S]*?(?:${ST}|$)`, 'g');

/** Formatting characters that are invisible in normal text and can conceal/reorder model output. */
const INVISIBLE_FORMAT_CODES = new Set<number>([
  0x00ad,
  0x034f,
  0x061c,
  0x180e,
  0x200b,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2060,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0xfeff,
]);

function stripTerminalSequences(text: string): string {
  return text
    .replace(ANSI_OSC, '')
    .replace(ANSI_STRING, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_ESCAPE, '')
    .replace(C1_OSC, '')
    .replace(C1_STRING, '')
    .replace(C1_CSI, '');
}

/** Keep printable Unicode plus the whitespace controls that legitimately occur in source material. */
function stripRemainingControls(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    const allowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (allowedWhitespace || (code >= 0x20 && !(code >= 0x7f && code <= 0x9f))) out += char;
  }
  return out;
}

function stripInvisibleFormatMarkers(text: string): string {
  let out = '';
  for (const char of text) {
    if (!INVISIBLE_FORMAT_CODES.has(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/**
 * Safely remove terminal formatting, invisible markers, and stray controls from model-produced text.
 * It is idempotent and intentionally does not collapse ordinary Unicode, spacing, or LaTeX escapes.
 */
export function stripModelControlArtifacts(text: string): string {
  return stripRemainingControls(stripInvisibleFormatMarkers(stripTerminalSequences(text)));
}
