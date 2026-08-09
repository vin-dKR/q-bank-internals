import { PDFDocument } from 'pdf-lib';
import type { ChapterKind, ChapterTopic, ChapterUploadMetadata } from '@ingest/contracts';
import type { StructureNode, StructureTree } from '../types/structure-node.js';
import { leaves, resolveQuestionType } from './structure-tree.js';

/** One unit per chapter, so its section name is a constant — the per-section detail lives in topics. */
const UNIT_SECTION = 'All sections';

type Base = Omit<ChapterUploadMetadata, 'kind' | 'sessionId' | 'topics'>;

/**
 * The whole chapter assembled into a single upload unit: one question PDF (all leaves' question
 * slices concatenated in tree order), one answer PDF, one solution PDF. `question.topics` carries,
 * per leaf, its section path + question type over the page range it occupies in the assembled
 * question PDF — so every question keeps its correct section/type/page without splitting the chapter
 * into many documents.
 */
export type AssembledUpload = {
  base: Base;
  question: { bytes: Uint8Array; topics: ChapterTopic[] } | null;
  answer: Uint8Array | null;
  solution: Uint8Array | null;
  /** Human reasons a leaf was left out (missing question type, etc.). */
  problems: string[];
};

type Leaf = { node: StructureNode; ancestors: StructureNode[] };
type Span = { leaf: Leaf; from: number; to: number };

/** The leaf's section identity: its ancestor labels + own label, path-joined. */
function pathLabel({ node, ancestors }: Leaf): string {
  return [...ancestors, node]
    .map((n) => n.label.trim())
    .filter((label) => label.length > 0)
    .join(' · ');
}

/** Concatenate the given leaves' artifacts of one kind into a single PDF, tracking each leaf's span. */
async function assembleKind(
  orderedLeaves: Leaf[],
  kind: ChapterKind,
): Promise<{ bytes: Uint8Array; spans: Span[] } | null> {
  const out = await PDFDocument.create();
  const spans: Span[] = [];
  for (const leaf of orderedLeaves) {
    const artifact = leaf.node.bindings?.[kind];
    if (!artifact) continue;
    const src = await PDFDocument.load(artifact.bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    const from = out.getPageCount() + 1;
    for (const page of copied) out.addPage(page);
    spans.push({ leaf, from, to: out.getPageCount() });
  }
  if (spans.length === 0) return null;
  return { bytes: await out.save(), spans };
}

export async function assembleChapterUpload(tree: StructureTree): Promise<AssembledUpload> {
  const m = tree.metadata;
  const problems: string[] = [];

  const missing: string[] = [];
  if (!m.exam.trim()) missing.push('exam');
  if (!m.subject.trim()) missing.push('subject');
  if (!m.module.trim()) missing.push('module');
  if (!m.chapter.trim()) missing.push('chapter');
  if (missing.length > 0) {
    return { base: emptyBase(m), question: null, answer: null, solution: null, problems: [`Missing chapter ${missing.join(', ')}.`] };
  }

  // Only leaves with a bound question AND a resolved question type can be assembled into questions.
  const allLeaves: Leaf[] = leaves(tree.nodes);
  const questionLeaves: Leaf[] = [];
  for (const leaf of allLeaves) {
    if (!leaf.node.bindings?.question) continue;
    if (!resolveQuestionType(leaf.node, leaf.ancestors).trim()) {
      problems.push(`${pathLabel(leaf) || '(unnamed)'}: no question type set.`);
      continue;
    }
    questionLeaves.push(leaf);
  }
  const firstLeaf = questionLeaves[0];
  if (!firstLeaf) {
    problems.push('No leaf has a question slice with a question type.');
    return { base: emptyBase(m), question: null, answer: null, solution: null, problems };
  }

  const questionAsm = await assembleKind(questionLeaves, 'question');
  const answerAsm = await assembleKind(questionLeaves, 'answer');
  const solutionAsm = await assembleKind(questionLeaves, 'solution');

  // Each leaf's span in the answer / solution PDF, so extraction reads its answers from exactly its
  // own pages and binds them to its questions (no section-name-and-number guessing).
  const answerByLeaf = new Map<string, Span>(answerAsm?.spans.map((s) => [s.leaf.node.id, s]) ?? []);
  const solutionByLeaf = new Map<string, Span>(solutionAsm?.spans.map((s) => [s.leaf.node.id, s]) ?? []);

  const topics: ChapterTopic[] = questionAsm
    ? questionAsm.spans.map(({ leaf, from, to }) => {
        const a = answerByLeaf.get(leaf.node.id);
        const s = solutionByLeaf.get(leaf.node.id);
        return {
          name: pathLabel(leaf) || 'Section',
          types: [
            {
              questionType: resolveQuestionType(leaf.node, leaf.ancestors).trim(),
              pageRange: { from, to },
              ...(a ? { answerPageRange: { from: a.from, to: a.to } } : {}),
              ...(s ? { solutionPageRange: { from: s.from, to: s.to } } : {}),
            },
          ],
        };
      })
    : [];

  const base: Base = {
    exam: m.exam.trim(),
    subject: m.subject.trim(),
    module: m.module.trim(),
    chapter: m.chapter.trim(),
    sectionName: UNIT_SECTION,
    // Unit-level fallback type (topics cover every question page); use the first leaf's type.
    questionType: resolveQuestionType(firstLeaf.node, firstLeaf.ancestors).trim(),
    ...(m.source.trim() ? { source: m.source.trim() } : {}),
  };

  return {
    base,
    question: questionAsm ? { bytes: questionAsm.bytes, topics } : null,
    answer: answerAsm?.bytes ?? null,
    solution: solutionAsm?.bytes ?? null,
    problems,
  };
}

function emptyBase(m: StructureTree['metadata']): Base {
  return {
    exam: m.exam.trim(),
    subject: m.subject.trim(),
    module: m.module.trim(),
    chapter: m.chapter.trim(),
    sectionName: UNIT_SECTION,
    questionType: '',
    ...(m.source.trim() ? { source: m.source.trim() } : {}),
  };
}
