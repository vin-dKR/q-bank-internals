import cors from 'cors';
import express, { type Express } from 'express';
import * as helmetModule from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { errorHandler } from './shared/middleware/error-handler.js';
import { notFound } from './shared/middleware/not-found.js';
import { createApiRouter } from './routes.js';
import type { Container } from './container.js';

/**
 * helmet ships CommonJS with a `default` export. Vercel's function builder (@vercel/node) type-checks
 * this file with a tsconfig that lacks `esModuleInterop`, under which `import helmet from 'helmet'`
 * resolves to a non-callable namespace and `helmet()` fails to compile (TS2349). Resolve the callable
 * middleware factory in an interop-independent way — a namespace import plus a runtime `.default`
 * fallback — so it compiles under both that config and this app's own strict/verbatim config, and
 * runs correctly whether the module is loaded as ESM or CJS.
 */
type HelmetFactory = (typeof import('helmet'))['default'];
const helmet: HelmetFactory =
  (helmetModule as { default?: HelmetFactory }).default ?? (helmetModule as unknown as HelmetFactory);

/**
 * Assembles the Express app: cross-cutting middleware, the API router, then the 404 and error
 * sinks LAST (§7). Pure assembly — no route logic lives here.
 */
export function createApp(container: Container): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger }));

  app.use('/api', createApiRouter(container));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
