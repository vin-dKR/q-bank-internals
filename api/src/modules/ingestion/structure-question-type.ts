import { KNOWN_QUESTION_TYPES } from '@ingest/contracts';
export { StructureQuestionTypeObservationSchema } from '@ingest/contracts';

type KnownQuestionType = (typeof KNOWN_QUESTION_TYPES)[number];
export type StructureQuestionTypeEvidence = { printed: string; value: KnownQuestionType };

// Require an explicit category in the reviewed text. Generic "Objective"/"MCQ" labels
// cannot establish whether one or several options are correct.
const descriptors: Record<KnownQuestionType, RegExp> = {
  single_correct:
    /\b(?:single[\s-]+(?:correct|choice)|(?:only|exactly)\s+one\s+(?:option|answer)(?:\s+is)?\s+correct|one\s+correct\s+(?:option|answer))\b/iu,
  multi_correct:
    /\b(?:multi(?:ple)?[\s-]+correct|multi[\s-]+select|(?:one\s+or\s+more|more\s+than\s+one)\s+(?:options?|answers?)(?:\s+(?:is|are))?\s+correct)\b/iu,
  integer: /\b(?:integer(?:[\s-]+(?:type|answer))?|numerical[\s-]+(?:value|answer|type))\b/iu,
  matrix:
    /\b(?:matrix[\s-]+match(?:ing)?|(?:match(?:ing)?\s+(?:the\s+)?columns?|column[\s-]+match(?:ing)?))\b/iu,
  comprehension: /\b(?:comprehension|passage[\s-]+based)\b/iu,
  assertion_reason: /\bassertion\s*(?:[&/–—-]|and)?\s*reason(?:ing)?\b/iu,
  true_false: /\btrue\s*(?:[&/–—-]|or|and)\s*false\b/iu,
  fill_blank: /\bfill(?:ing)?\s*(?:[–—-]|in\s+)?(?:the\s+)?blanks?\b/iu,
  subjective: /\b(?:subjective|descriptive)(?:[\s-]+questions?)?\b/iu,
};

/** Evidence is tied to the current crop; neither examples nor chapter metadata qualify. */
export function structureQuestionTypeEvidence(
  lines: readonly string[],
): StructureQuestionTypeEvidence[] {
  const result: StructureQuestionTypeEvidence[] = [];
  for (const line of lines) {
    const printed = line.trim();
    if (!printed || printed.length > 500) continue;
    const normalized = printed.normalize('NFKC');
    const matches = KNOWN_QUESTION_TYPES.filter((type) => descriptors[type].test(normalized));
    // A line naming several different categories does not identify one applicable type.
    const value = matches.length === 1 ? matches[0] : undefined;
    if (value && !result.some((item) => item.printed === printed)) result.push({ printed, value });
  }
  return result;
}
