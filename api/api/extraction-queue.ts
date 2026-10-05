import type { Request, Response } from 'express';
import { QueueClient } from '@vercel/queue';
import { createContainer } from '../src/container.js';
import type { ExtractionJobPayload } from '../src/modules/extraction/index.js';

// This function is private: Vercel's queue trigger is its only caller. A warm consumer retains one
// container, while the durable job/document checkpoints make cold starts and redeliveries harmless.
const container = createContainer();
const queue = new QueueClient();
const callback = queue.handleNodeCallback<ExtractionJobPayload>(async (payload) => {
  await container.extractionWorker.run(payload);
}, { visibilityTimeoutSeconds: 300 });

export default async function handler(req: Request, res: Response): Promise<void> {
  await callback(req, res);
}
