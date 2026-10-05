import type { TaxonomyDimension } from '@ingest/contracts';

/** Display + behaviour metadata for one managed dimension — the UI's single source for tab labels,
 * whether operators may freely create/delete entries (OPEN vocab) vs only edit seeded ones (CLOSED),
 * whether a canonical seed set exists, and the parent scope a chapter/section/topic is filtered/created under. */
export type DimensionMeta = {
  label: string;
  singular: string;
  /** One-line orientation shown under the tab — what this dictionary is for. */
  description: string;
  /** OPEN vocabulary: operators add and delete entries. CLOSED (questionType/level): seed + edit only. */
  creatable: boolean;
  /** A curated canonical starting set can be seeded for this dimension. */
  seedable: boolean;
  /** Parent dimension a row is scoped to (chapters → subject, sections → module, topics → chapter). */
  scope?: TaxonomyDimension;
  /** The closed-vocab field shown as a badge on each row. */
  extra?: 'kind' | 'rank';
};

export const DIMENSION_META: Record<TaxonomyDimension, DimensionMeta> = {
  exam: {
    label: 'Exams',
    singular: 'exam',
    description: 'The exam families every question is tagged with — the bank’s top-level filter.',
    creatable: true,
    seedable: false,
  },
  subject: {
    label: 'Subjects',
    singular: 'subject',
    description: 'The subjects questions are filed under, above chapters.',
    creatable: true,
    seedable: true,
  },
  module: {
    label: 'Modules',
    singular: 'module',
    description:
      'The content providers or institutes questions come from, such as Allen, PW, or Resonance.',
    creatable: true,
    seedable: false,
  },
  chapter: {
    label: 'Chapters',
    singular: 'chapter',
    description:
      'Chapters, scoped to a subject. Pick a subject to narrow the list or add under it.',
    creatable: true,
    seedable: false,
    scope: 'subject',
  },
  section: {
    label: 'Sections',
    singular: 'section',
    description:
      'The exercise / section bands published by a module (e.g. Allen Exercise-1 or PW DPP).',
    creatable: true,
    seedable: false,
    scope: 'module',
  },
  questionType: {
    label: 'Question types',
    singular: 'question type',
    description:
      'The canonical question kinds the AI classifies into. Closed set — edit names & spellings.',
    creatable: false,
    seedable: true,
    extra: 'kind',
  },
  level: {
    label: 'Difficulty',
    singular: 'level',
    description: 'The difficulty tiers the AI assigns. Closed set — easy, medium, hard.',
    creatable: false,
    seedable: true,
    extra: 'rank',
  },
  topic: {
    label: 'Topics',
    singular: 'topic',
    description: 'Fine-grained topics, scoped to a chapter.',
    creatable: true,
    seedable: false,
    scope: 'chapter',
  },
};

/** Tab order for the dimension switcher. */
export const DIMENSION_ORDER: readonly TaxonomyDimension[] = [
  'module',
  'exam',
  'subject',
  'chapter',
  'section',
  'questionType',
  'level',
  'topic',
];
