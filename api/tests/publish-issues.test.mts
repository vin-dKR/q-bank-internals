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
    options: [],
    match: {
      columns: [
        { title: 'Column I', entries: [{ label: 'A', body: '' }, { label: 'B', body: '' }] },
        { title: 'Column II', entries: [{ label: 'p', body: '' }, { label: 'q', body: '' }] },
      ],
      key: { A: ['p'] },
    },
  } as Question;
}

test('publish issue preflight returns every blocked matrix question with navigation ids', async () => {
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
