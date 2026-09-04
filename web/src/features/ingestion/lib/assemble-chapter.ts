import { PDFDocument } from 'pdf-lib';
import {
  type ChapterKind,
  type ChapterTopic,
  type ChapterUploadMetadata,
  hasPaperMetadata,
  trimPaperMetadata,
} from '@ingest/contracts';
import type { NodeLevel, StructureNode, StructureTree } from '../types/structure-node.js';
import { appendPdf } from './merge-pdfs.js';
import { leaves, resolveQuestionType, resolveSubject } from './structure-tree.js';

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

/** The leaf's unique matching key: its ancestor labels + own label, path-joined. */
function pathLabel({ node, ancestors }: Leaf): string {
  return [...ancestors, node]
    .map((n) => n.label.trim())
    .filter((label) => label.length > 0)
    .join(' · ');
}

/** The trimmed label of the node at `level` in the leaf's chain, or undefined when absent/blank. */
function labelAtLevel({ node, ancestors }: Leaf, level: NodeLevel): string | undefined {
  const hit = [...ancestors, node].find((n) => n.level === level);
  const label = hit?.label.trim();
  return label ? label : undefined;
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
    const { from, to } = await appendPdf(out, artifact.bytes);
    spans.push({ leaf, from, to });
  }
  if (spans.length === 0) return null;
  return { bytes: await out.save(), spans };
}

export async function assembleChapterUpload(tree: StructureTree): Promise<AssembledUpload> {
  const m = tree.metadata;
  const problems: string[] = [];

  // A PYQ paper spans many subjects/chapters, so subject/module/chapter are optional for it — only the
  // exam is required. Every other source must still name its full path.
  const pyq = isPyqSource(m);
  const missing: string[] = [];
  if (!m.exam.trim()) missing.push('exam');
  if (!pyq) {
    if (!m.subject.trim()) missing.push('subject');
    if (!m.module.trim()) missing.push('module');
    if (!m.chapter.trim()) missing.push('chapter');
  }
  if (missing.length > 0) {
    return { base: emptyBase(m), question: null, answer: null, solution: null, problems: [`Missing chapter ${missing.join(', ')}.`] };
  }

  // Only leaves with a bound question AND a resolved question type can be assembled into questions.
  const allLeaves: Leaf[] = leaves(tree.nodes);
  const questionLeaves: Leaf[] = [];
  for (const leaf of allLeaves) {
    if (!leaf.node.bindings?.question) continue;
    // A PYQ paper's questions are of mixed types, so the type is optional there — a bound question is
    // enough. Every other source still needs a resolved type per leaf to extract correctly.
    if (!pyq && !resolveQuestionType(leaf.node, leaf.ancestors).trim()) {
      problems.push(`${pathLabel(leaf) || '(unnamed)'}: no question type set.`);
      continue;
    }
    questionLeaves.push(leaf);
  }
  const firstLeaf = questionLeaves[0];
  if (!firstLeaf) {
    problems.push(pyq ? 'No leaf has a bound question slice.' : 'No leaf has a question slice with a question type.');
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
        // The split display identity: the Section (top) label → bank section_name, the Topic (leaf)
        // label → bank topic. Part contributes only the question type and is never published.
        const sectionName = labelAtLevel(leaf, 'section');
        const topicName = labelAtLevel(leaf, 'topic');
        const subject = resolveSubject(leaf.node, leaf.ancestors);
        const questionType = resolveQuestionType(leaf.node, leaf.ancestors).trim();
        return {
          name: pathLabel(leaf) || 'Section',
          types: [
            {
              ...(questionType ? { questionType } : {}),
              pageRange: { from, to },
              ...(a ? { answerPageRange: { from: a.from, to: a.to } } : {}),
              ...(s ? { solutionPageRange: { from: s.from, to: s.to } } : {}),
              // A PYQ-source chapter defaults every leaf to PYQ; an explicit per-leaf toggle wins.
              ...((leaf.node.pyq ?? isPyqSource(m)) ? { pyq: true } : {}),
            },
          ],
          ...(sectionName ? { sectionName } : {}),
          ...(topicName ? { topicName } : {}),
          ...(subject ? { subject } : {}),
        };
      })
    : [];

  const unitType = resolveQuestionType(firstLeaf.node, firstLeaf.ancestors).trim();
  const base: Base = {
    exam: m.exam.trim(),
    subject: m.subject.trim(),
    module: m.module.trim(),
    chapter: m.chapter.trim(),
    sectionName: UNIT_SECTION,
    // Unit-level fallback type (topics cover every question page); use the first leaf's type. Omitted
    // for a PYQ paper whose leaves carry no type — its questions are extracted generically.
    ...(unitType ? { questionType: unitType } : {}),
    ...(m.source.trim() ? { source: m.source.trim() } : {}),
    ...pyqFields(m),
    ...paperFields(m),
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
    ...pyqFields(m),
    ...paperFields(m),
  };
}

/** True when the chapter's source is previous-year questions — the whole paper is then marked PYQ. */
function isPyqSource(m: StructureTree['metadata']): boolean {
  return m.source.trim().toLowerCase() === 'pyq';
}

/**
 * The PYQ upload fields, present when the chapter is flagged PYQ — either explicitly (`m.pyq`) or by
 * its source being `pyq`, so a PYQ paper is stamped `pyq: true` on the document even when the operator
 * never touched a per-leaf toggle.
 */
function pyqFields(m: StructureTree['metadata']): Partial<Pick<Base, 'pyq' | 'pyqExam' | 'pyqYear'>> {
  if (!m.pyq && !isPyqSource(m)) return {};
  return {
    pyq: true,
    ...(m.pyqExam.trim() ? { pyqExam: m.pyqExam.trim() } : {}),
    ...(m.pyqYear.trim() ? { pyqYear: m.pyqYear.trim() } : {}),
  };
}

/**
 * The paper-level fields for a PYQ upload: the whole-paper metadata (only when the operator/AI filled
 * something) and the answer layout (only when it differs from the default `separate`). Both are sent
 * regardless of `pyq`/`source` — the panel that fills them is only shown for the pyq source anyway.
 */
function paperFields(m: StructureTree['metadata']): Partial<Pick<Base, 'paper' | 'answerLayout'>> {
  return {
    ...(hasPaperMetadata(m.paper) ? { paper: trimPaperMetadata(m.paper) } : {}),
    ...(m.answerLayout !== 'separate' ? { answerLayout: m.answerLayout } : {}),
  };
}
