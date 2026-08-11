import { emptyMetadata, type ChapterMetadataDraft } from '../types/chapter-group.js';
import { NODE_LEVELS, type NodeLevel, type StructureNode, type StructureTree } from '../types/structure-node.js';
import { makeId } from './make-id.js';

/**
 * The portable, JSON-serializable shape of one structure node: its structure only — label, level,
 * and (optional) question type — with no id and no bindings. Ids are regenerated on import and
 * bindings hold document-specific binary bytes, so neither belongs in a shareable config.
 */
export type ConfigNode = {
  label: string;
  level: NodeLevel | null;
  questionType?: string;
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
const METADATA_KEYS: readonly (keyof ChapterMetadataDraft)[] = [
  'source',
  'exam',
  'subject',
  'module',
  'chapter',
  'sectionName',
  'questionType',
];

function toConfigNode(node: StructureNode): ConfigNode {
  return {
    label: node.label,
    level: node.level,
    ...(node.questionType !== undefined ? { questionType: node.questionType } : {}),
    children: node.children.map(toConfigNode),
  };
}

/** Strip a live tree down to a shareable config: structure only, no ids, no bound page slices. */
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

  return {
    label: value.label,
    level: parseLevel(value.level),
    ...(typeof value.questionType === 'string' ? { questionType: value.questionType } : {}),
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
