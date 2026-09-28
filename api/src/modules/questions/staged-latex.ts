import type { LatexIssue, MatchData, Passage, Question, UpdateQuestion } from '@ingest/contracts';
import { detectLatexInField, repairCorruptedEscapes } from '../quality/latex-rules.js';
import { wrapLooseMath } from '../quality/latex-wrap.js';

/** A field that the Verify renderer treats as LaTeX-bearing text. Passage text is stored only once. */
export type StagedLatexField = {
  key: string;
  questionId: string | null;
  questionNumber: number | null;
  field: string;
  text: string;
};

export function stagedLatexFields(questions: Question[], passages: Passage[]): StagedLatexField[] {
  const fields: StagedLatexField[] = [];
  for (const question of questions) {
    const add = (field: string, text: string | null): void => {
      if (text?.trim()) fields.push({
        key: `q:${question.id}:${field}`, questionId: question.id,
        questionNumber: question.questionNumber, field, text,
      });
    };
    add('stem', question.stem);
    add('answer', question.answer);
    add('explanation', question.explanation);
    question.options.forEach((option, index) => { add(`options.${String(index)}`, option.body); });
    question.match?.columns.forEach((column, columnIndex) => {
      column.entries.forEach((entry, entryIndex) => {
        add(`match.${String(columnIndex)}.${String(entryIndex)}`, entry.body);
      });
    });
  }
  for (const passage of passages) {
    if (!passage.text.trim()) continue;
    fields.push({
      key: `p:${passage.id}`, questionId: null, questionNumber: null,
      field: 'passage', text: passage.text,
    });
  }
  return fields;
}

export function automaticLatexRepair(text: string): string {
  const repaired = repairCorruptedEscapes(text);
  return wrapLooseMath(repaired) ?? repaired;
}

/** Offer a code-only fix only when it clears every finding in this field. */
export function fullyAutomaticLatexRepair(field: string, text: string): string | null {
  if (detectLatexInField(field, text).length === 0) return null;
  const repaired = automaticLatexRepair(text);
  if (repaired === text || !repaired.trim()) return null;
  return detectLatexInField(field, repaired).length === 0 ? repaired : null;
}

const CONTENTLESS_LATEX_COMMANDS = new Set([
  'ce', 'text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname',
  'frac', 'dfrac', 'tfrac', 'sqrt', 'left', 'right', 'overline', 'underline',
  'boxed', 'displaystyle', 'textstyle', 'begin', 'end', 'quad', 'qquad',
]);

/** A comparison view that ignores LaTeX wrappers while retaining the extracted words, values and operators. */
function extractedContentTokens(text: string): string[] {
  const normalized = text
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (digit) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)))
    .replace(/\\(?:longrightarrow|rightarrow|to)\b|[→⟶]/g, ' ARROW ')
    .replace(/\\(?:times|cdot)\b|[×·]/g, ' MULTIPLY ')
    .replace(/\\(?:leq?|le)\b|≤/g, ' LESS_EQUAL ')
    .replace(/\\(?:geq?|ge)\b|≥/g, ' GREATER_EQUAL ')
    .replace(/\\(?:neq|ne)\b|≠/g, ' NOT_EQUAL ')
    .replace(/\\(?:pm)\b|±/g, ' PLUS_MINUS ')
    .replace(/\\approx\b|≈/g, ' APPROX ')
    .replace(/\\propto\b|∝/g, ' PROPORTIONAL ')
    .replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (command, name: string) =>
      CONTENTLESS_LATEX_COMMANDS.has(name) ? ' ' : ` ${name} `)
    .replace(/\\[,;! ]/g, ' ')
    .replace(/[${}_^\\]/g, ' ');
  return normalized.match(/[A-Za-z]+|\d+(?:\.\d+)?|[=+\-<>]/g) ?? [];
}

/** Reject AI output that drops, adds or reorders extracted words, numbers, variables or key operators. */
export function preservesExtractedContent(original: string, candidate: string): boolean {
  return JSON.stringify(extractedContentTokens(original)) === JSON.stringify(extractedContentTokens(candidate));
}

export function stagedLatexIssues(fields: StagedLatexField[]): LatexIssue[] {
  return fields.flatMap((field) => {
    const findings = detectLatexInField(field.field, field.text);
    const automatic = findings.length > 0 && fullyAutomaticLatexRepair(field.field, field.text) !== null;
    return findings.map((finding) => ({
      key: field.key, questionId: field.questionId, questionNumber: field.questionNumber,
      field: field.field, kind: finding.kind, detail: finding.detail, automatic,
    }));
  });
}

/** Build one narrow Verify patch from a fresh row, preserving other edits and option/match metadata. */
export function questionLatexPatch(question: Question, field: string, text: string): UpdateQuestion | null {
  if (field === 'stem') return { stem: text };
  if (field === 'answer') return { answer: text };
  if (field === 'explanation') return { explanation: text };
  const option = /^options\.(\d+)$/.exec(field);
  if (option) {
    const index = Number(option[1]);
    if (!question.options[index]) return null;
    return { options: question.options.map((item, at) => at === index ? { ...item, body: text } : item) };
  }
  const match = /^match\.(\d+)\.(\d+)$/.exec(field);
  if (match && question.match) {
    const columnIndex = Number(match[1]);
    const entryIndex = Number(match[2]);
    if (!question.match.columns[columnIndex]?.entries[entryIndex]) return null;
    const next: MatchData = {
      ...question.match,
      columns: question.match.columns.map((column, at) => at === columnIndex
        ? { ...column, entries: column.entries.map((entry, inner) => inner === entryIndex ? { ...entry, body: text } : entry) }
        : column),
    };
    return { match: next };
  }
  return null;
}
