import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { DocumentsService, type DocumentRepository } from './modules/documents/index.js';
import { ExtractionService, type ExtractionJobStore } from './modules/extraction/index.js';
import { DriveService } from './modules/drive/index.js';
import { IngestionService } from './modules/ingestion/index.js';
import { InMemoryDocumentRepository } from './infrastructure/database/repositories/document.in-memory-repository.js';
import { InMemoryExtractionJobStore } from './infrastructure/database/repositories/extraction-job.in-memory-store.js';
import { PrismaDocumentRepository } from './infrastructure/database/repositories/document.prisma-repository.js';
import { PrismaExtractionJobStore } from './infrastructure/database/repositories/extraction-job.prisma-store.js';
import { getPrisma } from './infrastructure/database/prisma.js';
import { GoogleDriveStorage } from './infrastructure/drive/google-drive.storage.js';
import { UnconfiguredDriveStorage } from './infrastructure/drive/unconfigured-drive.storage.js';
import { oauthDrive, serviceAccountDrive } from './infrastructure/drive/google-auth.js';

/**
 * The COMPOSITION ROOT (§5). The single file allowed to `new` infrastructure and decide which
 * adapter satisfies each port. Everything downstream receives interfaces and stays swappable.
 */
export type Container = {
  documentsService: DocumentsService;
  extractionService: ExtractionService;
  driveService: DriveService;
  ingestionService: IngestionService;
};

function buildDrive(): DriveService {
  // Preferred: OAuth "act as a real user" — the only auth that can upload files on a personal Gmail
  // account (a service account has no storage quota).
  if (
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REFRESH_TOKEN &&
    env.DRIVE_ROOT_FOLDER_ID
  ) {
    logger.info('Drive: OAuth user credentials');
    const drive = oauthDrive({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });
    return new DriveService(new GoogleDriveStorage(drive), env.DRIVE_ROOT_FOLDER_ID);
  }

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.DRIVE_ROOT_FOLDER_ID) {
    logger.info('Drive: Google service account (note: cannot upload files — no storage quota)');
    return new DriveService(
      new GoogleDriveStorage(serviceAccountDrive(env.GOOGLE_SERVICE_ACCOUNT_JSON)),
      env.DRIVE_ROOT_FOLDER_ID,
    );
  }

  logger.info('Drive: unconfigured. Set GOOGLE_OAUTH_* (recommended) or GOOGLE_SERVICE_ACCOUNT_JSON.');
  return new DriveService(new UnconfiguredDriveStorage(), '');
}

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
  const driveService = buildDrive();
  const ingestionService = new IngestionService(driveService);

  return { documentsService, extractionService, driveService, ingestionService };
}
