import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StructureDetectionStreamEventSchema, type DetectStructureResult } from '@ingest/contracts';
import { ApiError } from '../src/shared/api/api-error.js';
import { readJsonEvents } from '../src/shared/api/read-json-events.js';
import { createStructureStreamReceiver } from '../src/features/ingestion/api/structure-stream-receiver.js';

const result: DetectStructureResult = {
  version: 1,
  pageCount: 3,
  answerLayout: 'separate',
  nodes: [],
  warnings: ['₹ · हिन्दी'],
  usage: null,
};
const progress = { type: 'progress', progress: { completed: 1, total: 3, phase: 'extracting' } };
function stream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start: (controller) => {
      for (const byte of new TextEncoder().encode(text)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
}

void test('fragmented NDJSON and split UTF-8 preserve live progress and the final JSON', async () => {
  const updates: number[] = [];
  const receiver = createStructureStreamReceiver((value) => {
    updates.push(value.completed);
  });
  await readJsonEvents(
    stream(`${JSON.stringify(progress)}\n\n${JSON.stringify({ type: 'result', data: result })}\n`),
    (value) => receiver.onEvent(StructureDetectionStreamEventSchema.parse(value)),
  );
  assert.deepEqual(updates, [1]);
  assert.deepEqual(receiver.result(), result);
});

void test('a valid terminal result stops reading without waiting for the connection to close', async () => {
  let cancelled = false;
  const receiver = createStructureStreamReceiver(() => undefined);
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(
        new TextEncoder().encode(`${JSON.stringify({ type: 'result', data: result })}\n`),
      );
    },
    cancel: () => {
      cancelled = true;
    },
  });
  await readJsonEvents(body, (value) =>
    receiver.onEvent(StructureDetectionStreamEventSchema.parse(value)),
  );
  assert.deepEqual(receiver.result(), result);
  assert.equal(cancelled, true);
});

void test('truncated, malformed or prematurely closed streams cannot be accepted as successful JSON', async () => {
  const receiver = createStructureStreamReceiver(() => undefined);
  await readJsonEvents(stream(`${JSON.stringify(progress)}\n`), (value) =>
    receiver.onEvent(StructureDetectionStreamEventSchema.parse(value)),
  );
  assert.throws(() => receiver.result(), /ended before the final JSON/);
  await assert.rejects(
    readJsonEvents(stream('{"type":"res'), () => true),
    SyntaxError,
  );
  await assert.rejects(
    readJsonEvents(
      stream('{"type":"progress","progress":{"completed":5,"total":3,"phase":"extracting"}}\n'),
      (value) => receiver.onEvent(StructureDetectionStreamEventSchema.parse(value)),
    ),
  );
});

void test('streamed errors keep their usage receipt; older JSON responses remain usable', async () => {
  const receiver = createStructureStreamReceiver(() => undefined);
  const details = { usage: { totalTokens: 120, callCount: 1 } };
  await assert.rejects(
    readJsonEvents(
      stream(
        `${JSON.stringify({
          type: 'error',
          error: {
            code: 'STRUCTURE_DETECTION_FAILED',
            status: 422,
            message: 'Invalid heading',
            details,
          },
        })}\n`,
      ),
      (value) => receiver.onEvent(StructureDetectionStreamEventSchema.parse(value)),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.deepEqual(error.details, details);
      return true;
    },
  );
  receiver.onJsonResponse(result);
  assert.deepEqual(receiver.result(), result);
});
