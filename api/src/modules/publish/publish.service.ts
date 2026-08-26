import {
  type Document,
  matchKeyToAnswer,
  type PublishSessionResult,
  type Question,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { QuestionRepository } from '../questions/index.js';
import type { BankPublisher, BankQuestion } from './bank-publisher.js';

/**
 * Promotes a document's verified questions into the MAIN bank. Maps each ingest question into the
 * bank's `Question` shape (pulling exam/subject/PYQ provenance from the document the operator filed
 * them under), inserts them, and marks the document `published`. This is the one place the temporary
 * staging becomes real bank data.
 */
export class PublishService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly questions: QuestionRepository,
    private readonly bank: BankPublisher,
  ) {}

  async publishDocument(documentId: string): Promise<{ published: number }> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);

    // Already in the bank: a no-op, not a re-insert. Guards the double-click / overlapping-session
    // race — combined with the idempotent upsert below, a second publish can neither duplicate rows
    // nor flip status twice. In-flight / pre-extraction states have nothing verified to publish.
    if (document.status === 'published') return { published: 0 };
    if (!PUBLISHABLE_STATUSES.has(document.status)) {
      throw errors.documentNotPublishable(documentId, document.status);
    }

    const questions = await this.questions.findByDocument(documentId);
    if (questions.length === 0) return { published: 0 };

    const rows = questions.map((question, index) => toBankQuestion(question, index, document));
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

/** Map one ingest question into the main bank's Question document shape. */
function toBankQuestion(question: Question, index: number, document: Document): BankQuestion {
  return {
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
    section_name: question.sectionName ?? document.sectionName ?? question.path.section,
    question_type: question.questionType ?? document.questionType ?? null,
    topic: question.topic,
    // Authoritative exam/subject: the operator's per-chapter pick on the document (not the session's
    // first-write-wins backfill), so a Biology/NEET chapter never publishes as Physics/JEE.
    exam_name: document.exam,
    subject: document.subject,
    // The module lives on the ingest path; stamping it onto the bank row is what lets the Questions
    // Module filter narrow the published list (the bank had no module column before).
    module: question.path.module,
    // PYQ provenance so a previous-year question shows and filters as such in the Questions browse.
    // Sourced per-question (the model reads the source exam/year off the page for a PYQ segment),
    // falling back to the document-level values so legacy rows extracted before per-question PYQ still read.
    is_pyq: question.isPyq || document.pyq,
    pyq_exam: question.pyqExam ?? document.pyqExam,
    pyq_year: question.pyqYear ?? document.pyqYear,
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
