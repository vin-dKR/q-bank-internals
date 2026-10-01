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
          section: PrintedHeadingSchema,
          part: PrintedHeadingSchema,
          topic: PrintedHeadingSchema,
          // Optional for previously saved observations; new AI responses always include this field.
          questionType: StructureQuestionTypeObservationSchema.nullable().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type StructurePageObservation = z.infer<typeof StructurePageObservationSchema>;
type HeadingValue = z.infer<typeof PrintedHeadingSchema>;
type Headings = Record<StructureHeadingLevel, string | null>;
type DetectedQuestionType = (typeof KNOWN_QUESTION_TYPES)[number] | '';
type QuestionTypes = Record<StructureHeadingLevel, DetectedQuestionType>;

function printedHeading(value: HeadingValue): string | null {
  return typeof value === 'object' && value !== null ? value.printed : value;
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

/** Collect printed headings only. Every attachment remains empty for the operator. */
export class StructurePageAccumulator {
  private readonly nodes: DetectedStructureNode[] = [];
  private readonly warnings: string[] = [];
  private readonly headingKeys = new WeakMap<DetectedStructureNode, string>();
  private readonly scopeQuestionTypes = new WeakMap<DetectedStructureNode, DetectedQuestionType>();
  private previous: Headings = { section: null, part: null, topic: null };
  private labels: Headings = { section: null, part: null, topic: null };
  private questionTypes: QuestionTypes = { section: '', part: '', topic: '' };

  constructor(
    private readonly context: StructureDetectionContext,
    private readonly rule: StructureRule | null = null,
  ) {}

  pageContext(): { previous: Headings; questionTypes: QuestionTypes } {
    return { previous: { ...this.previous }, questionTypes: { ...this.questionTypes } };
  }

  warning(message: string): void {
    this.warnings.push(message);
  }

  failedPage(page: number, reason: string): void {
    this.warnings.push(`Page ${String(page)}: ${reason}`);
    this.previous = { section: null, part: null, topic: null };
    this.labels = { section: null, part: null, topic: null };
    this.questionTypes = { section: '', part: '', topic: '' };
  }

  accept(
    page: number,
    raw: unknown,
    candidates: StructureHeadingCandidates,
    typeEvidence: readonly StructureQuestionTypeEvidence[] = [],
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
    if (
      parsed.data.items.some((item) =>
        STRUCTURE_HEADING_LEVELS.some(
          (level) =>
            hasExpectedStructureOutput(this.rule, level) &&
            (typeof item[level] === 'string' ||
              (level !== 'topic' &&
                item[level] !== null &&
                typeof item[level] === 'object' &&
                !item[level].label)),
        ),
      )
    ) {
      this.failedPage(
        page,
        'the model omitted a configured output label. Review this page manually.',
      );
      return accepted;
    }
    for (const item of parsed.data.items) {
      let unsupportedParent = false;
      for (const level of STRUCTURE_HEADING_LEVELS) {
        const printed = printedHeading(item[level]);
        if (printed === null) continue;
        const source = candidates[level].find(
          (candidate) => printedHeadingKey(candidate) === printedHeadingKey(printed),
        );
        if (source === undefined) {
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
        this.previous = { section: null, part: null, topic: null };
        this.labels = { section: null, part: null, topic: null };
        this.questionTypes = { section: '', part: '', topic: '' };
        continue;
      }
      const headings = {
        section: printedHeading(item.section),
        part: printedHeading(item.part),
        topic: printedHeading(item.topic),
      };
      let detectedType = item.questionType ?? null;
      if (detectedType) {
        const observedType = detectedType;
        const evidence = typeEvidence.find(
          (value) =>
            value.value === observedType.value &&
            printedHeadingKey(value.printed) === printedHeadingKey(observedType.printed),
        );
        const typeHeadingCandidates = structureHeadingCandidates([observedType.printed], this.rule);
        const explicitLevel = STRUCTURE_HEADING_LEVELS.find(
          (level) => typeHeadingCandidates[level].length > 0,
        );
        const printedLevel =
          explicitLevel ??
          STRUCTURE_HEADING_LEVELS.find(
            (level) =>
              headings[level] !== null &&
              printedHeadingKey(headings[level]) === printedHeadingKey(observedType.printed),
          );
        if (
          !evidence ||
          (printedLevel && printedLevel !== detectedType.level) ||
          (explicitLevel &&
            (headings[explicitLevel] === null ||
              printedHeadingKey(headings[explicitLevel]) !==
                printedHeadingKey(observedType.printed)))
        ) {
          this.warning(
            `Page ${String(page)}: rejected question type "${detectedType.value}" because its category or scope was not supported by this crop's text.`,
          );
          detectedType = null;
        }
      }
      if (!headings.section && !headings.part && !headings.topic && !detectedType) continue;
      const clean = (level: StructureHeadingLevel): StructureCropHeading['section'] => {
        const printed = printedHeading(item[level]);
        if (printed === null || (level === 'topic' && !topicHeading(printed))) return null;
        const label = this.outputLabel(level, item[level], page) ?? '';
        return { printed, label };
      };
      const cleaned = {
        section: clean('section'),
        part: clean('part'),
        topic: clean('topic'),
        questionType: detectedType,
      };
      accepted.push(cleaned);
      if (
        headings.section &&
        headingKey(headings.section) !== headingKey(this.previous.section ?? '')
      ) {
        this.previous = { section: headings.section, part: null, topic: null };
        this.labels = {
          section: cleaned.section?.label ?? null,
          part: null,
          topic: null,
        };
        this.questionTypes = { section: '', part: '', topic: '' };
      }
      if (headings.part && headingKey(headings.part) !== headingKey(this.previous.part ?? '')) {
        this.previous.part = headings.part;
        this.previous.topic = null;
        this.labels.part = cleaned.part?.label ?? null;
        this.labels.topic = null;
        this.questionTypes.part = '';
        this.questionTypes.topic = '';
      }
      if (headings.topic) {
        const topic = topicHeading(headings.topic);
        if (topic) {
          if (headingKey(topic) !== headingKey(this.previous.topic ?? ''))
            this.questionTypes.topic = '';
          this.previous.topic = topic;
          this.labels.topic = cleaned.topic?.label ?? null;
        } else {
          this.previous.topic = null;
          this.labels.topic = null;
          this.questionTypes.topic = '';
        }
      }
      let siblings = this.nodes;
      const hierarchy = [
        { label: this.previous.section, level: 'section' as const },
        { label: this.previous.part, level: 'part' as const },
        { label: this.previous.topic, level: 'topic' as const },
      ];
      const scopeNodes = new Map<StructureHeadingLevel, DetectedStructureNode>();
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
        this.questionTypes[level] = this.scopeQuestionTypes.get(node) ?? '';
        siblings = node.children;
      }
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
    value: HeadingValue,
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
          : printedHeadingKey(original) === printedHeadingKey(label);
      if (!valid) {
        this.warning(
          `Page ${String(page)}: rejected a cleaned ${level} label that changed its printed identifier or wording; kept the source label.`,
        );
        return original;
      }
      return label;
    }
    const expected = this.rule?.expectedOutputs?.[level];
    const matchesExample =
      printedHeadingKey(printed) === printedHeadingKey(this.rule?.examples[level] ?? '');
    const label = matchesExample && expected != null ? expected : value.label;
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

  result(): { nodes: DetectedStructureNode[]; warnings: string[] } {
    const copy = (
      node: DetectedStructureNode,
      inheritedType: DetectedQuestionType = '',
    ): DetectedStructureNode => {
      const questionType = this.scopeQuestionTypes.get(node) || inheritedType;
      return {
        ...node,
        questionType: node.level === 'topic' ? questionType : '',
        pages: { ...node.pages },
        // Parent types are applied to Topic leaves, including unnamed Topics.
        children:
          node.children.length === 0 && node.level !== 'topic'
            ? [{ ...this.newNode('topic', ''), questionType }]
            : node.children.map((child) => copy(child, questionType)),
      };
    };
    return { nodes: this.nodes.map((node) => copy(node)), warnings: [...this.warnings] };
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
