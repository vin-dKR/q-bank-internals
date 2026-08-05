import type { Document, Question } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { QuestionRepository } from '../questions/index.js';
import type { SessionRepository } from '../sessions/index.js';
import type { BankPublisher, BankQuestion } from './bank-publisher.js';

/**
 * Promotes a document's verified questions into the MAIN bank. Maps each ingest question into the
 * bank's `Question` shape (pulling exam/subject from its session), inserts them, and marks the
 * document `published`. This is the one place the temporary staging becomes real bank data.
 */
export class PublishService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly questions: QuestionRepository,
    private readonly sessions: SessionRepository,
    private readonly bank: BankPublisher,
  ) {}

  async publishDocument(documentId: string): Promise<{ published: number }> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);

    const questions = await this.questions.findByDocument(documentId);
    if (questions.length === 0) return { published: 0 };

    const session = document.sessionId ? await this.sessions.findById(document.sessionId) : null;
    const rows = questions.map((question, index) =>
      toBankQuestion(question, index, document, session?.exam ?? null, session?.subject ?? null),
    );
    const published = await this.bank.insertQuestions(rows);
    await this.documents.updateStatus(documentId, 'published');
    return { published };
  }

  /** Publish every extracted-but-not-yet-published question document in a session. */
  async publishSession(sessionId: string): Promise<{ published: number }> {
    const documents = await this.documents.listBySession(sessionId);
    const targets = documents.filter(
      (document) => document.kind === 'question' && document.status === 'extracted',
    );
    let published = 0;
    for (const document of targets) {
      const result = await this.publishDocument(document.id);
      published += result.published;
    }
    return { published };
  }
}

/** Map one ingest question into the main bank's Question document shape. */
function toBankQuestion(
  question: Question,
  index: number,
  document: Document,
  exam: string | null,
  subject: string | null,
): BankQuestion {
  return {
    question_number: index + 1,
    file_name: document.fileName,
    question_text: question.stem,
    isQuestionImage: question.isQuestionImage,
    question_image: question.questionImage,
    isOptionImage: question.isOptionImage,
    options: question.options.map((option) => `(${option.label}) ${option.body}`),
    option_images: question.optionImages,
    section_name: question.sectionName ?? document.sectionName ?? question.path.section,
    question_type: question.questionType ?? document.questionType ?? null,
    topic: question.topic,
    exam_name: exam,
    subject,
    chapter: question.path.chapter,
    answer: question.answer || null,
    // Worked explanation merged from the sibling solution/explanation PDF (null when none was given).
    // New field on the bank — no prior explanation/solution column existed in the `Question` collection.
    explanation: question.explanation,
    flagged: false,
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
