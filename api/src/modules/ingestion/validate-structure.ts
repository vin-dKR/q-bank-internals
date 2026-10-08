import {
  DetectedStructureSchema,
  structureKindsForLayout,
  structureLabelFromHeading,
  hasExpectedStructureOutput,
  type StructureRule,
  type AnswerLayout,
  type DetectedStructureNode,
  structureHierarchy,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';

/** Validate code-owned question pages; supporting pages and all model-generated bindings stay forbidden. */
export function validateStructure(
  raw: unknown,
  pageCount: number,
  layout: AnswerLayout,
  rule: StructureRule | null = null,
  options: { allowQuestionPages?: boolean } = {},
): {
  nodes: DetectedStructureNode[];
  warnings: string[];
  complete?: boolean;
} {
  const parsed = DetectedStructureSchema.safeParse(raw);
  if (!parsed.success)
    throw errors.structureDetectionFailed(
      'The AI returned invalid headings. Review or add nodes manually.',
    );
  const { nodes } = parsed.data;
  if (nodes.length === 0)
    throw errors.structureDetectionFailed(
      parsed.data.warnings?.join(' ') ||
        'No printed structure headings were found. Add the structure manually.',
    );
  const hierarchy = structureHierarchy(rule);
  let count = 0;
  const usedQuestionPages = new Set<number>();
  const visit = (node: DetectedStructureNode, parentRank: number): void => {
    count += 1;
    if (count > 500) throw errors.structureDetectionFailed('Too many headings. Use a smaller PDF.');
    const nodeRank = hierarchy.findIndex((level) => level.id === node.level);
    if (nodeRank <= parentRank || (!node.label.trim() && node.level !== 'topic'))
      throw errors.structureDetectionFailed('Invalid Section/Part/Topic or configured hierarchy.');
    if (node.level === null || !hasExpectedStructureOutput(rule, node.level))
      node.label = structureLabelFromHeading(node.level, node.label);
    if (
      Object.entries(node.pages).some(
        ([kind, pages]) =>
          pages !== null &&
          pages !== undefined &&
          pages.length > 0 &&
          (!options.allowQuestionPages || kind !== 'question'),
      )
    )
      throw errors.structureDetectionFailed(
        'AI page assignments are disabled. Bind pages manually.',
      );
    const questionPages = options.allowQuestionPages ? (node.pages.question ?? []) : [];
    if (questionPages.length > 0 && node.children.length > 0)
      throw errors.structureDetectionFailed('Question pages must attach only to a final child.');
    for (const page of questionPages) {
      if (page > pageCount || usedQuestionPages.has(page))
        throw errors.structureDetectionFailed(
          'Question pages must be unique assignments within the current PDF.',
        );
      usedQuestionPages.add(page);
    }
    node.pages = {};
    for (const kind of structureKindsForLayout(layout)) {
      if (kind === 'solution') node.pages.solution = null;
      else node.pages[kind] = [];
    }
    node.pages.question = [...questionPages];
    for (const child of node.children) visit(child, nodeRank);
  };
  for (const node of nodes) visit(node, -1);
  return {
    nodes,
    warnings: parsed.data.warnings ?? [],
    ...(parsed.data.complete === undefined ? {} : { complete: parsed.data.complete }),
  };
}
