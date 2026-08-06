import { createApp } from './app.js';
import { createContainer } from './container.js';

/**
 * Serverless entry (the counterpart to `main.ts`, which is the long-running `app.listen` server).
 * An Express app IS a `(req, res)` handler, so exporting it is all a serverless platform needs; the
 * catch-all rewrite in `vercel.json` routes every request here and Express does the internal routing.
 *
 * This file is bundled to plain JS (`api/index.js`) by the Vercel build (see the `build:vercel`
 * script) — deliberately, so the platform's function builder wraps compiled JavaScript instead of
 * type-checking the TypeScript source graph with its own (esModuleInterop-less) tsconfig.
 *
 * The container is built once per warm instance. There is NO background worker: on serverless the
 * function is frozen the moment the response is sent, so extraction runs synchronously inside the
 * request (the composition root wires the synchronous queue when `VERCEL`/`SERVERLESS` is set).
 */
const app = createApp(createContainer());

export default app;
