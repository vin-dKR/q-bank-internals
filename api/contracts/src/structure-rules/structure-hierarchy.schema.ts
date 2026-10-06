import { z } from 'zod';

/** Stable ids survive renaming/reordering; display names belong to each provider's rule. */
export const StructureLevelIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u)
  .refine(
    (id) =>
      ![
        'combined',
        'questionType',
        'answer',
        'solution',
        'companion',
        '__proto__',
        'constructor',
        'prototype',
      ].includes(id),
    'Choose a valid hierarchy level id.',
  );
export const StructureHierarchyLevelSchema = z
  .object({
    id: StructureLevelIdSchema,
    name: z.string().trim().min(1).max(60),
    example: z.string().trim().max(500),
    expectedOutput: z.string().trim().max(500).nullable(),
  })
  .strict();
export type StructureHierarchyLevel = z.infer<typeof StructureHierarchyLevelSchema>;
export const StructureHierarchySchema = z
  .array(StructureHierarchyLevelSchema)
  .min(1)
  .max(16)
  .superRefine((levels, ctx) => {
    if (new Set(levels.map((level) => level.id)).size !== levels.length)
      ctx.addIssue({ code: 'custom', message: 'Hierarchy level ids must be unique.' });
    if (new Set(levels.map((level) => level.name.toLowerCase())).size !== levels.length)
      ctx.addIssue({ code: 'custom', message: 'Give each hierarchy level a different name.' });
    levels.forEach((level, index) => {
      if (level.expectedOutput && !level.example)
        ctx.addIssue({
          code: 'custom',
          path: [index, 'example'],
          message: `Enter a printed ${level.name} example for this output.`,
        });
      if (level.id !== 'topic' && level.example && level.expectedOutput === '')
        ctx.addIssue({
          code: 'custom',
          path: [index, 'expectedOutput'],
          message: `Enter the expected ${level.name} output, or use automatic formatting.`,
        });
    });
  });
export const DEFAULT_STRUCTURE_HIERARCHY: readonly StructureHierarchyLevel[] = [
  { id: 'section', name: 'Section', example: '', expectedOutput: null },
  { id: 'part', name: 'Part', example: '', expectedOutput: null },
  { id: 'topic', name: 'Topic', example: '', expectedOutput: null },
];
