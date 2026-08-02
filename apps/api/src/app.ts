import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { errorHandler } from './shared/middleware/error-handler.js';
import { notFound } from './shared/middleware/not-found.js';
import { createApiRouter } from './routes.js';
import type { Container } from './container.js';

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
