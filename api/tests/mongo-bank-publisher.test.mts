import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { MongoBankPublisher } from '../src/infrastructure/bank/mongo.bank-publisher.js';

type BankRow = Record<string, unknown> & { ingest_ref: { question_id: string; document_id?: string } };
type BankCommand = {
  find?: string;
  filter?: { 'ingest_ref.question_id': { $in: string[] } };
  updates?: Array<{ q: Record<string, unknown>; u: Record<string, unknown>; upsert: boolean }>;
};

function fixture(existing: BankRow[], writeReply?: unknown) {
  const commands: BankCommand[] = [];
  const prisma = { async $runCommandRaw(command: BankCommand) {
    commands.push(command);
    if (command.find) {
      const ids = command.filter?.['ingest_ref.question_id'].$in;
      assert.ok(ids);
      return { cursor: { firstBatch: existing.filter((row) => ids.includes(row.ingest_ref.question_id)) } };
    }
    assert.ok(command.updates);
    return writeReply ?? { n: command.updates.length };
  } } as unknown as PrismaClient;
  return { publisher: new MongoBankPublisher(prisma), commands };
}
const question = (id: string, answer = 'A') => ({
  ingest_ref: { question_id: id, document_id: 'document' },
  question_text: 'Choose an answer', answer,
});

void test('first publication inserts questions using their stable ingest IDs', async () => {
  const { publisher, commands } = fixture([]);
  assert.equal(await publisher.upsertQuestions([question('q1')]), 1);
  assert.deepEqual(commands[1]?.updates, [{
    q: { 'ingest_ref.question_id': 'q1' }, u: { $set: question('q1') }, upsert: true,
  }]);
});

void test('updates only changed questions and fields, preserving bank-only data', async () => {
  const { publisher, commands } = fixture([
    { ...question('q1'), _id: { $oid: 'bank1' }, review_notes: 'Keep this' }, question('q2'),
  ]);
  assert.equal(await publisher.upsertQuestions([question('q1', 'B'), question('q2')]), 1);
  assert.deepEqual(commands[1]?.updates, [{
    q: { 'ingest_ref.question_id': 'q1' }, u: { $set: { answer: 'B' } }, upsert: false,
  }]);
});

void test('unchanged documents issue no bank writes, including EJSON numbers and reordered keys', async () => {
  const next = { ...question('q1'), question_number: 1, subjectId: '0123456789abcdef01234567' };
  const { publisher, commands } = fixture([{
    ...next, question_number: { $numberInt: '1' }, subjectId: { $oid: next.subjectId },
    ingest_ref: { document_id: 'document', question_id: 'q1' },
  }]);
  assert.equal(await publisher.upsertQuestions([next]), 0);
  assert.equal(commands.length, 1);
});

void test('human edits clear old AI provenance', async () => {
  const { publisher, commands } = fixture([{ ...question('q1'), ai_filled: { answer: true } }]);
  assert.equal(await publisher.upsertQuestions([question('q1')]), 1);
  assert.deepEqual(commands[1]?.updates?.[0]?.u, { $unset: { ai_filled: '' } });
});

void test('new questions in a published document are inserted alongside changed questions', async () => {
  const { publisher, commands } = fixture([question('q1')]);
  assert.equal(await publisher.upsertQuestions([question('q1'), question('q2')]), 1);
  assert.equal(commands[1]?.updates?.[0]?.q['ingest_ref.question_id'], 'q2');
});

void test('all read batches are checked before deciding which questions changed', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => question(`q${String(index)}`));
  const { publisher, commands } = fixture(rows);
  assert.equal(await publisher.upsertQuestions(rows), 0);
  assert.equal(commands.length, 3);
});

void test('partial or failed bank writes are reported as errors', async () => {
  for (const reply of [{ n: 0 }, { n: 1, writeErrors: [{ index: 0, errmsg: 'failed' }] },
    { n: 1, writeConcernError: { errmsg: 'unconfirmed' } }]) {
    const { publisher } = fixture([], reply);
    await assert.rejects(publisher.upsertQuestions([question('q1')]));
  }
});

void test('malformed bank reads fail instead of treating existing rows as new', async () => {
  const prisma = { $runCommandRaw: async () => ({ ok: 0 }) } as unknown as PrismaClient;
  await assert.rejects(new MongoBankPublisher(prisma).upsertQuestions([question('q1')]));
});
