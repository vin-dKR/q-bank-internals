import katex from 'katex';
import { LATEX_COMMAND, splitLatex } from './latex-segments.js';
import type { AuditQuestion, RuleFinding } from './quality.types.js';

type MathRun = { math: string; display: boolean };

/**
 * A JSON-escaping bug turned backslash commands into control characters: "\frac" became FORM FEED + "rac",
 * "\text" TAB + "ext". KaTeX usually renders these without an error — just wrongly — so they are matched
 * directly. Each pattern requires the command's remaining letters, so a genuine tab or line break is not
 * reported.
 */
const CORRUPTED_ESCAPES: readonly { pattern: RegExp; command: string; letter: string }[] = [
  { pattern: /\f(?=rac|orall|lat)/g, command: '\\f (\\frac)', letter: 'f' },
  { pattern: /\t(?=ext|heta|imes|an\b|op|riangle|ilde)/g, command: '\\t (\\text, \\theta, \\times)', letter: 't' },
  // `[\b]` is the BACKSPACE character inside a class (outside one, `\b` would mean a word boundary).
  { pattern: /[\b](?=eta|ar\b|egin|ig|ot|ox|ullet)/g, command: '\\b (\\beta, \\bar, \\begin)', letter: 'b' },
  { pattern: /\v(?=ec|arepsilon|arphi|ert|dots)/g, command: '\\v (\\vec)', letter: 'v' },
  { pattern: /\r(?=ho|ight|angle|ceil|floor)/g, command: '\\r (\\rho, \\right)', letter: 'r' },
];

/**
 * Turn every corrupted escape back into its backslash command ("\f rac" → "\frac"). Only the characters the
 * patterns above match are touched — a genuine tab, newline or line break is left alone — so this is a
 * mechanical repair with nothing to decide.
 */
export function repairCorruptedEscapes(text: string): string {
  return CORRUPTED_ESCAPES.reduce((repaired, { pattern, letter }) => {
    // Two shapes exist, and they need different repairs. "\<FF>rac" kept its backslash, so only the lost
    // LETTER is put back ("\frac"); "<TAB>imes" lost the backslash with it, so the whole escape is restored
    // ("\times"). Inserting a backslash in the first case would produce "\\frac" — a LaTeX line break.
    const afterBackslash = new RegExp(`(?<=\\\\)${pattern.source}`, 'g');
    return repaired.replace(afterBackslash, letter).replace(new RegExp(pattern.source, 'g'), `\\${letter}`);
  }, text);
}

function renderError(run: MathRun): string | null {
  try {
    katex.renderToString(run.math, { displayMode: run.display, throwOnError: true, strict: 'ignore' });
    return null;
  } catch (caught) {
    // KaTeX reports malformed input by throwing; the message IS the finding, so it is returned, not swallowed.
    const message = caught instanceof Error ? caught.message : String(caught);
    return message.replace(/^KaTeX parse error: /, '');
  }
}

function excerpt(text: string, at: number): string {
  return text.slice(Math.max(0, at - 12), at + 28).replace(/\s+/g, ' ').trim();
}

function fieldFindings(field: string, source: string): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const corrupted = CORRUPTED_ESCAPES.filter(({ pattern }) => source.match(pattern)).map(({ command }) => command);
  if (corrupted.length > 0) {
    findings.push({ kind: 'latex_corrupted_escape', field, detail: `Broken escape: ${corrupted.join(', ')}.` });
  }
  const { segments, unclosed } = splitLatex(source);
  if (unclosed.length > 0) {
    findings.push({ kind: 'latex_unclosed_delimiter', field, detail: `Opened ${unclosed.join(' ')} without a closing pair.` });
  }
  const errors = segments
    .filter((segment) => segment.type === 'math')
    .map((segment) => ({ run: { math: segment.value, display: segment.display }, error: renderError({ math: segment.value, display: segment.display }) }))
    .filter((result): result is { run: MathRun; error: string } => result.error !== null);
  if (errors.length > 0) {
    const shown = errors.slice(0, 2).map(({ run, error }) => `${error} in "${run.math.slice(0, 40)}"`);
    findings.push({ kind: 'latex_parse_error', field, detail: shown.join('; ') });
  }
  for (const segment of segments) {
    if (segment.type !== 'text') continue;
    const raw = LATEX_COMMAND.exec(segment.value);
    if (raw) {
      findings.push({ kind: 'latex_outside_delimiters', field, detail: `Shown raw: "${excerpt(segment.value, raw.index)}"` });
      break;
    }
  }
  return findings;
}

/** Every LaTeX-bearing field of a question, labelled with the bank column (and index) it came from. */
function latexFields(question: AuditQuestion): [string, string][] {
  const fields: [string, string | null][] = [
    ['question_text', question.questionText],
    ['answer', question.answer],
    ['explanation', question.explanation],
    ['passage', question.passage],
    ...question.options.map((option, index): [string, string] => [`options[${String(index)}]`, option]),
    ...(question.matchColumns ?? []).flatMap((column, c) =>
      column.entries.map((entry, e): [string, string] => [`match_columns[${String(c)}].entries[${String(e)}]`, entry.body]),
    ),
  ];
  return fields.filter((pair): pair is [string, string] => pair[1] !== null && pair[1].trim() !== '');
}

/** LaTeX that would render wrongly or not at all in the web app, one finding per field and problem. */
export function detectLatexAnomalies(question: AuditQuestion): RuleFinding[] {
  return latexFields(question).flatMap(([field, source]) => fieldFindings(field, source));
}
