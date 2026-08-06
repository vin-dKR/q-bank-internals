import { createApp } from '../apps/api/src/app.js';
import { createContainer } from '../apps/api/src/container.js';

/**
 * Vercel serverless entry point for the API (the counterpart to `apps/api/src/main.ts`, which is the
 * long-running `app.listen` server used everywhere else). An Express app IS a `(req, res)` request
 * handler, so exporting it here is all Vercel needs — every request is routed to this function by the
 * catch-all rewrite in `vercel.json`, and Express does the internal routing on the original URL.
 *
 * The container is built once at module load and reused for the lifetime of a warm instance. There is
 * NO background worker here: on serverless the function is frozen the moment the response is sent, so
 * extraction runs synchronously inside the request (the composition root wires the synchronous queue
 * whenever `VERCEL`/`SERVERLESS` is set — see `container.ts` / `SynchronousJobQueue`).
 */
const app = createApp(createContainer());

export default app;
