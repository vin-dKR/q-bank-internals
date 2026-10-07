import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import {
  EMPTY_PAPER_METADATA,
  DetectedStructureSchema,
  JSON_STREAM_CONTENT_TYPE,
  StructureDetectionStreamEventSchema,
  type DetectStructureResult,
  type StructureDetectionContext,
  type StructureDetectionProgress,
  type StructureTextCrop,
} from '@ingest/contracts';
import { OpenAiStructureExtractor } from '../src/infrastructure/ai/openai.structure-extractor.js';
import { IngestionService } from '../src/modules/ingestion/ingestion.service.js';
import { createIngestionRouter } from '../src/modules/ingestion/ingestion.routes.js';
import { errorHandler } from '../src/shared/middleware/error-handler.js';
import { errors } from '../src/shared/errors/error-catalog.js';

function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const context: StructureDetectionContext = {
  className: '',
  source: 'module',
  exam: 'JEE',
  subject: 'Chemistry',
  module: 'Resonance',
  chapter: 'Aromatic Compounds',
  sectionName: '',
  questionType: '',
  pyq: false,
  pyqExam: '',
  pyqYear: '',
  paper: { ...EMPTY_PAPER_METADATA },
  answerLayout: 'separate',
};
const crops: StructureTextCrop[] = [
  { id: 'exercise', pageNumber: 1, role: 'section', text: 'Exercise-1' },
  { id: 'part', pageNumber: 1, role: 'part', text: 'PART I' },
  { id: 'phenol', pageNumber: 1, role: 'topic', text: 'Section (A): Phenol' },
  { id: 'amines', pageNumber: 2, role: 'topic', text: 'Section (B): Amines' },
];
const labels = ['Exercise-1', 'I', 'Phenol', 'Amines'];
function reply(index: number): unknown {
  const crop = crops[index];
  assert.ok(crop?.role);
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            crops: [
              {
                cropId: crop.id,
                items: [
                  {
                    section: null,
                    part: null,
                    topic: null,
                    [crop.role]: { printed: crop.text, label: labels[index] },
                    questionType: null,
                  },
                ],
              },
            ],
          }),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

void test(
  'progress arrives when parallel crops settle; hierarchy and cached regeneration remain ordered',
  { timeout: 10000 },
  async () => {
    const adapter = new OpenAiStructureExtractor('test-key', 'gpt-5.4-mini');
    const waits = crops.map(() => gate());
    const started = gate();
    const fourth = gate();
    const firstProgress = gate();
    const secondProgress = gate();
    let calls = 0;
    let billed = 0;
    Object.assign(adapter, {
      client: {
        chat: {
          completions: {
            create: async () => {
              const index = calls++;
              if (calls === 3) started.open();
              if (calls === 4) fourth.open();
              await waits[index]?.promise;
              return reply(index);
            },
          },
        },
      },
    });
    const progress: StructureDetectionProgress[] = [];
    const work = adapter.extract({
      crops,
      pageCount: 3,
      context,
      assignQuestionPages: true,
      onUsage: async () => {
        billed += 1;
      },
      onProgress: (value) => {
        progress.push(value);
        if (value.completed === 1) firstProgress.open();
        if (value.completed === 2) secondProgress.open();
      },
    });
    await started.promise;
    waits[2]?.open();
    await firstProgress.promise;
    assert.equal(calls, 3);
    assert.equal(billed, 0);
    assert.deepEqual(progress, [{ completed: 1, total: 4, phase: 'extracting' }]);
    waits[1]?.open();
    await secondProgress.promise;
    waits[0]?.open();
    await fourth.promise;
    assert.equal(billed, 3);
    waits[3]?.open();
    const result = DetectedStructureSchema.parse(await work);
    assert.equal(result.aiCallCount, 4);
    assert.equal(billed, 4);
    const part = result.nodes[0]?.children[0];
    assert.ok(part);
    assert.deepEqual(
      part.children.map((node) => node.label),
      ['Phenol', 'Amines'],
    );
    assert.deepEqual(
      part.children.map((node) => node.pages.question),
      [[1], [2, 3]],
    );
    assert.deepEqual(
      progress.map((value) => value.completed),
      [1, 2, 3, 4, 4],
    );
    assert.equal(progress.at(-1)?.phase, 'building');

    const reusedProgress: StructureDetectionProgress[] = [];
    const reused = DetectedStructureSchema.parse(
      await adapter.extract({
        crops: [...crops, { id: 'blank', pageNumber: 3, text: '' }],
        savedCrops: result.cropResults ?? [],
        pageCount: 3,
        context,
        assignQuestionPages: true,
        onUsage: async () => {
          throw new Error('Cached generation must not consume AI tokens');
        },
        onProgress: (value) => {
          reusedProgress.push(value);
        },
      }),
    );
    assert.equal(calls, 4);
    assert.equal(reused.aiCallCount, 0);
    assert.deepEqual(reused.nodes, result.nodes);
    assert.deepEqual(reusedProgress.at(-1), { completed: 5, total: 5, phase: 'building' });
  },
);

void test(
  'disconnect stops new AI dispatches while recording all in-flight usage',
  { timeout: 10000 },
  async () => {
    const adapter = new OpenAiStructureExtractor('test-key', 'gpt-5.4-mini');
    const started = gate();
    const finish = gate();
    let calls = 0;
    let billed = 0;
    let disconnected = false;
    Object.assign(adapter, {
      client: {
        chat: {
          completions: {
            create: async () => {
              const index = calls++;
              if (calls === 3) started.open();
              await finish.promise;
              return reply(index);
            },
          },
        },
      },
    });
    const service = new IngestionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      adapter,
      {
        assertWithinLimit: async () => {},
        recordUsage: async () => {
          billed += 1;
        },
      } as never,
      { resolveContext: async () => null },
      {} as never,
      70,
    );
    const progress: StructureDetectionProgress[] = [];
    const work = service.detectStructure(
      { crops, pageCount: 3, context },
      {
        isDisconnected: () => disconnected,
        onProgress: (value) => {
          progress.push(value);
        },
      },
    );
    await started.promise;
    disconnected = true;
    finish.open();
    const result = await work;
    assert.equal(calls, 3);
    assert.equal(billed, 3);
    assert.equal(result.usage?.callCount, 3);
    assert.deepEqual(progress.at(-1), { completed: 3, total: 4, phase: 'building' });
    assert.match(result.warnings.join(' '), /connection was closed/);
  },
);

void test(
  'HTTP stream delivers live progress and terminal results/errors, retaining normal JSON and validation',
  { timeout: 15000 },
  async (t) => {
    const result: DetectStructureResult = {
      version: 1,
      pageCount: 3,
      answerLayout: 'separate',
      nodes: [],
      warnings: [],
      usage: null,
    };
    const finish = gate();
    let calls = 0;
    let fail = false;
    const failure = errors.structureDetectionChargedFailure(
      errors.structureDetectionFailed('Invalid heading'),
      {
        model: 'test-model',
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cachedPromptTokens: 0,
        reasoningTokens: 0,
        callCount: 1,
        pricing: null,
        costUsd: null,
      },
    );
    const service = {
      detectStructure: async (
        _input: Parameters<IngestionService['detectStructure']>[0],
        options: Parameters<IngestionService['detectStructure']>[1],
      ) => {
        calls += 1;
        options?.onProgress?.({ completed: 1, total: 4, phase: 'extracting' });
        if (options) await finish.promise;
        if (fail) throw failure;
        options?.onProgress?.({ completed: 4, total: 4, phase: 'building' });
        return result;
      },
    };
    const app = express();
    app.use(express.json());
    app.use('/ingestion', createIngestionRouter(service as never));
    app.use(errorHandler);
    const server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(async () => {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      server.closeAllConnections();
      await closed;
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${String(address.port)}/ingestion/detect-structure`;
    const input = { crops, pageCount: 3, context };
    const post = (accept: string, body: unknown = input): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: { accept, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const response = await post(JSON_STREAM_CONTENT_TYPE);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(JSON_STREAM_CONTENT_TYPE));
    assert.ok(response.body);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    let text = new TextDecoder().decode(first.value);
    assert.match(text, /"completed":0/);
    assert.doesNotMatch(text, /"type":"result"/);
    finish.open();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    reader.releaseLock();
    const frames = text
      .trim()
      .split('\n')
      .map((line) => StructureDetectionStreamEventSchema.parse(JSON.parse(line) as unknown));
    assert.equal(frames.filter((frame) => frame.type === 'result').length, 1);
    assert.deepEqual(frames.at(-1), { type: 'result', data: result });
    assert.ok(frames.some((frame) => frame.type === 'progress' && frame.progress.completed === 1));

    const ordinary = await post('*/*');
    assert.equal(ordinary.headers.get('content-type')?.startsWith('application/json'), true);
    assert.deepEqual(await ordinary.json(), { data: result });
    const beforeInvalid = calls;
    const invalid = await post(JSON_STREAM_CONTENT_TYPE, { crops: [] });
    assert.equal(invalid.status, 400);
    assert.equal(calls, beforeInvalid);
    fail = true;
    const rejected = await post(JSON_STREAM_CONTENT_TYPE);
    const errorFrames = (await rejected.text())
      .trim()
      .split('\n')
      .map((line) => StructureDetectionStreamEventSchema.parse(JSON.parse(line) as unknown));
    assert.deepEqual(errorFrames.at(-1), {
      type: 'error',
      error: {
        code: failure.code,
        status: failure.status,
        message: failure.message,
        details: failure.details,
      },
    });
    assert.equal(
      errorFrames.some((frame) => frame.type === 'result'),
      false,
    );
    assert.equal(calls, 3);
  },
);
