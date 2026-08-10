import { env, isServerless } from './config/index.js';
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
import {
  QuestionsService,
  type DiagramDetector,
  type ImageStore,
  type LatexRefiner,
  type QuestionReExtractor,
  type QuestionRepository,
} from './modules/questions/index.js';
import {
  UsageService,
  type TokenLimitStore,
  type UsageRepository,
} from './modules/usage/index.js';
import { PagesService } from './modules/pages/index.js';
import { PublishService } from './modules/publish/index.js';
import { BankService } from './modules/bank/index.js';
import { CatalogService } from './modules/catalog/index.js';
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
import { InMemoryUsageRepository } from './infrastructure/database/repositories/token-usage.in-memory-repository.js';
import { InMemoryTokenLimitStore } from './infrastructure/database/repositories/token-limit.in-memory-store.js';
import { PrismaUsageRepository } from './infrastructure/database/repositories/token-usage.prisma-repository.js';
import { PrismaTokenLimitStore } from './infrastructure/database/repositories/token-limit.prisma-store.js';
import { getPrisma } from './infrastructure/database/prisma.js';
import { GoogleDriveStorage } from './infrastructure/drive/google-drive.storage.js';
import { UnconfiguredDriveStorage } from './infrastructure/drive/unconfigured-drive.storage.js';
import { oauthDrive, serviceAccountDrive } from './infrastructure/drive/google-auth.js';
import { InProcessJobQueue } from './infrastructure/queue/in-process.job-queue.js';
import { SynchronousJobQueue } from './infrastructure/queue/synchronous.job-queue.js';
import { BullMqJobQueue } from './infrastructure/queue/bullmq.job-queue.js';
import { PdfToImgRasterizer } from './infrastructure/pdf/pdf-to-img.rasterizer.js';
import { OpenAiVisionExtractor } from './infrastructure/ai/openai.vision-extractor.js';
import { UnconfiguredVisionExtractor } from './infrastructure/ai/unconfigured.vision-extractor.js';
import { SupabaseImageStore } from './infrastructure/storage/supabase.image-store.js';
import { UnconfiguredImageStore } from './infrastructure/storage/unconfigured.image-store.js';
import { OpenAiLatexRefiner } from './infrastructure/ai/openai.latex-refiner.js';
import { UnconfiguredLatexRefiner } from './infrastructure/ai/unconfigured.latex-refiner.js';
import { OpenAiDiagramDetector } from './infrastructure/ai/openai.diagram-detector.js';
import { UnconfiguredDiagramDetector } from './infrastructure/ai/unconfigured.diagram-detector.js';
import { OpenAiQuestionReExtractor } from './infrastructure/ai/openai.question-reextractor.js';
import { UnconfiguredQuestionReExtractor } from './infrastructure/ai/unconfigured.question-reextractor.js';
import { MongoBankPublisher } from './infrastructure/bank/mongo.bank-publisher.js';
import { UnconfiguredBankPublisher } from './infrastructure/bank/unconfigured.bank-publisher.js';
import { MongoBankQuestionStore } from './infrastructure/bank/mongo.bank-question-store.js';
import { UnconfiguredBankQuestionStore } from './infrastructure/bank/unconfigured.bank-question-store.js';
import { MongoCatalogStore } from './infrastructure/catalog/mongo.catalog-store.js';
import { UnconfiguredCatalogStore } from './infrastructure/catalog/unconfigured.catalog-store.js';

/**
 * The COMPOSITION ROOT (§5). The single file allowed to `new` infrastructure and decide which
 * adapter satisfies each port. Everything downstream receives interfaces and stays swappable.
 */
export type Container = {
  documentsService: DocumentsService;
  sessionsService: SessionsService;
  questionsService: QuestionsService;
  usageService: UsageService;
  pagesService: PagesService;
  publishService: PublishService;
  bankService: BankService;
  catalogService: CatalogService;
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
  usage: UsageRepository;
  limits: TokenLimitStore;
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
      usage: new PrismaUsageRepository(prisma),
      limits: new PrismaTokenLimitStore(prisma),
    };
  }

  logger.info('Persistence: in-memory (dev). Set DB_DRIVER=mongo for durable storage.');
  return {
    documents: new InMemoryDocumentRepository(),
    sessions: new InMemorySessionRepository(),
    jobs: new InMemoryExtractionJobStore(),
    questions: new InMemoryQuestionRepository(),
    usage: new InMemoryUsageRepository(),
    limits: new InMemoryTokenLimitStore(),
  };
}

/**
 * Queue selection: BullMQ when Redis is configured (durable, drained by the standalone worker);
 * a synchronous in-request queue on serverless (Vercel freezes the function after the response, so
 * detached work would be killed); otherwise the detached in-process queue so dev boots with no Redis.
 */
function buildQueue(): JobQueue {
  if (env.REDIS_URL) {
    logger.info('Queue: BullMQ (Redis)');
    return new BullMqJobQueue(env.REDIS_URL);
  }
  if (isServerless) {
    logger.info('Queue: synchronous in-request (serverless). Extraction runs inline; no background worker.');
    return new SynchronousJobQueue();
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

/** Supabase image storage when a service key is present; otherwise a null-object that fails loudly. */
function buildImageStore(): ImageStore {
  if (env.SUPABASE_SERVICE_KEY) {
    logger.info(`Images: Supabase bucket "${env.SUPABASE_BUCKET}"`);
    return new SupabaseImageStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, env.SUPABASE_BUCKET);
  }
  logger.info('Images: unconfigured. Set SUPABASE_SERVICE_KEY to upload crops.');
  return new UnconfiguredImageStore();
}

/** OpenAI-backed "Fix LaTeX" refiner when a key is present; otherwise a null-object. */
function buildLatexRefiner(): LatexRefiner {
  if (env.OPENAI_API_KEY) return new OpenAiLatexRefiner(env.OPENAI_API_KEY);
  return new UnconfiguredLatexRefiner();
}

/** OpenAI vision detector for the Verify auto-crop when a key is present; otherwise a null-object. */
function buildDiagramDetector(): DiagramDetector {
  if (env.OPENAI_API_KEY) {
    logger.info(`Detector: OpenAI ${env.DETECTION_MODEL}`);
    return new OpenAiDiagramDetector(env.OPENAI_API_KEY, env.DETECTION_MODEL, env.DETECTION_MAX_TOKENS);
  }
  logger.info('Detector: unconfigured. Set OPENAI_API_KEY to auto-detect figures.');
  return new UnconfiguredDiagramDetector();
}

/** OpenAI vision re-extractor for the Verify "read the page again" button; otherwise a null-object. */
function buildQuestionReExtractor(): QuestionReExtractor {
  if (env.OPENAI_API_KEY) {
    logger.info(`Re-extractor: OpenAI ${env.EXTRACTION_MODEL}`);
    return new OpenAiQuestionReExtractor(env.OPENAI_API_KEY, env.EXTRACTION_MODEL);
  }
  logger.info('Re-extractor: unconfigured. Set OPENAI_API_KEY to re-extract questions.');
  return new UnconfiguredQuestionReExtractor();
}

export function createContainer(): Container {
  const { documents, sessions, jobs, questions, usage, limits } = buildPersistence();
  const jobQueue = buildQueue();
  const rasterizer: PdfRasterizer = new PdfToImgRasterizer();
  const extractor = buildExtractor();
  const driveService = buildDrive();

  const usageService = new UsageService(usage, limits, sessions, documents);
  const documentsService = new DocumentsService(documents, questions, jobs);
  const sessionsService = new SessionsService(sessions, documents, questions, jobs);
  const pagesService = new PagesService(documents, driveService, rasterizer);
  const questionsService = new QuestionsService(
    questions,
    buildImageStore(),
    buildLatexRefiner(),
    usageService,
    buildDiagramDetector(),
    pagesService,
    buildQuestionReExtractor(),
  );
  const bankPublisher =
    env.DB_DRIVER === 'mongo'
      ? new MongoBankPublisher(getPrisma())
      : new UnconfiguredBankPublisher();
  const publishService = new PublishService(documents, questions, sessions, bankPublisher);
  const bankQuestionStore =
    env.DB_DRIVER === 'mongo'
      ? new MongoBankQuestionStore(getPrisma())
      : new UnconfiguredBankQuestionStore();
  const bankService = new BankService(bankQuestionStore);
  const catalogStore =
    env.DB_DRIVER === 'mongo'
      ? new MongoCatalogStore(getPrisma())
      : new UnconfiguredCatalogStore();
  const catalogService = new CatalogService(catalogStore);
  const extractionService = new ExtractionService(
    documents,
    jobs,
    jobQueue,
    usageService,
    env.EXTRACTION_MODEL,
  );
  const extractionWorker = new ExtractionWorker(
    documents,
    questions,
    jobs,
    driveService,
    rasterizer,
    extractor,
    usageService,
  );
  const ingestionService = new IngestionService(
    driveService,
    documents,
    sessionsService,
    extractionService,
  );

  // In-process/synchronous queue: the API also consumes, so extraction runs without a separate
  // worker. BullMQ: the API only enqueues; the dedicated `worker.ts` process registers the consumer.
  if (!env.REDIS_URL) {
    jobQueue.process((payload) => extractionWorker.run(payload));
    // Recover stale in-flight docs from a previous crash — but ONLY off serverless. On serverless
    // many function instances run concurrently, so a cold-start reset here would flip a document
    // that a sibling invocation is actively extracting to `failed`. The synchronous queue also
    // never leaves work orphaned across requests, so there is nothing to recover.
    if (!isServerless) {
      void documents.resetInFlight().then((count) => {
        if (count > 0) logger.info(`Recovered ${String(count)} stale extraction(s) → failed`);
      });
    }
  }

  return {
    documentsService,
    sessionsService,
    questionsService,
    usageService,
    pagesService,
    publishService,
    bankService,
    catalogService,
    extractionService,
    extractionWorker,
    jobQueue,
    driveService,
    ingestionService,
  };
}
