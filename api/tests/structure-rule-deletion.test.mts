import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import {
  structureHierarchy,
  structureRuleScopeKey,
  type SaveStructureRule,
} from '@ingest/contracts';
import {
  StructureRulesService,
  createStructureRulesRouter,
} from '../src/modules/structure-rules/index.js';
import { InMemoryStructureRuleStore } from '../src/infrastructure/database/repositories/structure-rule.in-memory-store.js';
import { MongoStructureRuleStore } from '../src/infrastructure/database/repositories/structure-rule.mongo-store.js';
import { errorHandler } from '../src/shared/middleware/error-handler.js';

const input: SaveStructureRule = {
  source: 'module',
  provider: 'Allen',
  examples: { section: 'Exercise-1', part: 'PART I', topic: 'Topic: Polymers' },
  notes: 'Read printed headings only.',
  hierarchy: [
    ...structureHierarchy().slice(0, 2),
    { id: 'subpart', name: 'Subpart', example: 'Subpart A', expectedOutput: 'A' },
    ...structureHierarchy().slice(2),
  ],
};

void test('deleting a whole rule set removes only that source/provider and restores default levels', async () => {
  const service = new StructureRulesService(new InMemoryStructureRuleStore());
  await service.save(input);
  await service.save({ ...input, source: 'textbook' });
  await service.save({ ...input, provider: 'PW' });
  assert.deepEqual(await service.remove({ source: 'module', provider: ' ALLEN ' }), { ok: true });
  const deleted = await service.resolve({ source: 'module', provider: 'Allen' });
  assert.equal(deleted, null);
  assert.deepEqual(
    structureHierarchy(deleted).map((level) => level.id),
    ['section', 'part', 'topic'],
  );
  assert.ok(await service.resolve({ source: 'textbook', provider: 'Allen' }));
  assert.ok(await service.resolve({ source: 'module', provider: 'PW' }));
  assert.equal((await service.list()).length, 2);
  assert.deepEqual(await service.remove({ source: 'module', provider: 'Allen' }), { ok: true });
  await assert.rejects(service.remove({ source: 'module', provider: '' }), /validation/);
  assert.equal((await service.list()).length, 2);
});

void test('Mongo deletion uses the normalized scoped id and a single-row limit', async () => {
  let command: unknown;
  // This adapter test exercises only the Prisma Mongo command method.
  const store = new MongoStructureRuleStore({
    $runCommandRaw: async (value: unknown) => {
      command = value;
      return { ok: { $numberInt: '1' }, n: { $numberInt: '0' } };
    },
  } as never);
  const scope = { source: 'module' as const, provider: ' ALLEN ' };
  await store.remove(scope);
  assert.deepEqual(command, {
    delete: 'ingest_structure_rules',
    deletes: [{ q: { _id: structureRuleScopeKey(scope) }, limit: 1 }],
    ordered: true,
  });
});

void test('Mongo write failures do not acknowledge a deleted rule set', async () => {
  for (const reply of [
    { ok: 0 },
    { ok: 1, writeErrors: [{ errmsg: 'Delete rejected' }] },
    { ok: 1, writeConcernError: { errmsg: 'Delete unconfirmed' } },
    {},
  ]) {
    // The mocked command response covers each Mongo write-failure shape.
    const store = new MongoStructureRuleStore({ $runCommandRaw: async () => reply } as never);
    await assert.rejects(
      store.remove({ source: 'module', provider: 'Allen' }),
      /Could not delete structure rules/,
    );
  }
});

void test('DELETE endpoint validates scope, returns the shared acknowledgement and preserves other sources', async (t) => {
  const service = new StructureRulesService(new InMemoryStructureRuleStore());
  await service.save(input);
  await service.save({ ...input, source: 'textbook' });
  const app = express();
  app.use('/structure-rules', createStructureRulesRouter(service));
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
  const url = `http://127.0.0.1:${String(address.port)}/structure-rules`;
  const invalid = await fetch(`${url}?source=module`, { method: 'DELETE' });
  assert.equal(invalid.status, 400);
  assert.ok(await service.resolve({ source: 'module', provider: 'Allen' }));
  const response = await fetch(`${url}?source=module&provider=Allen`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.deepEqual(body, { data: { ok: true } });
  assert.equal(await service.resolve({ source: 'module', provider: 'Allen' }), null);
  assert.ok(await service.resolve({ source: 'textbook', provider: 'Allen' }));
});
