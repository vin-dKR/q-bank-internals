import katex from 'katex';
import 'katex/contrib/mhchem'; // Validate chemistry with the same extension enabled in Verify.
import { LATEX_COMMAND, RAW_MATH_MARKER, joinLatex, splitLatex, type Segment } from './latex-segments.js';

/**
 * The option label a bank option string starts with ("(1) ", "(A) "), which must stay OUTSIDE the maths.
 */
const OPTION_LABEL = /^(\s*\(?\s*(?:[A-Za-z]|\d{1,2})\s*[).]\s*)/;

/** Words that mean the run is a sentence, not a formula: 4+ letters once the commands are removed. */
const PROSE_WORD = /\b[A-Za-z]{4,}\b/;

/**
 * Wrap maths that was written without `\( \)` — the renderer shows such text as raw source ("T_n \propto
 * \frac{1}{n^2}"). Only applied where the WHOLE run is a formula: a run that also carries prose is left
 * alone, because deciding where the formula starts inside a sentence is a judgement the AI refiner (or a
 * person) makes, not a rule. Returns null when there is nothing safe to do.
 */
export function wrapLooseMath(text: string): string | null {
  const { segments, unclosed } = splitLatex(text);
  // A field with an unbalanced delimiter is already broken in a way wrapping would only entrench.
  if (unclosed.length > 0) return null;

  let changed = false;
  const rewritten: Segment[] = [];
  for (const segment of segments) {
    if (segment.type !== 'text' || (!LATEX_COMMAND.test(segment.value) && !RAW_MATH_MARKER.test(segment.value))) {
      rewritten.push(segment);
      continue;
    }
    const wrapped = wrapRun(segment.value);
    if (!wrapped) return null;
    if (wrapped !== segment.value) changed = true;
    rewritten.push({ type: 'text', value: wrapped });
  }
  return changed ? joinLatex(rewritten) : null;
}

/**
 * Wrap one prose run that contains commands, keeping any option label and the surrounding spacing outside
 * the maths. Null when the run mixes maths with a sentence.
 */
function wrapRun(run: string): string | null {
  const label = OPTION_LABEL.exec(run)?.[1] ?? '';
  const body = run.slice(label.length);
  const core = body.trim();
  if (core === '') return run;
  // Single-dollar fragments are raw text in Verify. A formula such as
  // `Cl$_2$ \rightarrow I$_2$` must have those fragments merged before the whole run is wrapped;
  // otherwise KaTeX receives dollar signs nested inside \( ... \) and rejects it.
  const math = core.includes('$') ? unwrapSingleDollarMath(core) : core;
  if (math === null) return null;
  // Commands are not prose; what is left decides whether this run is a formula or a sentence.
  if (PROSE_WORD.test(math.replace(new RegExp(LATEX_COMMAND.source, 'g'), ' '))) return null;
  if (math !== core) {
    try {
      katex.renderToString(math, { throwOnError: true, strict: 'ignore' });
    } catch {
      return null;
    }
  }
  const leading = body.slice(0, body.length - body.trimStart().length);
  const trailing = body.slice(body.trimEnd().length);
  return `${label}${leading}\\(${math}\\)${trailing}`;
}

/** Only remove balanced legacy $...$ markers inside an otherwise formula-only run. */
function unwrapSingleDollarMath(core: string): string | null {
  let pairs = 0;
  const unwrapped = core.replace(/(?<!\\)\$([^$\r\n]{1,80})\$/g, (_whole, inner: string) => {
    pairs += 1;
    return inner;
  });
  return pairs > 0 && !unwrapped.includes('$') ? unwrapped : null;
}
