import {
  DetectedStructureSchema,
  structureKindsForLayout,
  structureLabelFromHeading,
  hasExpectedStructureOutput,
  type StructureRule,
  type AnswerLayout,
  type DetectedStructureNode,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';

/** Detection supplies headings and supported types; page bindings are exclusively operator-owned. */
export function validateStructure(
  raw: unknown,
  _pageCount: number,
  layout: AnswerLayout,
  rule: StructureRule | null = null,
): {
  nodes: DetectedStructureNode[];
  warnings: string[];
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
  const rank = { section: 0, part: 1, topic: 2 };
  let count = 0;
  const visit = (node: DetectedStructureNode, parentRank: number): void => {
    count += 1;
    if (count > 500) throw errors.structureDetectionFailed('Too many headings. Use a smaller PDF.');
    const nodeRank = node.level === null ? -1 : rank[node.level];
    if (nodeRank <= parentRank || (!node.label.trim() && node.level !== 'topic'))
      throw errors.structureDetectionFailed('Invalid Section/Part/Topic hierarchy.');
    if (node.level === null || !hasExpectedStructureOutput(rule, node.level))
      node.label = structureLabelFromHeading(node.level, node.label);
    if (
      Object.values(node.pages).some(
        (pages) => pages !== null && pages !== undefined && pages.length > 0,
      )
    )
      throw errors.structureDetectionFailed(
        'AI page assignments are disabled. Bind pages manually.',
      );
    node.pages = {};
    for (const kind of structureKindsForLayout(layout)) {
      if (kind === 'solution') node.pages.solution = null;
      else node.pages[kind] = [];
    }
    for (const child of node.children) visit(child, nodeRank);
  };
  for (const node of nodes) visit(node, -1);
  return { nodes, warnings: parsed.data.warnings ?? [] };
}
