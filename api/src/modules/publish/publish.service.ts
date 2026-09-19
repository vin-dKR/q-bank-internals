import {
  aiFilledFields,
  type Document,
  hasPaperMetadata,
  matchKeyToAnswer,
  PAPER_METADATA_FIELDS,
  type PaperMetadata,
  type Passage,
  type PublishSessionResult,
  type Question,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { QuestionRepository } from '../questions/index.js';
import type { QuestionTaxonomyInput, ResolvedTaxonomy, TaxonomyResolver } from '../masters/index.js';
import type { BankPublisher, BankQuestion } from './bank-publisher.js';

/**
 * Promotes a document's verified questions into the MAIN bank. Maps each ingest question into the
 * bank's `Question` shape (pulling exam/subject/PYQ provenance from the document the operator filed
 * them under), resolves each taxonomy string to its normalized dictionary FK + label (so the bank
 * filters seek an indexed id, not a regex — eduents' QUESTION_WRITE_CONTRACT §3.1), inserts them, and
 * marks the document `published`. This is the one place the temporary staging becomes real bank data.
 */
export class PublishService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly questions: QuestionRepository,
    private readonly bank: BankPublisher,
    private readonly taxonomy: TaxonomyResolver,
  ) {}

  async publishDocument(documentId: string): Promise<{ published: number }> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);

    // Re-publishing an ALREADY-published document is allowed — it is how a verify edit made AFTER the
    // first publish reaches the bank. The row-level write below is an idempotent upsert keyed on
    // ingest_ref.question_id, so a re-publish overwrites this document's existing bank rows in place
    // (a double-click / overlapping publish can neither duplicate rows nor flip status twice). Only
    // in-flight / pre-extraction states have nothing verified to publish.
    if (document.status !== 'published' && !PUBLISHABLE_STATUSES.has(document.status)) {
      throw errors.documentNotPublishable(documentId, document.status);
    }

    const questions = await this.questions.findByDocument(documentId);
    if (questions.length === 0) return { published: 0 };

    // Comprehension passages are normalized in staging; collapse each group's shared passage text (and
    // image) back onto every sub-question's bank row here, so the bank stays self-contained and the
    // eduents renderer/counter needs no change. group_id == the passage's stable id.
    const passages = await this.questions.findPassagesByDocument(documentId);
    const passageById = new Map(passages.map((passage) => [passage.id, passage] as const));

    // Resolve each question's taxonomy strings to dictionary FKs before mapping. The resolver caches
    // per dimension and dedupes concurrent creates, so this stays a handful of reads even across a
    // whole document; a value the operator hasn't curated self-registers (§8.1 of the write contract).
    const rows = await Promise.all(
      questions.map(async (question, index) => {
        const taxonomy = await this.taxonomy.resolveQuestionTaxonomy(taxonomyInput(question, document));
        return toBankQuestion(question, index, document, passageById, taxonomy);
      }),
    );
    // Ordered: the bank write must be confirmed complete (upsertQuestions throws on any partial or
    // failed write) BEFORE status flips to `published`, so a failed write never marks a document done.
    const published = await this.bank.upsertQuestions(rows);
    await this.documents.updateStatus(documentId, 'published');
    return { published };
  }

  /**
   * Publish every extracted-but-not-yet-published question document in a session. Each document is
   * published independently: one failure is captured and reported, never aborting the others, so a
   * single bad document can't strand the rest of the session unpublished.
   */
  async publishSession(sessionId: string): Promise<PublishSessionResult> {
    const documents = await this.documents.listBySession(sessionId);
    const targets = documents.filter(
      (document) => document.kind === 'question' && document.status === 'extracted',
    );
    const results: PublishSessionResult['documents'] = [];
    let published = 0;
    let failed = 0;
    for (const document of targets) {
      try {
        const result = await this.publishDocument(document.id);
        published += result.published;
        results.push({ documentId: document.id, published: result.published, error: null });
      } catch (caught) {
        failed += 1;
        results.push({
          documentId: document.id,
          published: 0,
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }
    return { published, failed, documents: results };
  }
}

/** Statuses from which a document may be published — everything past a completed extraction. */
const PUBLISHABLE_STATUSES: ReadonlySet<Document['status']> = new Set([
  'extracted',
  'needs_review',
  'approved',
  'completed',
]);

/** camelCase → snake_case, so `pyqExamName` becomes the bank's `pyq_exam_name` column style. */
function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Snake-case the whole-paper PYQ metadata for the bank row (its column style), or null when the
 * upload carried no paper details. Keys stay `pyq_`-prefixed so a PYQ question's paper fields are
 * never confused with an ordinary question's columns. A blank object (every field '') is absent.
 */
function toBankPaper(paper: PaperMetadata | null): Record<string, string> | null {
  if (!hasPaperMetadata(paper) || !paper) return null;
  const row: Record<string, string> = {};
  for (const { key } of PAPER_METADATA_FIELDS) row[snakeCase(key)] = paper[key];
  return row;
}

/**
 * The taxonomy strings a question is filed under, gathered from the same per-question/per-document
 * sources the raw bank columns use, plus the structural signals (passage → comprehension, match →
 * matrix) that decide `questionKind`. `level` has no source yet — the AI difficulty pass populates it.
 */
function taxonomyInput(question: Question, document: Document): QuestionTaxonomyInput {
  return {
    exam: document.exam,
    subject: question.subject ?? document.subject,
    module: question.path.module,
    chapter: question.path.chapter,
    section: question.sectionName ?? document.sectionName ?? question.path.section,
    questionType: question.questionType ?? document.questionType,
    level: question.level,
    groupId: question.passageId,
    matchColumns: question.match ? question.match.columns : null,
    matchKey: question.match ? question.match.key : null,
  };
}

/** Map one ingest question into the main bank's Question document shape. */
function toBankQuestion(
  question: Question,
  index: number,
  document: Document,
  passageById: Map<string, Passage>,
  taxonomy: ResolvedTaxonomy,
): BankQuestion {
  // Resolve this row's comprehension passage (null on ordinary questions). A comprehension member has a
  // passageId (v2) — or, on a row extracted under v1 before the passage was normalized, a non-null
  // groupOrder whose old passage columns are now unmapped. Either way, if we cannot resolve its Passage
  // the group linkage is lost, so fail the publish LOUDLY (re-extracting the document regenerates the v2
  // shape) instead of silently writing a null passage with a dangling group_order.
  const passage = question.passageId !== null ? passageById.get(question.passageId) : null;
  if (!passage && (question.passageId !== null || question.groupOrder !== null)) {
    throw errors.passageNotResolved(question.id, question.passageId ?? '(legacy pre-v2 row)');
  }
  return {
    // The shared admin bank: ingest publishes for every org to read. eduents' tenancy read filter
    // (`{ organizationId: null }`) matches a row only when the field EXISTS and is null — a row that
    // OMITS the field is invisible to every org. So stamp an EXPLICIT null; never leave it absent.
    organizationId: null,
    question_number: index + 1,
    file_name: document.fileName,
    question_text: question.stem,
    isQuestionImage: question.isQuestionImage,
    question_image: question.questionImage,
    isOptionImage: question.isOptionImage,
    options: question.options.map((option) => `(${option.label}) ${option.body}`),
    option_images: question.optionImages,
    // Structured match-the-column data (2+ columns + the label→labels key) for MATRIX questions;
    // null for every other type. New bank fields — a flat renderer still shows the matching via the
    // mirrored `answer` string below, so nothing breaks if the bank ignores them.
    match_columns: question.match ? question.match.columns : null,
    match_key: question.match ? question.match.key : null,
    // Comprehension grouping (BLA-125). Each sub-question is its own bank row; these link the group so
    // the eduents renderer shows the passage ONCE above its ordered sub-questions and COUNTS each
    // sub-question (never the group). The passage text/image are normalized in staging and COLLAPSED
    // back here — `passage` is the shared text (repeated identically on every sibling row, so the bank
    // shape is unchanged), `group_id` the passage's stable id, `group_order` this sub-question's 0-based
    // position. All null on ordinary questions.
    passage: passage?.text ?? null,
    // The passage's shared figure, carried through for the eduents renderer (rendering is a follow-up).
    passage_image: passage?.passageImage ?? null,
    group_id: question.passageId,
    group_order: question.groupOrder,
    section_name: question.sectionName ?? document.sectionName ?? question.path.section,
    question_type: question.questionType ?? document.questionType ?? null,
    topic: question.topic,
    // Difficulty band, carried through so a graded question keeps its level across re-publishes.
    level: question.level,
    // Which of those values an AI wrote. Carried so a re-publish keeps the provenance; omitted (not null)
    // when nothing is AI-filled, so ordinary rows are unchanged.
    ...(aiFilledFields(question.aiFilled).length > 0 && { ai_filled: question.aiFilled }),
    // Authoritative exam/subject: the operator's per-chapter pick on the document (not the session's
    // first-write-wins backfill), so a Biology/NEET chapter never publishes as Physics/JEE. Subject is
    // sourced per-question first (a PYQ paper spans subjects — the node's subject wins), then the document.
    exam_name: document.exam,
    subject: question.subject ?? document.subject,
    // Normalized taxonomy FKs + clean labels + questionKind/levelRank, resolved from the raw strings
    // above through the SAME foldMaps eduents uses (QUESTION_WRITE_CONTRACT §3.1). The keys are the
    // exact bank column names, so the bank filters seek an indexed id instead of a case-folded regex;
    // the raw columns stay untouched for losslessness. All null when a value is junk/absent.
    ...taxonomy,
    // The module name lives on the ingest path; stamping it lets the Questions Module filter narrow the
    // published list. Its normalized FK (`moduleId`/`moduleName`) comes from the `...taxonomy` spread
    // above — resolved against the new Module master so eduents can index it like the other dimensions.
    module: question.path.module,
    // PYQ provenance so a previous-year question shows and filters as such in the Questions browse.
    // Sourced per-question (the model reads the source exam/year off the page for a PYQ segment),
    // falling back to the document-level values so legacy rows extracted before per-question PYQ still read.
    is_pyq: question.isPyq || document.pyq,
    pyq_exam: question.pyqExam ?? document.pyqExam,
    pyq_year: question.pyqYear ?? document.pyqYear,
    // Whole-paper PYQ provenance (exam name/year/session/shift/paper code …), denormalized from the
    // question (falling back to the document). Snake-cased to match the bank's column style; a new
    // optional field, so the bank simply carries it and existing readers are unaffected. Null when
    // the upload was not a PYQ paper.
    paper: toBankPaper(question.paper ?? document.paper),
    chapter: question.path.chapter,
    // For a match question the answer is the key mirrored to text ("A-p,t; B-q,u"); else the raw answer.
    answer:
      (question.match && Object.keys(question.match.key).length > 0
        ? matchKeyToAnswer(question.match.key)
        : question.answer) || null,
    // Worked explanation merged from the sibling solution/explanation PDF (null when none was given).
    // New field on the bank — no prior explanation/solution column existed in the `Question` collection.
    explanation: question.explanation,
    // Carry the verify-screen flag onto the published row, so a question marked for later attention
    // stays flagged (and findable via the Flagged filter) in the Questions browse.
    flagged: question.flagged,
    // Provenance back to the ingest pipeline (session + document + question + Drive file + source
    // region). New field on the bank — lets the "fix a published image" flow reopen the exact page
    // and box to re-crop from. Snake-cased to match the bank's column style.
    ingest_ref: {
      session_id: document.sessionId,
      document_id: document.id,
      question_id: question.id,
      drive_file_id: document.driveFileId,
      source_region: {
        page: question.sourceRegion.page,
        bbox: question.sourceRegion.bbox,
      },
    },
  };
}
