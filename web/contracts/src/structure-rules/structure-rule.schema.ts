import { z } from 'zod';
import { KNOWN_SOURCES } from '../common/vocabulary.js';
import type { StructureDetectionContext } from '../ingestion/structure-detection.schema.js';
import { structureLabelFromHeading, isPrintedTopicLabel } from '../ingestion/structure-label.js';

export const StructureRuleSourceSchema = z.enum(KNOWN_SOURCES);
export type StructureRuleSource = z.infer<typeof StructureRuleSourceSchema>;
export const StructureRuleScopeSchema = z
  .object({
    source: StructureRuleSourceSchema,
    provider: z.string().trim().min(1).max(160),
  })
  .strict();
export type StructureRuleScope = z.infer<typeof StructureRuleScopeSchema>;
export const StructureExamplesSchema = z
  .object({
    section: z.string().trim().max(500),
    part: z.string().trim().max(500),
    topic: z.string().trim().max(500),
  })
  .strict();
export type StructureExamples = z.infer<typeof StructureExamplesSchema>;
export const EMPTY_STRUCTURE_EXAMPLES: StructureExamples = { section: '', part: '', topic: '' };
export const StructureExpectedOutputsSchema = z
  .object({
    section: z.string().trim().max(500).nullable(),
    part: z.string().trim().max(500).nullable(),
    topic: z.string().trim().max(500).nullable(),
  })
  .strict();
export type StructureExpectedOutputs = z.infer<typeof StructureExpectedOutputsSchema>;
export type StructureHeadingLevel = keyof StructureExamples;
export const STRUCTURE_HEADING_LEVELS: readonly StructureHeadingLevel[] = [
  'section',
  'part',
  'topic',
];

export const StructureRuleFieldsSchema = StructureRuleScopeSchema.extend({
  examples: StructureExamplesSchema,
  // Existing profiles omit this field and continue to use the general label rules.
  expectedOutputs: StructureExpectedOutputsSchema.optional(),
  notes: z.string().trim().max(2000),
}).strict();
export const SaveStructureRuleSchema = StructureRuleFieldsSchema.superRefine((value, ctx) => {
  if (!Object.values(value.examples).some((example) => example.length > 0) && !value.notes.length)
    ctx.addIssue({
      code: 'custom',
      message: 'Enter at least one heading example or recognition rule.',
    });
  for (const level of STRUCTURE_HEADING_LEVELS) {
    const output = value.expectedOutputs?.[level];
    if (output === undefined || output === null) continue;
    if (output && !value.examples[level])
      ctx.addIssue({
        code: 'custom',
        path: ['examples', level],
        message: `Enter a printed ${level} heading example for this expected output.`,
      });
    if (level !== 'topic' && value.examples[level] && !output)
      ctx.addIssue({
        code: 'custom',
        path: ['expectedOutputs', level],
        message: `Enter the expected ${level} output.`,
      });
    if (level === 'topic' && !isPrintedTopicLabel(value.examples.topic, output))
      ctx.addIssue({
        code: 'custom',
        path: ['expectedOutputs', level],
        message: 'Expected Topic output must use a name printed in the example, or stay blank.',
      });
  }
});
export type SaveStructureRule = z.infer<typeof SaveStructureRuleSchema>;
export const StructureRuleSchema = StructureRuleFieldsSchema.extend({
  updatedAt: z.string().datetime(),
}).strict();
export type StructureRule = z.infer<typeof StructureRuleSchema>;
export const StructureRuleListSchema = z.array(StructureRuleSchema);
export const ResolvedStructureRuleSchema = StructureRuleSchema.nullable();

/** Null means the general rule; an explicit empty Topic output deliberately leaves its name blank. */
export function hasExpectedStructureOutput(
  rule: StructureRule | null | undefined,
  level: StructureHeadingLevel,
): boolean {
  return Boolean(rule?.examples[level].trim()) && rule?.expectedOutputs?.[level] != null;
}

export function structureExampleOutput(rule: StructureRule, level: StructureHeadingLevel): string {
  return rule.expectedOutputs?.[level] ?? structureLabelFromHeading(level, rule.examples[level]);
}

/** Names match the ingestion form; no provider's examples fall back to a different provider. */
export function structureRuleScope(context: StructureDetectionContext): StructureRuleScope | null {
  const source = StructureRuleSourceSchema.safeParse(context.source.trim().toLowerCase());
  if (!source.success) return null;
  const provider =
    source.data === 'pyq'
      ? context.paper.pyqExamName.trim() || context.exam.trim()
      : context.module.trim();
  const scope = StructureRuleScopeSchema.safeParse({ source: source.data, provider });
  return scope.success ? scope.data : null;
}

/** The same case/space-insensitive identity is used by persistence and UI queries. */
export function structureRuleScopeKey(scope: StructureRuleScope): string {
  return JSON.stringify([
    scope.source,
    scope.provider.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '),
  ]);
}
