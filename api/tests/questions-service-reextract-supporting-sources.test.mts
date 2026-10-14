import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassageSchema, type ChapterKind, type ChemistryExtraction, type Document, type Passage, type Question, type QuestionOption } from '@ingest/contracts';
import { QuestionsService } from '../src/modules/questions/questions.service.js';
import type { BankQuestionStore } from '../src/modules/bank/index.js';
import type { DocumentRepository } from '../src/modules/documents/index.js';
import type { DiagramDetector } from '../src/modules/questions/diagram-detector.js';
import type { ImageStore } from '../src/modules/questions/image-store.js';
import type { LatexRefiner } from '../src/modules/questions/latex-refiner.js';
import type { PageRenderer } from '../src/modules/questions/page-renderer.js';
import type {
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractInput,
  GroupReExtractInput,
  GroupReExtraction,
} from '../src/modules/questions/question-reextractor.js';
import type { QuestionRepository } from '../src/modules/questions/questions.repository.js';
import type { PaperMetadataExtractor } from '../src/modules/questions/paper-metadata-extractor.js';
import type { AiTokenUsage, RecordUsageInput, UsageService } from '../src/modules/usage/index.js';

const PATH = { module: 'Biology', chapter: 'Diversity', section: 'Exercise-2' };
const QUESTION_ID = 'question-119';
const QUESTION_DOCUMENT_ID = 'question-document';
const ANSWER_DOCUMENT_ID = 'answer-document';
const SOLUTION_DOCUMENT_ID = 'solution-document';

function usage(callCount = 1): AiTokenUsage {
  return {
    model: 'test-model',
    promptTokens: 10 * callCount,
    completionTokens: 5 * callCount,
    totalTokens: 15 * callCount,
    callCount,
  };
}

function sourceDocument(
  id: string,
  kind: ChapterKind,
  answerLayout: 'separate' | 'inline',
): Document {
  return {
    id,
    sessionId: 'session-1',
    driveFileId: `drive:${id}`,
    fileName: `${id}.pdf`,
    uploadGroupId: 'upload-group-1',
    path: PATH,
    kind,
    sectionName: 'Exercise-2',
    questionType: 'single_correct',
    exam: 'NEET',
    className: null,
    subject: 'Biology',
    pyq: false,
    pyqExam: null,
    pyqYear: null,
    paper: null,
    answerLayout,
    source: 'module',
    pageRange: null,
    topics:
      kind === 'question'
        ? [
            {
              name: 'Exercise-2',
              types: [
                {
                  questionType: 'single_correct',
                  pageRange: { from: 52, to: 52 },
                  ...(answerLayout === 'separate'
                    ? {
                        answerPageRange: { from: 12, to: 14 },
                        solutionPageRange: { from: 7, to: 9 },
                      }
                    : {}),
                },
              ],
            },
          ]
        : [],
    status: 'extracted',
    flagged: false,
    questionCount: kind === 'question' ? 1 : 0,
    extractedAt: null,
    deletedAt: null,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
}

function sourceQuestion(): Question {
  return {
    id: QUESTION_ID,
    documentId: QUESTION_DOCUMENT_ID,
    questionNumber: 119,
    path: PATH,
    stem: 'Choose the wrong statement.',
    options: [
      { label: '1', body: 'First printed choice', isCorrect: false },
      { label: '2', body: 'Second printed choice', isCorrect: false },
      { label: '3', body: 'Third printed choice', isCorrect: false },
      { label: '4', body: 'Fourth printed choice', isCorrect: false },
    ],
    answer: '',
    explanation: null,
    images: [],
    match: null,
    passageId: null,
    groupOrder: null,
    isQuestionImage: false,
    questionImage: null,
    isOptionImage: false,
    optionImages: [],
    answerImages: [],
    explanationImages: [],
    imageCrops: [],
    questionType: 'single_correct',
    level: 'easy',
    sectionName: 'Exercise-2',
    topic: 'Microbes',
    aiFilled: null,
    className: null,
    subject: 'Biology',
    flagged: false,
    isPyq: false,
    pyqExam: null,
    pyqYear: null,
    paper: null,
    sourceRegion: { page: 52, bbox: [0, 0, 1, 1] },
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
}

type Harness = {
  service: QuestionsService;
  reads: ReExtractInput[];
  rendered: Array<{ documentId: string; page: number }>;
  recordedUsage: RecordUsageInput[];
};

function reExtractResult(
  values: Pick<QuestionReExtraction, 'stem' | 'options' | 'answer' | 'explanation' | 'match'>,
): QuestionReExtraction {
  return { ...values, usage: usage() };
}

function createHarness(input: {
  answerLayout: 'separate' | 'inline';
  documents: Document[];
  reExtract: (read: ReExtractInput) => Promise<QuestionReExtraction>;
  questions?: Question[];
  passages?: Passage[];
  reExtractGroup?: (read: GroupReExtractInput) => Promise<GroupReExtraction>;
}): Harness {
  const question = sourceQuestion();
  const reads: ReExtractInput[] = [];
  const rendered: Array<{ documentId: string; page: number }> = [];
  const recordedUsage: RecordUsageInput[] = [];
  const questions = {
    findByDocument: async (documentId: string) =>
      documentId === QUESTION_DOCUMENT_ID ? input.questions ?? [question] : [],
    findPassagesByDocument: async () => input.passages ?? [],
  } as unknown as QuestionRepository;
  const documents = {
    findById: async (id: string) => input.documents.find((document) => document.id === id) ?? null,
    listBySession: async (sessionId: string) =>
      input.documents.filter((document) => document.sessionId === sessionId),
  } as unknown as DocumentRepository;
  const pages = {
    renderPage: async (documentId: string, page: number) => {
      rendered.push({ documentId, page });
      return Buffer.from(`${documentId}:${String(page)}`);
    },
  } as PageRenderer;
  const reExtractor = {
    reExtract: async (read: ReExtractInput) => {
      reads.push(read);
      return input.reExtract(read);
    },
    reExtractGroup: async (read: GroupReExtractInput) => {
      if (!input.reExtractGroup) throw new Error('Unexpected group reread');
      return input.reExtractGroup(read);
    },
  } as unknown as QuestionReExtractor;
  const usageService = {
    recordUsage: async (entry: RecordUsageInput) => {
      recordedUsage.push(entry);
    },
  } as unknown as UsageService;

  return {
    service: new QuestionsService(
      questions,
      documents,
      {} as BankQuestionStore,
      {} as ImageStore,
      {} as LatexRefiner,
      usageService,
      {} as DiagramDetector,
      pages,
      reExtractor,
      {} as PaperMetadataExtractor,
    ),
    reads,
    rendered,
    recordedUsage,
  };
}

function primaryOptions(): QuestionOption[] {
  return [
    { label: '1', body: 'First printed choice', isCorrect: false },
    { label: '2', body: 'Second printed choice', isCorrect: false },
    { label: '3', body: 'Third printed choice', isCorrect: false },
    { label: '4', body: 'Fourth printed choice', isCorrect: false },
  ];
}

void test('whole selected-question re-extract merges the linked answer and solution pages', async () => {
  const questionDocument = sourceDocument(QUESTION_DOCUMENT_ID, 'question', 'separate');
  const answerDocument = sourceDocument(ANSWER_DOCUMENT_ID, 'answer', 'separate');
  const solutionDocument = sourceDocument(SOLUTION_DOCUMENT_ID, 'solution', 'separate');
  const { service, reads, rendered, recordedUsage } = createHarness({
    answerLayout: 'separate',
    documents: [questionDocument, answerDocument, solutionDocument],
    reExtract: async (read) => {
      switch (read.sourceKind) {
        case 'answer':
          return reExtractResult({
            stem: '',
            options: [],
            answer: '2',
            explanation: 'Terse answer-key note.',
            match: null,
          });
        case 'solution':
          return reExtractResult({
            stem: '',
            options: [],
            answer: '4',
            explanation: 'Complete worked solution for question 119.',
            match: null,
          });
        default:
          return reExtractResult({
            stem: 'Choose the wrong statement.',
            options: primaryOptions(),
            answer: '',
            explanation: null,
            match: null,
          });
      }
    },
  });

  const result = await service.reExtractQuestion(
    QUESTION_DOCUMENT_ID,
    QUESTION_ID,
    undefined,
    'single_correct',
    {
      answer: { documentId: ANSWER_DOCUMENT_ID, page: 12 },
      solution: { documentId: SOLUTION_DOCUMENT_ID, page: 7 },
    },
  );

  assert.equal(result.stem, 'Choose the wrong statement.');
  assert.deepEqual(result.options, primaryOptions());
  assert.equal(result.answer, '2', 'the answer-key value remains canonical over a solution value');
  assert.equal(result.explanation, 'Complete worked solution for question 119.');
  assert.deepEqual(
    reads.map((read) => ({
      sourceKind: read.sourceKind,
      fieldTarget: read.fieldTarget,
      inlineAnswers: read.inlineAnswers,
      questionNumber: read.questionNumber,
    })),
    [
      {
        sourceKind: 'question',
        fieldTarget: undefined,
        inlineAnswers: undefined,
        questionNumber: 119,
      },
      {
        sourceKind: 'answer',
        fieldTarget: undefined,
        inlineAnswers: undefined,
        questionNumber: 119,
      },
      {
        sourceKind: 'solution',
        fieldTarget: undefined,
        inlineAnswers: undefined,
        questionNumber: 119,
      },
    ],
  );
  assert.deepEqual(rendered, [
    { documentId: QUESTION_DOCUMENT_ID, page: 52 },
    { documentId: ANSWER_DOCUMENT_ID, page: 12 },
    { documentId: SOLUTION_DOCUMENT_ID, page: 7 },
  ]);
  assert.deepEqual(recordedUsage, [
    {
      source: 'reextract',
      documentId: QUESTION_DOCUMENT_ID,
      ...usage(3),
    },
  ]);
});

void test('an inline paper re-extracts only its question page and keeps its inline answer and explanation', async () => {
  const questionDocument = sourceDocument(QUESTION_DOCUMENT_ID, 'question', 'inline');
  const { service, reads, rendered, recordedUsage } = createHarness({
    answerLayout: 'inline',
    documents: [questionDocument],
    reExtract: async (_read) =>
      reExtractResult({
        stem: 'Inline question.',
        options: primaryOptions(),
        answer: '4',
        explanation: 'Inline worked explanation.',
        match: null,
      }),
  });

  const result = await service.reExtractQuestion(
    QUESTION_DOCUMENT_ID,
    QUESTION_ID,
    undefined,
    'single_correct',
    {},
  );

  assert.equal(result.answer, '4');
  assert.equal(result.explanation, 'Inline worked explanation.');
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.sourceKind, 'question');
  assert.equal(reads[0].inlineAnswers, true);
  assert.deepEqual(rendered, [{ documentId: QUESTION_DOCUMENT_ID, page: 52 }]);
  assert.deepEqual(recordedUsage, [
    {
      source: 'reextract',
      documentId: QUESTION_DOCUMENT_ID,
      ...usage(),
    },
  ]);
});

void test('a failed supporting read preserves the primary selected-question result', async () => {
  const questionDocument = sourceDocument(QUESTION_DOCUMENT_ID, 'question', 'separate');
  const answerDocument = sourceDocument(ANSWER_DOCUMENT_ID, 'answer', 'separate');
  const { service, reads, rendered, recordedUsage } = createHarness({
    answerLayout: 'separate',
    documents: [questionDocument, answerDocument],
    reExtract: async (read) => {
      if (read.sourceKind === 'answer') throw new Error('answer key was unreadable');
      return reExtractResult({
        stem: 'Primary question survives.',
        options: primaryOptions(),
        answer: '3',
        explanation: 'Primary inline explanation survives.',
        match: null,
      });
    },
  });

  const result = await service.reExtractQuestion(
    QUESTION_DOCUMENT_ID,
    QUESTION_ID,
    undefined,
    'single_correct',
    { answer: { documentId: ANSWER_DOCUMENT_ID, page: 12 } },
  );

  assert.equal(result.stem, 'Primary question survives.');
  assert.deepEqual(result.options, primaryOptions());
  assert.equal(result.answer, '3');
  assert.equal(result.explanation, 'Primary inline explanation survives.');
  assert.deepEqual(
    reads.map((read) => read.sourceKind),
    ['question', 'answer'],
  );
  assert.deepEqual(rendered, [
    { documentId: QUESTION_DOCUMENT_ID, page: 52 },
    { documentId: ANSWER_DOCUMENT_ID, page: 12 },
  ]);
  assert.deepEqual(recordedUsage, [
    {
      source: 'reextract',
      documentId: QUESTION_DOCUMENT_ID,
      ...usage(),
    },
  ]);
});

void test('group member indexes cannot override conflicting printed identities and molecular diagnostics retain source provenance', async () => {
  const base = sourceQuestion();
  const first = { ...base, id: 'first', questionNumber: 1, printedLabel: 'A-1', passageId: 'group', groupOrder: 0 };
  const second = { ...base, id: 'second', questionNumber: 2, printedLabel: 'B-2', passageId: 'group', groupOrder: 1 };
  const audit = (candidateId: string): NonNullable<ChemistryExtraction['molecularAudits']>[number] => ({ candidateId, fieldPath: '/stem', status: 'matched', message: 'The graph matches the independent molecular read.' });
  const shared = PassageSchema.parse({ id: 'group', documentId: QUESTION_DOCUMENT_ID, text: 'Old passage', passageImage: null, createdAt: base.createdAt, updatedAt: base.updatedAt });
  const { service, recordedUsage } = createHarness({
    answerLayout: 'inline', documents: [sourceDocument(QUESTION_DOCUMENT_ID, 'question', 'inline')], questions: [first, second], passages: [shared],
    reExtract: async () => { throw new Error('Group reread must use its own port'); },
    reExtractGroup: async () => ({
      mode: 'passage_and_questions', passage: 'Use <smiles>CCO</smiles>', usage: usage(), molecularAudits: [{ ...audit('shared'), fieldPath: '/passage' }], chemistryIssues: ['Shared-source comparison needs review.'],
      subQuestions: [
        { memberIndex: 0, printedLabel: 'B-2', questionNumber: 2, stem: 'Second <smiles>CC</smiles>', options: primaryOptions(), answer: '2', explanation: null, match: null, molecularAudits: [audit('second')], chemistryIssues: ['Second structure needs review.'] },
        { memberIndex: 1, printedLabel: 'A-1', questionNumber: 1, stem: 'First <smiles>CO</smiles>', options: primaryOptions(), answer: '1', explanation: null, match: null, molecularAudits: [audit('first')], chemistryIssues: ['First structure needs review.'] },
      ],
    }),
  });
  const result = await service.reExtractGroup(QUESTION_DOCUMENT_ID, 'group');
  assert.deepEqual(result.subQuestions.map((entry) => [entry.questionId, entry.stem]), [['first', 'First <smiles>CO</smiles>'], ['second', 'Second <smiles>CC</smiles>']]);
  assert.deepEqual(result.subQuestions.map((entry) => entry.molecularAudits?.map((entryAudit) => [entryAudit.candidateId, entryAudit.sourceDocumentId, entryAudit.sourcePage])), [[['first', QUESTION_DOCUMENT_ID, 52]], [['second', QUESTION_DOCUMENT_ID, 52]]]);
  assert.deepEqual(result.subQuestions.map((entry) => entry.chemistryIssues), [['First structure needs review.'], ['Second structure needs review.']]);
  assert.deepEqual(result.molecularAudits?.map((entry) => [entry.candidateId, entry.sourceDocumentId, entry.sourcePage]), [['shared', QUESTION_DOCUMENT_ID, 52]]);
  assert.deepEqual(recordedUsage, [{ source: 'reextract', documentId: QUESTION_DOCUMENT_ID, ...usage() }]);
});
