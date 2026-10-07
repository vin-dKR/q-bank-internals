import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Question } from '@ingest/contracts';
import { PublishIssuesSchema } from '@ingest/contracts';
import { PublishService } from '../src/modules/publish/publish.service.js';

function blockedMatrix(id: string, questionNumber: number): Question {
  return {
    id,
    documentId: 'doc',
    questionNumber,
    passageId: null,
    groupOrder: null,
    answer: '',
    stem: 'Match the columns',
    questionType: 'matrix',
    path: { module: '', chapter: '', section: '' },
    topic: null,
    level: null,
    explanation: null,
    images: [],
    isQuestionImage: false,
    questionImage: null,
    isOptionImage: false,
    optionImages: [],
    answerImages: [],
    explanationImages: [],
    imageCrops: [],
    sectionName: null,
    aiFilled: null,
    className: null,
    subject: null,
    flagged: false,
    isPyq: false,
    pyqExam: null,
    pyqYear: null,
    paper: null,
    sourceRegion: { page: 1, bbox: [0, 0, 1, 1] },
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    options: [],
    match: {
      columns: [
        { title: 'Column I', entries: [{ label: 'A', body: '', image: null }, { label: 'B', body: '', image: null }] },
        { title: 'Column II', entries: [{ label: 'p', body: '', image: null }, { label: 'q', body: '', image: null }] },
      ],
      key: { A: ['p'] },
    },
  };
}

void test('publish issue preflight returns every blocked matrix question with navigation ids', async () => {
  const document = { id: 'doc', status: 'extracted' } as Document;
  const questions = [blockedMatrix('q1', 2), blockedMatrix('q2', 7)];
  const documentRepository = { findById: async () => document };
  const questionRepository = {
    findByDocument: async () => questions,
    findPassagesByDocument: async () => [],
  };
  type Dependencies = ConstructorParameters<typeof PublishService>;
  const service = new PublishService(
    documentRepository as unknown as Dependencies[0],
    questionRepository as unknown as Dependencies[1],
    {} as Dependencies[2],
    {} as Dependencies[3],
  );

  const result = await service.listPublishIssues('doc');
  assert.deepEqual(result.issues.map((issue) => [issue.questionId, issue.questionNumber]), [
    ['q1', 2],
    ['q2', 7],
  ]);
  assert.ok(result.issues.every((issue) => issue.message.includes('every Column-I entry')));
  assert.equal(PublishIssuesSchema.safeParse(result).success, true);
});
