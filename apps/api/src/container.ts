import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { DocumentsService, type DocumentRepository } from './modules/documents/index.js';
import { ExtractionService, type ExtractionJobStore } from './modules/extraction/index.js';
import { InMemoryDocumentRepository } from './infrastructure/database/repositories/document.in-memory-repository.js';
import { InMemoryExtractionJobStore } from './infrastructure/database/repositories/extraction-job.in-memory-store.js';
import { PrismaDocumentRepository } from './infrastructure/database/repositories/document.prisma-repository.js';
import { PrismaExtractionJobStore } from './infrastructure/database/repositories/extraction-job.prisma-store.js';
import { getPrisma } from './infrastructure/database/prisma.js';

/**
 * The COMPOSITION ROOT (§5). The single file allowed to `new` infrastructure and decide which
 * adapter satisfies each port. Everything downstream receives interfaces and stays swappable.
 */
export type Container = {
  documentsService: DocumentsService;
  extractionService: ExtractionService;
};

function buildPersistence(): { documents: DocumentRepository; jobs: ExtractionJobStore } {
  if (env.DB_DRIVER === 'mongo') {
    if (!env.DATABASE_URL) {
      throw new Error('DB_DRIVER=mongo requires DATABASE_URL. Run `npm run prisma:generate` too.');
    }
    const prisma = getPrisma();
    logger.info('Persistence: MongoDB (Prisma)');
    return { documents: new PrismaDocumentRepository(prisma), jobs: new PrismaExtractionJobStore(prisma) };
  }

  logger.info('Persistence: in-memory (dev). Set DB_DRIVER=mongo for durable storage.');
  return { documents: new InMemoryDocumentRepository(), jobs: new InMemoryExtractionJobStore() };
}

export function createContainer(): Container {
  const { documents, jobs } = buildPersistence();

  const documentsService = new DocumentsService(documents);
  const extractionService = new ExtractionService(documents, jobs, env.EXTRACTION_MODEL);

  return { documentsService, extractionService };
}
