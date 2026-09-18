/**
 * Splitting text into prose and math exactly as the web renderer does — the one definition both the LaTeX
 * rules (what is broken) and the wrap fix (what to change) read, so a checker and its fix can never
 * disagree. Mirrors `DELIMITERS`/`toParts` in web/src/shared/lib/latex.tsx.
 */

export const DELIMITERS = [
  { open: '$$', close: '$$', display: true },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false },
] as const;

/** A run of the source: plain prose, or one math block with the delimiters it was written in. */
export type Segment =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; open: string; close: string; display: boolean };

export type SplitLatex = {
  segments: Segment[];
  /** Delimiters opened but never closed — the renderer shows everything after them as raw text. */
  unclosed: string[];
};

export function splitLatex(source: string): SplitLatex {
  const segments: Segment[] = [];
  const unclosed: string[] = [];
  let plain = '';
  let index = 0;
  while (index < source.length) {
    const delimiter = DELIMITERS.find((d) => source.startsWith(d.open, index));
    if (delimiter) {
      const end = source.indexOf(delimiter.close, index + delimiter.open.length);
      if (end !== -1) {
        if (plain) segments.push({ type: 'text', value: plain });
        plain = '';
        segments.push({
          type: 'math',
          value: source.slice(index + delimiter.open.length, end),
          open: delimiter.open,
          close: delimiter.close,
          display: delimiter.display,
        });
        index = end + delimiter.close.length;
        continue;
      }
      unclosed.push(delimiter.open);
    }
    plain += source[index] ?? '';
    index += 1;
  }
  if (plain) segments.push({ type: 'text', value: plain });
  return { segments, unclosed };
}

/** Rebuild the source from its segments, delimiters and all. */
export function joinLatex(segments: Segment[]): string {
  return segments
    .map((segment) => (segment.type === 'text' ? segment.value : `${segment.open}${segment.value}${segment.close}`))
    .join('');
}

/** LaTeX commands common enough that seeing one outside a math block means the text is unwrapped. */
export const LATEX_COMMAND =
  /\\(frac|dfrac|sqrt|times|cdot|alpha|beta|gamma|theta|lambda|mu|omega|Omega|Delta|delta|pi|sigma|phi|epsilon|vec|hat|text|mathrm|left|right|circ|infty|int|sum|lim|log|sin|cos|tan|leq?|geq?|neq|approx|pm|propto|rightarrow)(?![a-zA-Z])/;
