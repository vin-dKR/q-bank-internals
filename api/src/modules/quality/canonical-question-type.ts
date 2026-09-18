import { KNOWN_QUESTION_TYPES } from '@ingest/contracts';

type KnownQuestionType = (typeof KNOWN_QUESTION_TYPES)[number];

/**
 * How a stored `question_type` relates to the standard vocabulary. Legacy rows carry the source PDF's
 * section heading ("SINGLE CORRECT TYPE QUESTIONS", "STRAIGHT OBJECTIVE TYPE") rather than a type code,
 * and some carry values that are not a type at all ("CBSE-2010", "EM0033").
 */
export type CanonicalQuestionType =
  | { status: 'missing' }
  | { status: 'known'; type: KnownQuestionType; exact: boolean }
  | { status: 'unrecognised' };

const KNOWN = new Set<string>(KNOWN_QUESTION_TYPES);

function isKnown(value: string): value is KnownQuestionType {
  return KNOWN.has(value);
}

/**
 * Heading phrases mapped to the type they announce, checked in order — the order carries the meaning:
 *
 * 1. Matrix/comprehension/assertion first: their headings often also say "multiple option correct".
 * 2. Then phrases that EXPLICITLY allow several answers ("more than one", "one or more").
 * 3. Then phrases that explicitly allow exactly one — "MULTIPLE CHOICE QUESTIONS WITH ONE CORRECT ANSWER"
 *    is single-correct, and would be read as multi by a bare "multiple" test.
 * 4. Only then the loose "multiple/objective" fallback.
 */
const HEADING_PATTERNS: readonly [RegExp, KnownQuestionType][] = [
  [/matrix|matching list|match the/, 'matrix'],
  [/comprehension|passage|paragraph/, 'comprehension'],
  [/assert|reason/, 'assertion_reason'],
  [/true\s*\/?\s*(or\s*)?false/, 'true_false'],
  [/fill in|blank/, 'fill_blank'],
  [/integer|numerical/, 'integer'],
  [/subjective/, 'subjective'],
  [/more than one|one or more|multiple correct|multiple option correct/, 'multi_correct'],
  [/only one|one correct|single|straight objective/, 'single_correct'],
  [/multiple|multi/, 'multi_correct'],
];

export function canonicalQuestionType(raw: string | null): CanonicalQuestionType {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return { status: 'missing' };
  const code = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (isKnown(code)) return { status: 'known', type: code, exact: code === trimmed };
  const heading = trimmed.toLowerCase().replace(/[[\]]/g, '');
  const match = HEADING_PATTERNS.find(([pattern]) => pattern.test(heading));
  return match ? { status: 'known', type: match[1], exact: false } : { status: 'unrecognised' };
}
