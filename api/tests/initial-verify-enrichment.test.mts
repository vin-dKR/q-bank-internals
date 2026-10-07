import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChapterKind, ChapterUploadMetadata, Document } from '@ingest/contracts';
import { InMemoryDocumentRepository } from '../src/infrastructure/database/repositories/document.in-memory-repository.js';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';
import { questionPrompt } from '../src/infrastructure/ai/prompts/extraction-prompts.js';
import { IngestionService } from '../src/modules/ingestion/ingestion.service.js';
import type { DriveService } from '../src/modules/drive/index.js';
import type { ExtractionService } from '../src/modules/extraction/index.js';
import { mergeAnswers } from '../src/modules/extraction/merge-answers.js';
import type { AnswerSheet, ExtractedQuestion } from '../src/modules/extraction/vision-extractor.js';
import type { SessionsService } from '../src/modules/sessions/index.js';

type LayoutCase = {
  layout: 'separate' | 'combined' | 'inline';
  support: Array<'answer' | 'solution' | 'companion'>;
};

const layouts: readonly LayoutCase[] = [
  { layout: 'separate', support: ['answer', 'solution'] },
  { layout: 'combined', support: ['companion'] },
  { layout: 'inline', support: [] },
];

function topicRanges(layout: LayoutCase['layout']) {
  return [{
    name: 'Exercise-1',
    types: [{
      questionType: 'single_correct',
      pageRange: { from: 1, to: 1 },
      ...(layout === 'separate' ? {
        answerPageRange: { from: 1, to: 1 },
        solutionPageRange: { from: 1, to: 1 },
      } : {}),
      ...(layout === 'combined' ? { companionPageRange: { from: 1, to: 1 } } : {}),
    }],
  }];
}

function metadata(kind: ChapterKind, layout: LayoutCase['layout']): ChapterUploadMetadata {
  return {
    sessionId: 'session-1',
    uploadGroupId: 'one-upload-unit',
    kind,
    exam: 'NEET',
    subject: 'Physics',
    module: 'Mechanics',
    chapter: 'Kinematics',
    sectionName: 'All sections',
    questionType: 'single_correct',
    source: 'module',
    answerLayout: layout,
    ...(kind === 'question' ? { topics: topicRanges(layout) } : {}),
  };
}

function ingestionHarness() {
  const documents = new InMemoryDocumentRepository();
  const snapshots: Document[][] = [];
  const extraction = {
    enqueue: async (questionId: string) => {
      const question = await documents.findById(questionId);
      assert.equal(question?.kind, 'question');
      snapshots.push(await documents.listBySession('session-1'));
      return {};
    },
  } as unknown as ExtractionService;
  type IngestionDependencies = ConstructorParameters<typeof IngestionService>;
  const service = new IngestionService(
    {
      findOrCreateFolder: async (name: string) => ({ id: `folder:${name}`, name, parentId: null }),
      uploadPdf: async ({ name }: { name: string }) => ({
        id: `drive:${name}`,
        name,
        mimeType: 'application/pdf',
        modifiedTime: null,
        sizeBytes: 1,
      }),
    } as unknown as DriveService,
    documents,
    {
      getById: async () => ({ autoRun: true }),
      backfillContext: async () => undefined,
    } as unknown as SessionsService,
    extraction,
    {
      createSignedUpload: async () => ({ path: 'unused', uploadUrl: 'https://example.test/upload' }),
      download: async () => Buffer.from('pdf'),
      remove: async () => undefined,
    },
    // Upload tests never invoke the OCR or structure-generation ports.
    {} as IngestionDependencies[5],
    {} as IngestionDependencies[6],
    {} as IngestionDependencies[7],
    {} as IngestionDependencies[8],
    70,
  );
  const upload = (kind: ChapterKind, layout: LayoutCase['layout']) =>
    service.uploadChapter({ metadata: metadata(kind, layout), storagePath: `${kind}.pdf` });
  return { snapshots, upload };
}

for (const { layout, support } of layouts) {
  void test(`initial Verify extraction sees all ${layout} sources before auto-run`, async () => {
    const { snapshots, upload } = ingestionHarness();
    for (const kind of support) await upload(kind, layout);
    assert.equal(snapshots.length, 0, 'support files never start question extraction by themselves');

    await upload('question', layout);

    assert.equal(snapshots.length, 1);
    assert.deepEqual(
      snapshots[0]?.map((document) => document.kind),
      [...support, 'question'],
    );
  });
}

void test('a question-first separate upload waits until both bound sources are durable', async () => {
  const { snapshots, upload } = ingestionHarness();
  await upload('question', 'separate');
  assert.equal(snapshots.length, 0);
  await upload('answer', 'separate');
  assert.equal(snapshots.length, 0);
  await upload('solution', 'separate');

  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0]?.map((document) => document.kind), ['question', 'answer', 'solution']);
});

function promptDocument(overrides: Partial<Document>): Document {
  return {
    id: 'question-doc',
    sessionId: 'session-1',
    driveFileId: 'drive-question',
    fileName: 'question.pdf',
    uploadGroupId: 'one-upload-unit',
    path: { module: 'Mechanics', chapter: 'Kinematics', section: 'All sections' },
    kind: 'question',
    sectionName: 'All sections',
    questionType: 'matrix',
    exam: 'NEET',
    className: null,
    subject: 'Physics',
    pyq: false,
    pyqExam: null,
    pyqYear: null,
    paper: null,
    answerLayout: 'inline',
    source: 'module',
    pageRange: null,
    topics: [],
    status: 'uploaded',
    flagged: false,
    questionCount: 0,
    extractedAt: null,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

void test('initial matrix and inline prompts preserve source choice labels', () => {
  const prompt = questionPrompt(promptDocument({}), 1, {});

  assert.match(prompt, /"\(1\) …", "\(5\) …", "\(E\) …", "\(F\) …", "\(I\) …", or "\(iv\) …"/);
  assert.match(prompt, /never convert it to A\/B\/C\/D/i);
  assert.match(prompt, /do not convert numeric\/Roman\/extended labels to A–D/i);
  assert.doesNotMatch(prompt, /normalize \(1\)\(2\)\(3\)\(4\) to \(A\)\(B\)\(C\)\(D\)/i);
  assert.doesNotMatch(prompt, /server generates verified A–D choices/i);
});

void test('initial inline extraction retains non-A–D source labels, answer, and explanation', async () => {
  let sentPrompt = '';
  const extractor = new OpenAiVisionExtractor(
    'test-key',
    'test-model',
    async () => ({}),
    async () => ({ questionType: [], level: [] }),
  );
  Object.assign(extractor, {
    client: {
      chat: {
        completions: {
          create: async (request: { messages: Array<{ content: Array<{ type: string; text?: string }> }> }) => {
            sentPrompt = request.messages[0]?.content[0]?.text ?? '';
            return {
              choices: [{
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    questions: [{
                      question_number: 52,
                      question_text: 'Match the lists.',
                      options: ['(1) First match', '(3) Third match', '(5) Fifth match', '(F) None'],
                      answer: '5',
                      explanation: 'The printed explanation for question 52.',
                    }],
                  }),
                },
              }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    },
  });

  const result = await extractor.extractQuestions({
    pages: [{ pageNumber: 1, png: Buffer.from('page') }],
    document: promptDocument({ questionType: 'single_correct', answerLayout: 'inline' }),
  });

  assert.deepEqual(result.questions[0]?.options, [
    '(1) First match',
    '(3) Third match',
    '(5) Fifth match',
    '(F) None',
  ]);
  assert.equal(result.questions[0].answer, '5');
  assert.equal(result.questions[0].explanation, 'The printed explanation for question 52.');
  assert.match(sentPrompt, /source label/i);
});

void test('initial Verify merges the answer key and matching solution into the same question', () => {
  const question: ExtractedQuestion = {
    questionNumber: 52,
    questionText: 'Match the lists.',
    options: ['(1) First match', '(3) Third match', '(5) Fifth match', '(F) None'],
    answer: null,
    explanation: null,
    sectionName: 'All sections',
    questionType: 'single_correct',
    level: null,
    difficultyConfidence: null,
    sourcePage: 1,
    pyqExam: null,
    pyqYear: null,
    match: null,
    passage: null,
    passageId: null,
    groupOrder: null,
  };
  const sheets: AnswerSheet[] = [
    {
      sectionName: 'All sections',
      entries: { '52': { answer: '5', explanation: null, answerSource: 'answer_key' } },
    },
    {
      sectionName: 'All sections',
      entries: {
        '52': {
          answer: '3',
          explanation: 'The worked explanation for question 52.',
          answerSource: 'solution',
        },
      },
    },
  ];

  const [merged] = mergeAnswers([question], sheets, []);

  assert.equal(merged?.answer, '5', 'the explicit answer key remains canonical');
  assert.equal(merged.explanation, 'The worked explanation for question 52.');
});
