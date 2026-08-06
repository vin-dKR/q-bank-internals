import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { createContainer } from './container.js';
import { createApp } from './app.js';

/** Process entry point (§1: apps have a main()). Build the container, build the app, listen. */
function main(): void {
  const container = createContainer();
  const app = createApp(container);

  app.listen(env.API_PORT, () => {
    logger.info(`Ingest API listening on http://localhost:${String(env.API_PORT)}/api`);
  });
}

main();
