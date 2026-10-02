import type { Request, Response } from 'express';
import { createApp } from '../src/app.js';
import { createContainer } from '../src/container.js';

/**
 * Vercel serverless entry (the counterpart to `src/main.ts`, the long-running `app.listen` server
 * used for local dev). The catch-all rewrite in `vercel.json` routes every request here and Express
 * does the internal routing on the original URL.
 *
 * The default export MUST be an inline function declaration, not `export default app`: Vercel's
 * launcher statically traces where the default export comes from, follows the identifier into the
 * imported `../src/app.js` (which has no default export), and crashes with "Invalid export found
 * in module .../src/app.js". An inline function gives it nothing to trace.
 *
 * The container is built once per warm instance. Extraction itself runs in the private Vercel Queue
 * consumer (`api/extraction-queue.ts`), so this HTTP handler only records and publishes a job.
 */
const app = createApp(createContainer());

export default function handler(req: Request, res: Response): void {
  app(req, res);
}
