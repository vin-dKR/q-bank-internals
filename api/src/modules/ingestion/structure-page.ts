import { z } from 'zod';
import {
  structureKindsForLayout,
  structureLabelFromHeading,
  topicNameFromHeading,
  isPrintedTopicLabel,
  hasExpectedStructureOutput,
  headingWithoutOcrNoise,
  type KNOWN_QUESTION_TYPES,
  STRUCTURE_HEADING_LEVELS,
  type StructureHeadingLevel,
  type StructureRule,
  type DetectedStructureNode,
  type StructureDetectionContext,
  type StructureCropHeading,
  type StructureCropRole,
  StructureLevelIdSchema,
  structureHierarchy,
} from '@ingest/contracts';
import {
  isExamYearHeading,
  printedHeadingKey,
  structureHeadingCandidates,
  type StructureHeadingCandidates,
} from './structure-heading-evidence.js';
import {
  StructureQuestionTypeObservationSchema,
  type StructureQuestionTypeEvidence,
} from './structure-question-type.js';

const PrintedHeadingSchema = z
  .union([
    z.string().trim().min(1),
    z
      .object({ printed: z.string().trim().min(1).max(500), label: z.string().trim().max(500) })
      .strict(),
  ])
  .nullable();
export const StructurePageObservationSchema = z
  .object({
    items: z.array(
      z
        .object({
          section: PrintedHeadingSchema.optional(),
          part: PrintedHeadingSchema.optional(),
          topic: PrintedHeadingSchema.optional(),
          headings: z.record(StructureLevelIdSchema, PrintedHeadingSchema).optional(),
          // Optional for previously saved observations; new AI responses always include this field.
          questionType: StructureQuestionTypeObservationSchema.nullable().optional(),
        })
        .strict()
        .refine(
          (item) =>
            item.headings !== undefined ||
            [item.section, item.part, item.topic].every((value) => value !== undefined),
          'Return headings or the three legacy heading fields.',
        ),
    ),
  })
  .strict();
export type StructurePageObservation = z.infer<typeof StructurePageObservationSchema>;
type HeadingValue = z.infer<typeof PrintedHeadingSchema>;
type Headings = Record<StructureHeadingLevel, string | null>;
type DetectedQuestionType = (typeof KNOWN_QUESTION_TYPES)[number] | '';
type QuestionTypes = Record<StructureHeadingLevel, DetectedQuestionType>;

function printedHeading(value: HeadingValue | undefined): string | null {
  return typeof value === 'object' && value !== null ? value.printed : (value ?? null);
}

function headingKey(value: string): string {
  const cleaned = headingWithoutOcrNoise(value)
    .toLowerCase()
    .replace(/^(exercise|part)\s*[-:]?\s*/i, '')
    .trim();
  const number = cleaned.match(/^(\d+|[ivx]+)(?=\s|:|$)/)?.[1];
  const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
  const index = roman.indexOf(number ?? cleaned);
  return index < 0 ? printedHeadingKey(number ?? cleaned) : String(index + 1);
}

function topicHeading(value: string): string | null {
  const normalized = value.normalize('NFKC').trim();
  // Printed answer/question entries can look like headings to vision; never turn their IDs into topics.
  if (
    isExamYearHeading(normalized) ||
    /^(?:\(?[a-z]\d*\)?[-.\s]*)?\d+\s*(?:[-.):]|\s)|^\([a-z]\)\s/iu.test(normalized) ||
    /^(?:answers?|solutions?|questions?|answer\s+key|worked\s+solutions?)\s*[:.\-–—]?$/i.test(
      normalized,
    )
  )
    return null;
  return value;
}

/** Collect verified headings; optional question-page ownership is derived from their PDF positions. */
export class StructurePageAccumulator {
  private readonly nodes: DetectedStructureNode[] = [];
  private readonly warnings: string[] = [];
  private readonly headingKeys = new WeakMap<DetectedStructureNode, string>();
  private readonly scopeQuestionTypes = new WeakMap<DetectedStructureNode, DetectedQuestionType>();
  private previous: Headings = { section: null, part: null, topic: null };
  private labels: Headings = { section: null, part: null, topic: null };
  private questionTypes: QuestionTypes = { section: '', part: '', topic: '' };
  private readonly levels: string[];
  private readonly pageTargets = new Map<number, DetectedStructureNode | null>();
  private readonly failedQuestionPages = new Set<number>();

  constructor(
    private readonly context: StructureDetectionContext,
    private readonly rule: StructureRule | null = null,
  ) {
    this.levels = structureHierarchy(rule).map((level) => level.id);
    this.clearContext();
  }

  private clearContext(page?: number): void {
    this.previous = Object.fromEntries(this.levels.map((level) => [level, null]));
    this.labels = { ...this.previous };
    this.questionTypes = Object.fromEntries(this.levels.map((level) => [level, '']));
    if (page !== undefined) {
      this.pageTargets.set(page, null);
      this.failedQuestionPages.add(page);
    }
  }

  pageContext(): { previous: Headings; questionTypes: QuestionTypes } {
    return { previous: { ...this.previous }, questionTypes: { ...this.questionTypes } };
  }

  warning(message: string): void {
    this.warnings.push(message);
  }

  failedPage(page: number, reason: string): void {
    this.warnings.push(`Page ${String(page)}: ${reason}`);
    this.clearContext(page);
  }

  accept(
    page: number,
    raw: unknown,
    candidates: StructureHeadingCandidates,
    typeEvidence: readonly StructureQuestionTypeEvidence[] = [],
    role: StructureCropRole = 'combined',
  ): StructureCropHeading[] {
    const accepted: StructureCropHeading[] = [];
    const parsed = StructurePageObservationSchema.safeParse(raw);
    if (!parsed.success) {
      this.failedPage(
        page,
        'the model returned invalid heading values. Review this page manually.',
      );
      return accepted;
    }
    if (role !== 'combined' && !this.levels.includes(role)) {
      this.failedPage(
        page,
        'this crop uses a removed or unknown hierarchy level. Choose its heading type again.',
      );
      return accepted;
    }
    const items = parsed.data.items.map((item) => ({
      headings: item.headings ?? {
        section: item.section ?? null,
        part: item.part ?? null,
        topic: item.topic ?? null,
      },
      questionType: item.questionType,
    }));
    if (
      items.some((item) =>
        Object.entries(item.headings).some(
          ([level, value]) => value !== null && !this.levels.includes(level),
        ),
      )
    ) {
      this.failedPage(
        page,
        'the model returned a level outside the saved hierarchy. Review this crop.',
      );
      return accepted;
    }
    if (
      items.some((item) =>
        this.levels.some(
          (level) =>
            hasExpectedStructureOutput(this.rule, level) &&
            (typeof item.headings[level] === 'string' ||
              (level !== 'topic' &&
                item.headings[level] != null &&
                typeof item.headings[level] === 'object' &&
                !item.headings[level].label)),
        ),
      )
    ) {
      this.failedPage(
        page,
        'the model omitted a configured output label. Review this page manually.',
      );
      return accepted;
    }
    for (const observation of items) {
      const item = observation.headings;
      if (role !== 'combined') {
        for (const level of this.levels)
          if (level !== role && item[level] != null) {
            this.warning(
              `Page ${String(page)}: ignored ${level} heading in an operator-selected ${role} crop.`,
            );
            item[level] = null;
          }
      }
      let unsupportedParent = false;
      for (const level of this.levels) {
        const printed = printedHeading(item[level]);
        if (printed === null) continue;
        const source = candidates[level]?.find(
          (candidate) => printedHeadingKey(candidate) === printedHeadingKey(printed),
        );
        if (source === undefined) {
          this.pageTargets.set(page, null);
          this.failedQuestionPages.add(page);
          this.warning(
            `Page ${String(page)}: rejected ${level} heading "${printed}" because it was not a verified heading on this page.`,
          );
          item[level] = null;
          this.previous[level] = null;
          this.labels[level] = null;
          this.questionTypes[level] = '';
          if (level !== 'topic') unsupportedParent = true;
        } else {
          // Preserve the PDF's wording, even if the model changes spaces or letter case.
          const value = item[level];
          item[level] =
            typeof value === 'object' && value !== null ? { ...value, printed: source } : source;
        }
      }
      if (unsupportedParent) {
        this.clearContext(page);
        continue;
      }
      const headings: Headings = Object.fromEntries(
        this.levels.map((level) => [level, printedHeading(item[level])]),
      );
      let detectedType = observation.questionType ?? null;
      if (detectedType) {
        const observedType = detectedType;
        const evidence = typeEvidence.find(
          (value) =>
            value.value === observedType.value &&
            printedHeadingKey(value.printed) === printedHeadingKey(observedType.printed),
        );
        const typeHeadingCandidates = structureHeadingCandidates([observedType.printed], this.rule);
        const explicitLevel =
          role === 'combined'
            ? this.levels.find((level) => (typeHeadingCandidates[level]?.length ?? 0) > 0)
            : this.levels.some((level) => (typeHeadingCandidates[level]?.length ?? 0) > 0)
              ? role
              : undefined;
        const printedLevel =
          explicitLevel ??
          this.levels.find(
            (level) =>
              headings[level] != null &&
              printedHeadingKey(headings[level]) === printedHeadingKey(observedType.printed),
          );
        if (
          !evidence ||
          (role !== 'combined' && detectedType.level !== role) ||
          (printedLevel && printedLevel !== detectedType.level) ||
          (explicitLevel &&
            (headings[explicitLevel] == null ||
              printedHeadingKey(headings[explicitLevel]) !==
                printedHeadingKey(observedType.printed)))
        ) {
          this.warning(
            `Page ${String(page)}: rejected question type "${detectedType.value}" because its category or scope was not supported by this crop's text.`,
          );
          detectedType = null;
        }
      }
      if (!Object.values(headings).some(Boolean) && !detectedType) continue;
      const clean = (level: StructureHeadingLevel): StructureCropHeading['section'] => {
        const printed = printedHeading(item[level]);
        if (printed === null || (level === 'topic' && !topicHeading(printed))) return null;
        const label = this.outputLabel(level, item[level], page) ?? '';
        return { printed, label };
      };
      const cleanedHeadings = Object.fromEntries(this.levels.map((level) => [level, clean(level)]));
      if (
        this.rule?.hierarchy &&
        this.levels.some((level) => level !== 'topic' && cleanedHeadings[level]?.label === '')
      ) {
        this.failedPage(
          page,
          'a parent label was unsupported. Its descendants were not attached to the preceding hierarchy.',
        );
        continue;
      }
      const cleaned: StructureCropHeading = {
        section: cleanedHeadings.section ?? null,
        part: cleanedHeadings.part ?? null,
        topic: cleanedHeadings.topic ?? null,
        ...(this.rule?.hierarchy ? { headings: cleanedHeadings } : {}),
        questionType: detectedType,
      };
      accepted.push(cleaned);
      for (const [index, level] of this.levels.entries()) {
        const printed = headings[level];
        if (!printed) continue;
        const heading = level === 'topic' ? topicHeading(printed) : printed;
        if (!heading || headingKey(heading) !== headingKey(this.previous[level] ?? '')) {
          this.previous[level] = heading;
          this.labels[level] = heading ? (cleanedHeadings[level]?.label ?? null) : null;
          this.questionTypes[level] = '';
          for (const childLevel of this.levels.slice(index + 1)) {
            this.previous[childLevel] = null;
            this.labels[childLevel] = null;
            this.questionTypes[childLevel] = '';
          }
        }
      }
      let siblings = this.nodes;
      const hierarchy = this.levels.map((level) => ({ label: this.previous[level], level }));
      const scopeNodes = new Map<StructureHeadingLevel, DetectedStructureNode>();
      let deepestNode: DetectedStructureNode | null = null;
      for (const { label, level } of hierarchy) {
        if (!label) continue;
        const name = this.labels[level] ?? structureLabelFromHeading(level, label);
        if (!name && level !== 'topic') continue;
        const key = headingKey(label);
        let node = siblings.find(
          (value) => value.level === level && this.headingKeys.get(value) === key,
        );
        if (!node) {
          node = this.newNode(level, name);
          this.headingKeys.set(node, key);
          siblings.push(node);
        }
        scopeNodes.set(level, node);
        deepestNode = node;
        this.questionTypes[level] = this.scopeQuestionTypes.get(node) ?? '';
        siblings = node.children;
      }
      // Later crops on the same page refine a Section/Part target to that page's final child.
      this.pageTargets.set(page, deepestNode);
      if (detectedType) {
        const node = scopeNodes.get(detectedType.level);
        const existing = node ? this.scopeQuestionTypes.get(node) : undefined;
        if (!node)
          this.warning(
            `Page ${String(page)}: a question type had no ${detectedType.level} heading to attach to; it was left blank.`,
          );
        else if (existing && existing !== detectedType.value)
          this.warning(
            `Page ${String(page)}: conflicting question types for "${node.label}"; kept "${existing}" for manual review.`,
          );
        else {
          this.scopeQuestionTypes.set(node, detectedType.value);
          this.questionTypes[detectedType.level] = detectedType.value;
        }
      }
    }
    return accepted;
  }

  private outputLabel(
    level: StructureHeadingLevel,
    value: HeadingValue | undefined,
    page: number,
  ): string | null {
    const printed = printedHeading(value);
    if (printed === null) return null;
    if (typeof value !== 'object' || value === null)
      return structureLabelFromHeading(level, printed);
    const customOutput = hasExpectedStructureOutput(this.rule, level);
    const cleanPrinted = headingWithoutOcrNoise(printed);
    if (!customOutput) {
      const original = structureLabelFromHeading(level, cleanPrinted);
      const label = structureLabelFromHeading(level, value.label);
      const valid =
        level === 'part'
          ? Boolean(label) && headingKey(original) === headingKey(label)
          : !STRUCTURE_HEADING_LEVELS.some((id) => id === level)
            ? Boolean(label) && isPrintedTopicLabel(cleanPrinted, label)
            : printedHeadingKey(original) === printedHeadingKey(label);
      if (!valid) {
        this.warning(
          `Page ${String(page)}: rejected a cleaned ${level} label that changed its printed identifier or wording; kept the source label.`,
        );
        return original;
      }
      return label;
    }
    const entry = structureHierarchy(this.rule).find((item) => item.id === level);
    const expected = entry?.expectedOutput;
    const matchesExample = printedHeadingKey(printed) === printedHeadingKey(entry?.example ?? '');
    const label = matchesExample && expected != null ? expected : value.label;
    const identifier = /\b(?:\d+|[ivxlcdm]+|[a-z])\b/iu;
    const exampleIdentifier = entry?.example.match(identifier)?.[0];
    if (
      level !== 'topic' &&
      expected &&
      /^(?:\d+|[ivxlcdm]+|[a-z])$/iu.test(expected) &&
      exampleIdentifier &&
      headingKey(exampleIdentifier) === headingKey(expected)
    ) {
      const printedIdentifier = cleanPrinted.match(identifier)?.[0];
      if (!printedIdentifier || headingKey(printedIdentifier) !== headingKey(label)) {
        this.warning(
          `Page ${String(page)}: a ${level} output changed its printed identifier; it was omitted.`,
        );
        return '';
      }
    }
    const numericPart =
      level === 'part' &&
      /^\d+$/u.test(label) &&
      headingKey(cleanPrinted.match(/\b(?:\d+|[ivx]+)\b/iu)?.[0] ?? '') === label;
    if (level === 'topic') {
      if (expected === '') return '';
      if (!topicNameFromHeading(printed)) return '';
      if (!isPrintedTopicLabel(printed, label)) {
        this.warning(
          `Page ${String(page)}: a Topic output was not present in its printed heading; its name was left blank.`,
        );
        return '';
      }
    } else if (!matchesExample && !isPrintedTopicLabel(printed, label) && !numericPart) {
      this.warning(
        `Page ${String(page)}: a ${level} output was not supported by its printed heading; it was omitted.`,
      );
      return '';
    }
    return label;
  }

  private questionPageAssignments(pageCount: number): {
    pages: WeakMap<DetectedStructureNode, number[]>;
    warnings: string[];
  } {
    const pages = new WeakMap<DetectedStructureNode, number[]>();
    const unassigned: number[] = [];
    let current: DetectedStructureNode | null = null;
    for (let page = 1; page <= pageCount; page += 1) {
      if (this.failedQuestionPages.has(page)) current = null;
      else if (this.pageTargets.has(page)) current = this.pageTargets.get(page) ?? null;
      if (!current || current.children.length > 0) {
        unassigned.push(page);
        continue;
      }
      const assigned = pages.get(current) ?? [];
      assigned.push(page);
      pages.set(current, assigned);
    }
    return {
      pages,
      warnings: unassigned.length
        ? [
            `Question pages left unassigned: ${unassigned.slice(0, 20).join(', ')}${unassigned.length > 20 ? `… (${String(unassigned.length)} pages)` : ''}. Review missing or rejected headings; pages attach only to final children.`,
          ]
        : [],
    };
  }

  result(questionPageCount?: number): { nodes: DetectedStructureNode[]; warnings: string[] } {
    const assignment =
      questionPageCount === undefined ? null : this.questionPageAssignments(questionPageCount);
    const copy = (
      node: DetectedStructureNode,
      inheritedType: DetectedQuestionType = '',
    ): DetectedStructureNode => {
      const questionType = this.scopeQuestionTypes.get(node) || inheritedType;
      return {
        ...node,
        questionType: node.children.length === 0 ? questionType : '',
        pages: {
          ...node.pages,
          ...(assignment && node.children.length === 0
            ? { question: assignment.pages.get(node) ?? [] }
            : {}),
        },
        // Apply scoped types to the last printed node; absent Topics need no placeholder.
        children: node.children.map((child) => copy(child, questionType)),
      };
    };
    return {
      nodes: this.nodes.map((node) => copy(node)),
      warnings: [...this.warnings, ...(assignment?.warnings ?? [])],
    };
  }

  private newNode(level: DetectedStructureNode['level'], label: string): DetectedStructureNode {
    const pages: DetectedStructureNode['pages'] = {};
    for (const kind of structureKindsForLayout(this.context.answerLayout)) {
      if (kind === 'solution') pages.solution = null;
      else pages[kind] = [];
    }
    return { label, level, questionType: '', subject: '', pyq: false, pages, children: [] };
  }
}
