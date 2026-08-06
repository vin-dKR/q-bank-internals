import { createApp } from '../src/app.js';
import { createContainer } from '../src/container.js';

/**
 * Vercel serverless entry (the counterpart to `src/main.ts`, the long-running `app.listen` server
 * used for local dev). An Express app IS a `(req, res)` handler, so exporting it is all Vercel needs;
 * the catch-all rewrite in `vercel.json` routes every request here and Express does the internal
 * routing on the original URL.
 *
 * The container is built once per warm instance. There is NO background worker: on serverless the
 * function is frozen the moment the response is sent, so extraction runs synchronously inside the
 * request (the composition root wires the synchronous queue when `VERCEL`/`SERVERLESS` is set).
 */
const app = createApp(createContainer());

export default app;
