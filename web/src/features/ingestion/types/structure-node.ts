import type { ChapterKind } from '@ingest/contracts';
import type { ChapterMetadataDraft } from './chapter-group.js';

/**
 * The optional structural levels between a chapter and its leaves, matching the source material:
 * `Chapter → Exercise → Part (question type) → Section (topic) → questions`. Every level is
 * optional — a deep Resonance PDF uses all of them, a flat NEET DPP uses none (one leaf directly
 * under the chapter). This replaces the old inverted `Chapter → Topic → questionType` model.
 */
export type NodeLevel = 'exercise' | 'part' | 'section';

/** Display order + label for each level, used by the tree UI when offering "add a child". */
export const NODE_LEVELS: readonly NodeLevel[] = ['exercise', 'part', 'section'];

/**
 * An immutable snapshot of a finalized slice, detached from the working document. Created the moment
 * the operator drops a slice onto a leaf (drag = materialize) so later edits to the working PDF can
 * never invalidate it. This detachment is what decouples the chapter config from the mutable PDF —
 * there are no positional page/slice references left to go stale.
 */
export type MaterializedArtifact = {
  id: string;
  /** Standalone PDF bytes for just this slice. Immutable once created. */
  bytes: Uint8Array;
  pageCount: number;
  /** Human-facing provenance for display only, e.g. "pages 3–5". */
  sourceLabel: string;
};

/**
 * The parts bound to a leaf. Only `question` is required to extract; `answer` and `solution` are
 * bound context the extractor reads alongside it. The operator asserts this association explicitly
 * (drops each part onto the same leaf), replacing the old match-by-section-and-number heuristic.
 */
export type LeafBindings = Partial<Record<ChapterKind, MaterializedArtifact>>;

/**
 * One node of the durable structure tree. The tree is the source of truth; PDF slices attach to its
 * leaves as materialized artifacts. A node is a *leaf* when it has no children — only leaves carry
 * bindings. `questionType` is meaningful at a `part` node and inherited by its descendant leaves.
 */
export type StructureNode = {
  id: string;
  label: string;
  level: NodeLevel | null;
  /** Set at a `part` node (or a flat leaf); the question type descendant leaves inherit. */
  questionType?: string;
  children: StructureNode[];
  bindings?: LeafBindings;
};

/**
 * A whole chapter's structure: its metadata (exam/subject/module/chapter) plus the top-level nodes
 * beneath it. Bindings always live on a leaf node, never on the chapter itself — a flat chapter is
 * modelled as a single leaf directly under the chapter.
 */
export type StructureTree = {
  metadata: ChapterMetadataDraft;
  nodes: StructureNode[];
};

/** A node with no children is a leaf — the only place bindings may attach. */
export function isLeaf(node: StructureNode): boolean {
  return node.children.length === 0;
}
