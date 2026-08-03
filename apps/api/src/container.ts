import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { DocumentsService, type DocumentRepository } from './modules/documents/index.js';
import { SessionsService, type SessionRepository } from './modules/sessions/index.js';
import {
  ExtractionService,
  ExtractionWorker,
  type ExtractionJobStore,
  type JobQueue,
  type PdfRasterizer,
  type VisionExtractor,
} from './modules/extraction/index.js';
import type { QuestionRepository } from './modules/questions/index.js';
import { DriveService } from './modules/drive/index.js';
import { IngestionService } from './modules/ingestion/index.js';
import { InMemoryDocumentRepository } from './infrastructure/database/repositories/document.in-memory-repository.js';
import { InMemorySessionRepository } from './infrastructure/database/repositories/session.in-memory-repository.js';
import { InMemoryExtractionJobStore } from './infrastructure/database/repositories/extraction-job.in-memory-store.js';
import { InMemoryQuestionRepository } from './infrastructure/database/repositories/question.in-memory-repository.js';
import { PrismaDocumentRepository } from './infrastructure/database/repositories/document.prisma-repository.js';
import { PrismaSessionRepository } from './infrastructure/database/repositories/session.prisma-repository.js';
import { PrismaExtractionJobStore } from './infrastructure/database/repositories/extraction-job.prisma-store.js';
import { PrismaQuestionRepository } from './infrastructure/database/repositories/question.prisma-repository.js';
import { getPrisma } from './infrastructure/database/prisma.js';
import { GoogleDriveStorage } from './infrastructure/drive/google-drive.storage.js';
import { UnconfiguredDriveStorage } from './infrastructure/drive/unconfigured-drive.storage.js';
import { oauthDrive, serviceAccountDrive } from './infrastructure/drive/google-auth.js';
import { InProcessJobQueue } from './infrastructure/queue/in-process.job-queue.js';
import { BullMqJobQueue } from './infrastructure/queue/bullmq.job-queue.js';
import { PdfToImgRasterizer } from './infrastructure/pdf/pdf-to-img.rasterizer.js';
import { OpenAiVisionExtractor } from './infrastructure/ai/openai.vision-extractor.js';
import { UnconfiguredVisionExtractor } from './infrastructure/ai/unconfigured.vision-extractor.js';

/**
 * The COMPOSITION ROOT (§5). The single file allowed to `new` infrastructure and decide which
 * adapter satisfies each port. Everything downstream receives interfaces and stays swappable.
 */
export type Container = {
  documentsService: DocumentsService;
  sessionsService: SessionsService;
  extractionService: ExtractionService;
  extractionWorker: ExtractionWorker;
  jobQueue: JobQueue;
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

function buildPersistence(): {
  documents: DocumentRepository;
  sessions: SessionRepository;
  jobs: ExtractionJobStore;
  questions: QuestionRepository;
} {
  if (env.DB_DRIVER === 'mongo') {
    if (!env.DATABASE_URL) {
      throw new Error('DB_DRIVER=mongo requires DATABASE_URL. Run `npm run prisma:generate` too.');
    }
    const prisma = getPrisma();
    logger.info('Persistence: MongoDB (Prisma)');
    return {
      documents: new PrismaDocumentRepository(prisma),
      sessions: new PrismaSessionRepository(prisma),
      jobs: new PrismaExtractionJobStore(prisma),
      questions: new PrismaQuestionRepository(prisma),
    };
  }

  logger.info('Persistence: in-memory (dev). Set DB_DRIVER=mongo for durable storage.');
  return {
    documents: new InMemoryDocumentRepository(),
    sessions: new InMemorySessionRepository(),
    jobs: new InMemoryExtractionJobStore(),
    questions: new InMemoryQuestionRepository(),
  };
}

/** BullMQ when Redis is configured; otherwise an in-process queue so dev boots with no Redis. */
function buildQueue(): JobQueue {
  if (env.REDIS_URL) {
    logger.info('Queue: BullMQ (Redis)');
    return new BullMqJobQueue(env.REDIS_URL);
  }
  logger.info('Queue: in-process (dev). Set REDIS_URL for a durable BullMQ worker.');
  return new InProcessJobQueue();
}

/** OpenAI gpt-4o when a key is present; otherwise a null-object that fails extraction loudly. */
function buildExtractor(): VisionExtractor {
  if (env.OPENAI_API_KEY) {
    logger.info(`Extractor: OpenAI ${env.EXTRACTION_MODEL}`);
    return new OpenAiVisionExtractor(env.OPENAI_API_KEY, env.EXTRACTION_MODEL);
  }
  logger.info('Extractor: unconfigured. Set OPENAI_API_KEY to run extraction.');
  return new UnconfiguredVisionExtractor();
}

export function createContainer(): Container {
  const { documents, sessions, jobs, questions } = buildPersistence();
  const jobQueue = buildQueue();
  const rasterizer: PdfRasterizer = new PdfToImgRasterizer();
  const extractor = buildExtractor();
  const driveService = buildDrive();

  const documentsService = new DocumentsService(documents);
  const sessionsService = new SessionsService(sessions, documents);
  const extractionService = new ExtractionService(documents, jobs, jobQueue, env.EXTRACTION_MODEL);
  const extractionWorker = new ExtractionWorker(
    documents,
    questions,
    jobs,
    driveService,
    rasterizer,
    extractor,
  );
  const ingestionService = new IngestionService(
    driveService,
    documents,
    sessionsService,
    extractionService,
  );

  // In-process queue (dev): the API also consumes, so extraction runs without a separate worker.
  // BullMQ: the API only enqueues; the dedicated `worker.ts` process registers the consumer instead.
  if (!env.REDIS_URL) {
    jobQueue.process((payload) => extractionWorker.run(payload));
  }

  return {
    documentsService,
    sessionsService,
    extractionService,
    extractionWorker,
    jobQueue,
    driveService,
    ingestionService,
  };
}
