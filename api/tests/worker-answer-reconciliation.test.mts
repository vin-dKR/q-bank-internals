import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentSchema, type AnswerLayout } from '@ingest/contracts';
import { InMemoryDocumentRepository } from '../src/infrastructure/database/repositories/document.in-memory-repository.js';
import { InMemoryQuestionRepository } from '../src/infrastructure/database/repositories/question.in-memory-repository.js';
import { InMemoryExtractionJobStore } from '../src/infrastructure/database/repositories/extraction-job.in-memory-store.js';
import { InMemoryExtractionDraftStore } from '../src/infrastructure/database/repositories/extraction-draft.in-memory-store.js';
import { ExtractionWorker } from '../src/modules/extraction/extraction.worker.js';
import type { AnswerEntry, ExtractedQuestion, PdfRasterizer, VisionExtractor } from '../src/modules/extraction/index.js';
import type { DriveService } from '../src/modules/drive/index.js';
import type { PagesService } from '../src/modules/pages/index.js';
import type { UsageService } from '../src/modules/usage/index.js';

const usage = { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
const extracted: ExtractedQuestion = {
  questionNumber: 3, printedLabel: 'B-3', questionText: 'Select a product.',
  options: ['(A) First', '(B) Second'], answer: null, explanation: null,
  sectionName: 'Exercise B', questionType: 'single_correct', level: null,
  difficultyConfidence: null, sourcePage: 1, pyqExam: null, pyqYear: null,
  match: null, passage: null, passageId: null, groupOrder: null,
};

async function finalize(initial: AnswerEntry, sibling: AnswerEntry | null, answerLayout: AnswerLayout = 'separate') {
  const documents = new InMemoryDocumentRepository();
  const questions = new InMemoryQuestionRepository();
  const jobs = new InMemoryExtractionJobStore();
  const drafts = new InMemoryExtractionDraftStore();
  const metadata = DocumentSchema.parse({
    id: 'unused', sessionId: 'session', uploadGroupId: 'upload',
    driveFileId: 'question-drive', fileName: 'question.pdf',
    path: { module: 'Chemistry', chapter: 'Nitrogen compounds', section: 'Exercise B' },
    kind: 'question', sectionName: 'Exercise B', questionType: 'single_correct', answerLayout,
    exam: 'NEET', className: null, subject: 'Chemistry', pyq: false, pyqExam: null,
    pyqYear: null, paper: null, source: 'module', pageRange: null, topics: [], flagged: false, deletedAt: null,
    status: 'uploaded', questionCount: 0, extractedAt: null,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  });
  const document = await documents.create(metadata);
  if (sibling) await documents.create({
    ...metadata, kind: sibling.answerSource === 'solution' ? 'solution' : 'answer',
    driveFileId: 'support-drive', fileName: 'support.pdf',
  });
  const job = await jobs.create({ documentId: document.id, model: 'test' });
  await drafts.saveQuestionPage({ jobId: job.id, documentId: document.id, pageNumber: 1, questions: [extracted] });
  await drafts.saveSheetPage({
    jobId: job.id, documentId: document.id, phase: 'companion', pageNumber: 2, scopeKey: 'inline-source',
    sheets: [{ sectionName: 'Exercise B', entries: { 'B-3': initial } }],
  });
  const sourceSheets = () => ({
    sheets: sibling ? [{ sectionName: 'Exercise B', entries: { 'B-3': sibling } }] : [], usage,
  });
  const extractor: VisionExtractor = {
    extractQuestions: async () => { throw new Error('Finalization must use durable question drafts.'); },
    extractAnswers: async () => sourceSheets(),
    extractSolutions: async () => sourceSheets(),
    extractCompanion: async () => sourceSheets(),
  };
  const rasterizer: PdfRasterizer = {
    pageCount: async () => 1,
    rasterizePage: async (_pdf, pageNumber) => ({ pageNumber, png: Buffer.from('source') }),
    rasterizePages: async () => [],
    rasterize: async () => [{ pageNumber: 1, png: Buffer.from('source') }],
  };
  const worker = new ExtractionWorker(
    documents, questions, jobs, drafts,
    { enqueue: async () => undefined, cancel: async () => undefined, process: () => undefined, close: async () => undefined, usesExternalConsumer: false },
    // Finalize uses only these methods; the remaining service methods are outside this test's path.
    { downloadPdf: async () => Buffer.from('pdf') } as unknown as DriveService,
    rasterizer, extractor, {} as UsageService, 1, {} as PagesService,
  );
  await worker.run({ jobId: job.id, documentId: document.id, task: 'finalize' });
  const [saved] = await questions.findByDocument(document.id);
  assert.equal((await jobs.findById(job.id))?.status, 'succeeded');
  assert.ok(saved);
  return saved;
}

void test('finalization reconciles inline explicit keys with later sibling solutions at their original priorities', async () => {
  const saved = await finalize(
    { answer: 'B', explanation: null, answerSource: 'answer_key' },
    { answer: 'A', explanation: 'Worked solution from the sibling.', answerSource: 'solution' },
  );
  assert.equal(saved.answer, 'B');
  assert.equal(saved.explanation, 'Worked solution from the sibling.');
});

void test('equal-authority answer keys conflict across inline and sibling sources', async () => {
  const saved = await finalize(
    { answer: 'B', explanation: null, answerSource: 'answer_key' },
    { answer: 'A', explanation: null, answerSource: 'answer_key' },
  );
  assert.equal(saved.answer, '');
  assert.deepEqual(saved.options.map((option) => option.isCorrect), [false, false]);
});

void test('inline-layout finalization merges its durable keys while retaining its closed source boundary', async () => {
  const saved = await finalize(
    { answer: 'B', explanation: null, answerSource: 'answer_key' },
    { answer: 'A', explanation: null, answerSource: 'answer_key' },
    'inline',
  );
  assert.equal(saved.answer, 'B');
});

void test('combined-layout finalization preserves durable keys when no companion was uploaded', async () => {
  const saved = await finalize(
    { answer: 'B', explanation: null, answerSource: 'answer_key' },
    null,
    'combined',
  );
  assert.equal(saved.answer, 'B');
});
