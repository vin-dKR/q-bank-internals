import {
  DEFAULT_STRUCTURE_HIERARCHY,
  type ChapterKind,
  type StructureHierarchyLevel,
  type DetectedStructureNode,
} from '@ingest/contracts';
import type { ChapterMetadataDraft } from './chapter-group.js';

/** Editor choice only; switching it never changes the saved hierarchy or attachments. */
export type StructureEntryMode = 'auto' | 'manual';

/**
 * The optional structural levels between a chapter and its leaves, matching the source material:
 * `Chapter → Section → Part → Topic → questions`. Every level is optional — a deep
 * Resonance PDF uses all of them, a flat NEET DPP uses none (one leaf directly under the chapter).
 * The `Section` level mirrors the main app's "Section" filter (which lists exercises like
 * `EXERCISE (JM)`); the `Topic` leaf is the fine-grained topic (e.g. `Kinematics`); `Part` only
 * organizes — it is never published. The question type is chosen on the leaf, never on a parent.
 */
export type NodeLevel = NonNullable<DetectedStructureNode['level']>;

/** Default levels for older configs; current provider levels come from its saved hierarchy. */
export const NODE_LEVELS: readonly NodeLevel[] = DEFAULT_STRUCTURE_HIERARCHY.map(
  (level) => level.id,
);

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
  /**
   * The 1-based working-document pages this slice was cut from, in materialization order. Portable
   * provenance: the exported config carries these so the same PDF can be rebound after an import.
   */
  pageNumbers: number[];
  /** Human-facing provenance for display only, e.g. "pages 3–5". */
  sourceLabel: string;
};

/**
 * The parts bound to a leaf. Only `question` is required to extract; the selected supporting source is
 * either separate `answer` / `solution` PDFs or one grouped `companion` PDF. The operator asserts this
 * association explicitly (drops each part onto the same leaf), replacing the old
 * match-by-section-and-number heuristic.
 */
export type LeafBindings = Partial<Record<ChapterKind, MaterializedArtifact>>;

/**
 * One node of the durable structure tree. The tree is the source of truth; PDF slices attach to its
 * leaves as materialized artifacts. A node is a *leaf* when it has no children — only leaves carry
 * bindings. `questionType` is chosen on the leaf (the last node in a branch), never on a parent.
 */
export type StructureNode = {
  id: string;
  label: string;
  level: NodeLevel | null;
  /** The question type for this leaf's questions. Set only on a leaf (never on a parent node). */
  questionType?: string;
  /**
   * The subject for this leaf's questions — set on a leaf beside the question type. A PYQ paper spans
   * subjects, so each section/leaf can carry its own; it flows to `question.subject` at extraction and
   * to the published bank row. Inherited from the nearest ancestor that sets one, like `questionType`.
   */
  subject?: string;
  /**
   * Operator's per-node previous-year-questions toggle. Set on a leaf (the segment that binds page
   * ranges); flows to the assembled topic's `TopicTypeConfig.pyq` so extraction reads each question's
   * source exam + year off the page. Undefined/false means an ordinary segment.
   */
  pyq?: boolean;
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
  hierarchy?: StructureHierarchyLevel[];
};

/** A node with no children is a leaf — the only place bindings may attach. */
export function isLeaf(node: StructureNode): boolean {
  return node.children.length === 0;
}
