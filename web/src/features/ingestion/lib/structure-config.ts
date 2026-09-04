import { type ChapterKind, PAPER_METADATA_FIELDS } from '@ingest/contracts';
import { emptyMetadata, type ChapterMetadataDraft } from '../types/chapter-group.js';
import {
  NODE_LEVELS,
  isLeaf,
  type LeafBindings,
  type NodeLevel,
  type StructureNode,
  type StructureTree,
} from '../types/structure-node.js';
import { makeId } from './make-id.js';

/** The page assignments a leaf's bindings were cut from — 1-based working-document page numbers. */
export type ConfigPages = Partial<Record<ChapterKind, number[]>>;

/**
 * The portable, JSON-serializable shape of one structure node: label, level, (optional) question
 * type, and — on a bound leaf — the page numbers each part was cut from. Ids are regenerated on
 * import and binding *bytes* stay out (they are document-specific); the page numbers are portable
 * provenance, re-materialized against the loaded PDF when the config is imported.
 */
export type ConfigNode = {
  label: string;
  level: NodeLevel | null;
  questionType?: string;
  /** The operator's per-node subject, exported so a reused chapter config keeps its subject tags. */
  subject?: string;
  /** The operator's per-node PYQ toggle, exported so a reused chapter config keeps its PYQ segments. */
  pyq?: boolean;
  pages?: ConfigPages;
  children: ConfigNode[];
};

/** A whole chapter's exported config: its metadata plus the pruned node forest. */
export type StructureConfig = {
  version: 1;
  metadata: ChapterMetadataDraft;
  nodes: ConfigNode[];
};

/** The metadata + nodes recovered from a config file, ready to rebuild a live tree from. */
export type ParsedConfig = {
  metadata: ChapterMetadataDraft;
  nodes: ConfigNode[];
};

const CONFIG_VERSION = 1;
// The string-valued metadata fields, copied verbatim on import. The non-string fields (`pyq` boolean,
// `paper` object, `answerLayout` union) are handled separately below, while `serializeConfig` exports
// every field via a spread.
const METADATA_KEYS: readonly Exclude<keyof ChapterMetadataDraft, 'pyq' | 'paper' | 'answerLayout'>[] = [
  'source',
  'exam',
  'subject',
  'module',
  'chapter',
  'sectionName',
  'questionType',
  'pyqExam',
  'pyqYear',
];

const PAGE_KINDS: readonly ChapterKind[] = ['question', 'answer', 'solution'];

/** The exportable page numbers of a leaf's bindings, or undefined when nothing is bound. */
function pagesFromBindings(bindings: LeafBindings | undefined): ConfigPages | undefined {
  if (!bindings) return undefined;
  const pages: ConfigPages = {};
  for (const kind of PAGE_KINDS) {
    const artifact = bindings[kind];
    if (artifact && artifact.pageNumbers.length > 0) pages[kind] = [...artifact.pageNumbers];
  }
  return Object.keys(pages).length > 0 ? pages : undefined;
}

function toConfigNode(node: StructureNode): ConfigNode {
  const pages = pagesFromBindings(node.bindings);
  return {
    label: node.label,
    level: node.level,
    ...(node.questionType !== undefined ? { questionType: node.questionType } : {}),
    ...(node.subject !== undefined ? { subject: node.subject } : {}),
    ...(node.pyq !== undefined ? { pyq: node.pyq } : {}),
    ...(pages !== undefined ? { pages } : {}),
    children: node.children.map(toConfigNode),
  };
}

/** Strip a live tree down to a shareable config: structure + page numbers, no ids, no PDF bytes. */
export function serializeConfig(tree: StructureTree): StructureConfig {
  return {
    version: CONFIG_VERSION,
    metadata: { ...tree.metadata },
    nodes: tree.nodes.map(toConfigNode),
  };
}

/** Rebuild live structure nodes from config nodes — fresh ids throughout, no bindings. */
export function nodesFromConfig(nodes: ConfigNode[]): StructureNode[] {
  return nodes.map((node) => ({
    id: makeId(),
    label: node.label,
    level: node.level,
    ...(node.questionType !== undefined ? { questionType: node.questionType } : {}),
    ...(node.subject !== undefined ? { subject: node.subject } : {}),
    ...(node.pyq !== undefined ? { pyq: node.pyq } : {}),
    children: nodesFromConfig(node.children),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLevel(value: unknown): NodeLevel | null {
  return typeof value === 'string' && (NODE_LEVELS as readonly string[]).includes(value)
    ? (value as NodeLevel)
    : null;
}

/**
 * Parse a node's page assignments leniently: a kind whose list is not purely positive integers is
 * dropped (never half-bound to a wrong slice), and an empty result collapses to "no pages".
 */
function parsePages(value: unknown): ConfigPages | undefined {
  if (!isRecord(value)) return undefined;
  const pages: ConfigPages = {};
  for (const kind of PAGE_KINDS) {
    const list = value[kind];
    if (!Array.isArray(list) || list.length === 0) continue;
    if (!list.every((page) => typeof page === 'number' && Number.isInteger(page) && page >= 1)) continue;
    pages[kind] = list as number[];
  }
  return Object.keys(pages).length > 0 ? pages : undefined;
}

function parseNode(value: unknown): ConfigNode | null {
  if (!isRecord(value)) return null;
  if (typeof value.label !== 'string') return null;
  if (!Array.isArray(value.children)) return null;

  const children: ConfigNode[] = [];
  for (const child of value.children) {
    const parsed = parseNode(child);
    if (!parsed) return null;
    children.push(parsed);
  }

  const pages = parsePages(value.pages);
  return {
    label: value.label,
    level: parseLevel(value.level),
    ...(typeof value.questionType === 'string' ? { questionType: value.questionType } : {}),
    ...(typeof value.subject === 'string' ? { subject: value.subject } : {}),
    ...(typeof value.pyq === 'boolean' ? { pyq: value.pyq } : {}),
    ...(pages !== undefined && children.length === 0 ? { pages } : {}),
    children,
  };
}

function parseMetadata(value: unknown): ChapterMetadataDraft {
  const draft = emptyMetadata();
  if (!isRecord(value)) return draft;
  for (const key of METADATA_KEYS) {
    const field = value[key];
    if (typeof field === 'string') draft[key] = field;
  }
  if (typeof value.pyq === 'boolean') draft.pyq = value.pyq;
  if (value.answerLayout === 'inline' || value.answerLayout === 'separate') {
    draft.answerLayout = value.answerLayout;
  }
  if (isRecord(value.paper)) {
    for (const { key } of PAPER_METADATA_FIELDS) {
      const field = value.paper[key];
      if (typeof field === 'string') draft.paper[key] = field;
    }
  }
  return draft;
}

/**
 * Validate untrusted config text into a {@link ParsedConfig}, or `null` if it is not shaped like one.
 * Unknown/extra metadata is ignored and missing metadata falls back to empty, but a malformed node
 * (missing label, non-array children) rejects the whole file — a half-parsed tree is never returned.
 */
export function parseConfig(text: string): ParsedConfig | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return null;

  const nodes: ConfigNode[] = [];
  for (const node of raw.nodes) {
    const parsed = parseNode(node);
    if (!parsed) return null;
    nodes.push(parsed);
  }

  return { metadata: parseMetadata(raw.metadata), nodes };
}

/** One page assignment recovered from an imported config, addressed to its rebuilt live leaf. */
export type ConfigPageBinding = {
  leafId: string;
  kind: ChapterKind;
  pages: number[];
};

/**
 * Pair every imported leaf's page assignments with the id of its rebuilt live node, so the caller
 * can re-materialize each slice from the loaded PDF. `nodes` must be the forest built from `configs`
 * (see {@link nodesFromConfig}) — the two are walked in lockstep by position.
 */
export function configPageBindings(
  configs: ConfigNode[],
  nodes: StructureNode[],
): ConfigPageBinding[] {
  const out: ConfigPageBinding[] = [];
  configs.forEach((config, index) => {
    const node = nodes[index];
    if (!node) return;
    if (config.pages && isLeaf(node)) {
      for (const kind of PAGE_KINDS) {
        const pages = config.pages[kind];
        if (pages && pages.length > 0) out.push({ leafId: node.id, kind, pages });
      }
    }
    out.push(...configPageBindings(config.children, node.children));
  });
  return out;
}
