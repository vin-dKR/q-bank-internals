import type { ChapterKind, ChapterUploadMetadata } from '@ingest/contracts';
import type { StructureNode, StructureTree } from '../types/structure-node.js';
import { leaves, resolveQuestionType } from './structure-tree.js';

/** The three parts in upload order; only a bound one is uploaded. */
const PART_ORDER: readonly ChapterKind[] = ['question', 'answer', 'solution'];

/** One leaf turned into an upload: the base metadata (minus session/kind) plus its bound part bytes. */
export type LeafUploadJob = {
  leafId: string;
  /** The leaf's path, e.g. "Exercise-1 · Part-I · Section A" — its display label and unit identity. */
  sectionName: string;
  base: Omit<ChapterUploadMetadata, 'kind' | 'sessionId'>;
  parts: { kind: ChapterKind; bytes: Uint8Array }[];
};

/** A leaf that can't be uploaded yet, with a human reason (mirrors the old per-chapter skip note). */
export type LeafUploadProblem = { leafId: string; sectionName: string; reason: string };

export type UploadPlan = { jobs: LeafUploadJob[]; problems: LeafUploadProblem[] };

/** The leaf's section identity: its ancestor labels + own label, path-joined so each leaf is distinct. */
function sectionPath(node: StructureNode, ancestors: StructureNode[]): string {
  return [...ancestors, node]
    .map((n) => n.label.trim())
    .filter((label) => label.length > 0)
    .join(' · ');
}

/**
 * Turn a finished structure tree into the per-leaf upload jobs today's backend already understands:
 * each leaf becomes its own `(module · chapter · section)` unit, and its bound question/answer/
 * solution artifacts upload as the corresponding parts. The path-derived `sectionName` keeps every
 * leaf a distinct unit (so "Section A" under two different Parts never collide). No topic ranges are
 * needed — the leaf *is* the section, so the association the old flow inferred is now explicit.
 */
export function planUploads(tree: StructureTree): UploadPlan {
  const { metadata } = tree;
  const jobs: LeafUploadJob[] = [];
  const problems: LeafUploadProblem[] = [];

  for (const { node, ancestors } of leaves(tree.nodes)) {
    const sectionName = sectionPath(node, ancestors);
    const questionType = resolveQuestionType(node, ancestors);

    const missing: string[] = [];
    if (!metadata.exam.trim()) missing.push('exam');
    if (!metadata.subject.trim()) missing.push('subject');
    if (!metadata.module.trim()) missing.push('module');
    if (!metadata.chapter.trim()) missing.push('chapter');
    if (!sectionName) missing.push('section name');
    if (!questionType) missing.push('question type');
    if (missing.length > 0) {
      problems.push({ leafId: node.id, sectionName: sectionName || '(unnamed)', reason: `Missing ${missing.join(', ')}.` });
      continue;
    }

    const parts = PART_ORDER.flatMap((kind) => {
      const artifact = node.bindings?.[kind];
      return artifact ? [{ kind, bytes: artifact.bytes }] : [];
    });
    if (!parts.some((part) => part.kind === 'question')) {
      problems.push({ leafId: node.id, sectionName, reason: 'No question slice bound.' });
      continue;
    }

    jobs.push({
      leafId: node.id,
      sectionName,
      base: {
        exam: metadata.exam.trim(),
        subject: metadata.subject.trim(),
        module: metadata.module.trim(),
        chapter: metadata.chapter.trim(),
        sectionName,
        questionType: questionType.trim(),
      },
      parts,
    });
  }

  return { jobs, problems };
}
