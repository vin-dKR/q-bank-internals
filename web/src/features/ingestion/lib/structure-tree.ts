import type { ChapterKind } from '@ingest/contracts';
import type {
  LeafBindings,
  MaterializedArtifact,
  NodeLevel,
  StructureNode,
} from '../types/structure-node.js';
import { isLeaf } from '../types/structure-node.js';
import { makeId } from './make-id.js';

/** A fresh empty node at the given level, ready to be named. */
export function newNode(level: NodeLevel | null, label = ''): StructureNode {
  return { id: makeId(), label, level, children: [] };
}

/** Immutably map every node in a forest, replacing any node the transform returns a new value for. */
function mapForest(
  nodes: StructureNode[],
  transform: (node: StructureNode) => StructureNode,
): StructureNode[] {
  return nodes.map((node) => {
    const mappedChildren = mapForest(node.children, transform);
    const withChildren = mappedChildren === node.children ? node : { ...node, children: mappedChildren };
    return transform(withChildren);
  });
}

/** Return a new forest with `updater` applied to the node whose id matches. */
export function updateNode(
  nodes: StructureNode[],
  id: string,
  updater: (node: StructureNode) => StructureNode,
): StructureNode[] {
  return mapForest(nodes, (node) => (node.id === id ? updater(node) : node));
}

/** Return a new forest with the matching node (and its subtree) removed. */
export function removeNode(nodes: StructureNode[], id: string): StructureNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.children.length > 0 ? { ...node, children: removeNode(node.children, id) } : node,
    );
}

/**
 * A deep clone of a node's *structure* only — level, label, question type, and children — with fresh
 * ids throughout and every binding dropped. Bindings are one-shot immutable page slices tied to the
 * document they were cut from, so a duplicated node starts empty and the operator re-binds its slices.
 */
function cloneStructure(node: StructureNode): StructureNode {
  return {
    id: makeId(),
    label: node.label,
    level: node.level,
    ...(node.questionType !== undefined ? { questionType: node.questionType } : {}),
    children: node.children.map(cloneStructure),
  };
}

/** Insert a structural clone of the matched node (fresh ids, no bindings) as its next sibling. */
export function duplicateNode(nodes: StructureNode[], id: string): StructureNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index !== -1) {
    const original = nodes[index];
    if (!original) return nodes;
    const next = [...nodes];
    next.splice(index + 1, 0, cloneStructure(original));
    return next;
  }
  return nodes.map((node) =>
    node.children.length > 0 ? { ...node, children: duplicateNode(node.children, id) } : node,
  );
}

/** Append a child under `parentId`; a node that gains a child stops being a leaf, so its bindings drop. */
export function addChild(
  nodes: StructureNode[],
  parentId: string,
  child: StructureNode,
): StructureNode[] {
  return updateNode(nodes, parentId, (node) => {
    // A node that gains a child stops being a leaf, so any bindings it held no longer apply.
    const withChild: StructureNode = { ...node, children: [...node.children, child] };
    if (withChild.bindings) delete withChild.bindings;
    return withChild;
  });
}

/** Locate a node and the chain of ancestors above it (root-first), or null if absent. */
export function findWithPath(
  nodes: StructureNode[],
  id: string,
  trail: StructureNode[] = [],
): { node: StructureNode; ancestors: StructureNode[] } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, ancestors: trail };
    const deeper = findWithPath(node.children, id, [...trail, node]);
    if (deeper) return deeper;
  }
  return null;
}

/** Every leaf in the forest, paired with its ancestor chain (root-first). */
export function leaves(
  nodes: StructureNode[],
  trail: StructureNode[] = [],
): { node: StructureNode; ancestors: StructureNode[] }[] {
  const out: { node: StructureNode; ancestors: StructureNode[] }[] = [];
  for (const node of nodes) {
    if (isLeaf(node)) out.push({ node, ancestors: trail });
    else out.push(...leaves(node.children, [...trail, node]));
  }
  return out;
}

/** The question type a leaf inherits: its own, else the nearest ancestor that sets one. */
export function resolveQuestionType(node: StructureNode, ancestors: StructureNode[]): string {
  const chain = [...ancestors, node];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const qt = chain[i]?.questionType?.trim();
    if (qt) return qt;
  }
  return '';
}

/** Bind (or replace) one part's materialized artifact on a leaf. */
export function bindArtifact(
  nodes: StructureNode[],
  leafId: string,
  kind: ChapterKind,
  artifact: MaterializedArtifact,
): StructureNode[] {
  return updateNode(nodes, leafId, (node) => ({
    ...node,
    bindings: { ...node.bindings, [kind]: artifact } satisfies LeafBindings,
  }));
}

/** Remove one part's binding from a leaf. */
export function unbindArtifact(
  nodes: StructureNode[],
  leafId: string,
  kind: ChapterKind,
): StructureNode[] {
  return updateNode(nodes, leafId, (node) => {
    if (!node.bindings) return node;
    const bindings: LeafBindings = { ...node.bindings };
    if (kind === 'question') delete bindings.question;
    else if (kind === 'answer') delete bindings.answer;
    else delete bindings.solution;
    return { ...node, bindings };
  });
}
