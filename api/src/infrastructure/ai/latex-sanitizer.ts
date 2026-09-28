/**
 * Repair LaTeX mangled by the extraction model's JSON encoding.
 *
 * A vision model asked for mhchem `\ce{...}` reliably corrupts it: `\c` is an invalid JSON string escape,
 * so under `response_format: json_object` the model emits the control character U+001C in its place — the
 * DB ends up with `<U+001C>e{Cl2}` instead of `\ce{Cl2}` — and it also drops the `\(` / `\)` delimiters
 * (themselves invalid escapes). Ordinary math survives because the model double-escapes familiar commands
 * (`\\sqrt`), but the rarer `\ce` does not.
 *
 * The same model ALSO fails the other way — OVER-escaping — on other runs: it emits `\\(`, `\\circ`,
 * `\\text`, `\\,` (a literal double backslash) where LaTeX needs a single one, which breaks the renderer's
 * delimiter detection so the whole span shows as raw source. So the escaping is unreliable in BOTH
 * directions and must be normalised.
 *
 * Three deterministic, idempotent repairs (safe on already-correct text):
 *  1. U+001C -> `\c`, which restores the whole `\c…` family (`\ce`, `\circ`, `\cdot`, `\cos`…). A control
 *     character never appears in real exam text, so this only ever fixes corruption; any other stray
 *     control character (from a differently-mangled escape) is invisible garbage and is stripped.
 *  2. A run of 2+ backslashes immediately before a LaTeX token character (a letter or `(){}[]`, etc.) is an
 *     over-escape and collapses to one — `\\(`->`\(`, `\\circ`->`\circ`, `\\,`->`\,`. A genuine `\\` line
 *     break (only in `\begin{…}` environments) is followed by whitespace / end / another `\`, so it is left
 *     intact. A literal `\n` (an over-escaped newline) is likewise restored to a real line break, guarding
 *     LaTeX commands like `\nu` / `\ne` (a `\n` followed by a lowercase letter).
 *  3. Any bare `\ce{…}` left outside a math region is wrapped in `\(…\)` so the renderer treats it as math
 *     (the model routinely omits the delimiters). Text already inside `\(…\)` / `$$…$$` / `\[…\]` is left
 *     untouched, so a correctly-delimited `\(\ce{…}\)` is never double-wrapped.
 *  4. Inside each math span, closing braces the model dropped are appended so KaTeX doesn't reject the whole
 *     span (e.g. `\xrightarrow[\ce{NaOH}]{\ce{(CH3)2SO4}` is missing one `}`).
 */

import { stripModelControlArtifacts } from '../../shared/text/model-control-sanitizer.js';

/** The math delimiters the renderer recognises (mirrors web `shared/lib/latex.tsx`), longest-opener first. */
const MATH_REGIONS: readonly (readonly [string, string])[] = [
  ['$$', '$$'],
  ['\\[', '\\]'],
  ['\\(', '\\)'],
];

/** The model's stand-in for the invalid `\c` escape — the one control char it emits instead of `\c`. */
const CE_ESCAPE_STANDIN = String.fromCharCode(0x1c);

/**
 * Collapse an over-escaped run of 2+ backslashes to one when it precedes a LaTeX token character.
 * `\\(`->`\(`, `\\)`->`\)`, `\\circ`->`\circ`, `\\text`->`\text`, `\\,`->`\,`. A real `\\` line break sits
 * before whitespace / end-of-string / another backslash, so the negative lookahead leaves it untouched.
 */
function collapseOverEscapes(text: string): string {
  return text.replace(/\\{2,}(?=[^\s\\])/g, () => '\\');
}

/**
 * Restore literal `\n` sequences (the 2 characters backslash-n) to real line breaks. The model
 * over-escapes newlines the same way — a JSON `\\n` decodes to a literal `\n` instead of a newline. A
 * LaTeX command such as `\nu` / `\ne` / `\nabla` is `\n` followed by a lowercase letter, so the negative
 * lookahead leaves those intact and only a line-separator `\n` (before `\(`, `(`, a digit, a capital,
 * whitespace, …) is turned back into an actual newline.
 */
function restoreNewlines(text: string): string {
  return text.replace(/\\n(?![a-z])/g, '\n');
}

/**
 * Append any closing braces the model dropped inside one math span (a common truncation error — e.g.
 * `\xrightarrow[\ce{NaOH}]{\ce{(CH3)2SO4}` is missing one `}`, which makes KaTeX reject the whole span).
 * Only ever ADDS trailing `}` to rebalance; escaped `\{` / `\}` are ignored.
 */
function balanceBraces(inner: string): string {
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (i > 0 && inner.charAt(i - 1) === '\\') continue; // escaped brace/char — not a grouping brace
    const ch = inner.charAt(i);
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return depth > 0 ? inner + '}'.repeat(depth) : inner;
}

/** Rebalance dropped closing braces inside every `\(…\)` / `$$…$$` / `\[…\]` math span; prose is untouched. */
function balanceMathBraces(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const region = MATH_REGIONS.find(([open]) => text.startsWith(open, i));
    if (region) {
      const [open, close] = region;
      const end = text.indexOf(close, i + open.length);
      if (end !== -1) {
        out += open + balanceBraces(text.slice(i + open.length, end)) + close;
        i = end + close.length;
        continue;
      }
    }
    out += text.charAt(i);
    i += 1;
  }
  return out;
}

/** Wrap every bare `\ce{…}` (balanced braces) that sits outside an existing math region in `\(…\)`. */
function wrapBareChemistry(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const region = MATH_REGIONS.find(([open]) => text.startsWith(open, i));
    if (region) {
      const [open, close] = region;
      const end = text.indexOf(close, i + open.length);
      if (end !== -1) {
        out += text.slice(i, end + close.length);
        i = end + close.length;
        continue;
      }
    }
    if (text.startsWith('\\ce{', i)) {
      // Walk balanced braces from the '{' after `\ce` so nested groups (e.g. `^{3-}`) stay intact.
      let depth = 0;
      let j = i + 3;
      for (; j < text.length; j += 1) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      out += `\\(${text.slice(i, j)}\\)`;
      i = j;
      continue;
    }
    out += text.charAt(i);
    i += 1;
  }
  return out;
}

/**
 * Repair mhchem `\ce{…}` mangled by the model's JSON escaping. Idempotent, so it is safe to run on every
 * extracted string (clean text passes through unchanged). Applied to every model-produced field before it
 * is persisted (question / option / answer / explanation / passage text, and the same on re-extraction).
 */
export function sanitizeExtractedLatex(text: string): string {
  if (!text) return text;
  const unescaped = restoreNewlines(collapseOverEscapes(text.split(CE_ESCAPE_STANDIN).join('\\c')));
  return balanceMathBraces(wrapBareChemistry(stripModelControlArtifacts(unescaped)));
}
