import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TranscribeQuestionRegionRequestSchema } from '@ingest/contracts';

test('selected-region transcription accepts normalized page coordinates and a sibling source', () => {
  const request = TranscribeQuestionRegionRequestSchema.safeParse({
    documentId: 'question-document',
    page: 2,
    bbox: [0.12, 0.28, 0.86, 0.47],
    destination: 'solution',
    source: { documentId: 'solution-document', page: 2 },
  });

  assert.equal(request.success, true);
});

test('selected-region transcription targets exactly one option', () => {
  const request = TranscribeQuestionRegionRequestSchema.safeParse({
    documentId: 'question-document',
    page: 2,
    bbox: [0.12, 0.28, 0.86, 0.47],
    destination: 'option',
    optionIndex: 3,
  });

  assert.equal(request.success, true);
  assert.equal(
    TranscribeQuestionRegionRequestSchema.safeParse({
      documentId: 'question-document',
      page: 2,
      bbox: [0.12, 0.28, 0.86, 0.47],
      destination: 'option',
    }).success,
    false,
  );
});

test('selected-region transcription rejects out-of-page and inverted selections', () => {
  const base = {
    documentId: 'question-document',
    page: 4,
    destination: 'stem',
  };

  assert.equal(TranscribeQuestionRegionRequestSchema.safeParse({ ...base, bbox: [-0.1, 0, 0.5, 0.5] }).success, false);
  assert.equal(TranscribeQuestionRegionRequestSchema.safeParse({ ...base, bbox: [0.8, 0.2, 0.4, 0.5] }).success, false);
});
