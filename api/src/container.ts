import { env, isServerless } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { DocumentsService, type DocumentRepository } from './modules/documents/index.js';
import { SessionsService, type SessionRepository } from './modules/sessions/index.js';
import {
  ExtractionRunRegistry,
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
  type PaperMetadataExtractor,
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
import { ExamAccessService } from './modules/exam-access/index.js';
import { MastersService, TaxonomyResolver } from './modules/masters/index.js';
import { DriveService } from './modules/drive/index.js';
import { IngestionService, type UploadStagingStore } from './modules/ingestion/index.js';
import { PromptService, type PromptOverrideStore, type PromptOverrides } from './modules/prompts/index.js';
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
import { SupabaseUploadStagingStore } from './infrastructure/storage/supabase.upload-staging-store.js';
import { UnconfiguredUploadStagingStore } from './infrastructure/storage/unconfigured.upload-staging-store.js';
import { InMemoryPromptOverrideStore } from './infrastructure/database/repositories/prompt-override.in-memory-store.js';
import { PrismaPromptOverrideStore } from './infrastructure/database/repositories/prompt-override.prisma-store.js';
import { OpenAiLatexRefiner } from './infrastructure/ai/openai.latex-refiner.js';
import { UnconfiguredLatexRefiner } from './infrastructure/ai/unconfigured.latex-refiner.js';
import { OpenAiDiagramDetector } from './infrastructure/ai/openai.diagram-detector.js';
import { UnconfiguredDiagramDetector } from './infrastructure/ai/unconfigured.diagram-detector.js';
import { OpenAiQuestionReExtractor } from './infrastructure/ai/openai.question-reextractor.js';
import { UnconfiguredQuestionReExtractor } from './infrastructure/ai/unconfigured.question-reextractor.js';
import { OpenAiPaperMetadataExtractor } from './infrastructure/ai/openai.paper-metadata-extractor.js';
import { UnconfiguredPaperMetadataExtractor } from './infrastructure/ai/unconfigured.paper-metadata-extractor.js';
import { MongoBankPublisher } from './infrastructure/bank/mongo.bank-publisher.js';
import { UnconfiguredBankPublisher } from './infrastructure/bank/unconfigured.bank-publisher.js';
import { MongoBankQuestionStore } from './infrastructure/bank/mongo.bank-question-store.js';
import { UnconfiguredBankQuestionStore } from './infrastructure/bank/unconfigured.bank-question-store.js';
import { MongoCatalogStore } from './infrastructure/catalog/mongo.catalog-store.js';
import { UnconfiguredCatalogStore } from './infrastructure/catalog/unconfigured.catalog-store.js';
import { MongoExamAccessStore } from './infrastructure/exam-access/mongo.exam-access-store.js';
import { UnconfiguredExamAccessStore } from './infrastructure/exam-access/unconfigured.exam-access-store.js';
import { MongoTaxonomyStore } from './infrastructure/taxonomy/mongo.taxonomy-store.js';
import { UnconfiguredTaxonomyStore } from './infrastructure/taxonomy/unconfigured.taxonomy-store.js';

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
  examAccessService: ExamAccessService;
  mastersService: MastersService;
  extractionService: ExtractionService;
  extractionWorker: ExtractionWorker;
  jobQueue: JobQueue;
  driveService: DriveService;
  ingestionService: IngestionService;
  promptsService: PromptService;
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
  prompts: PromptOverrideStore;
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
      prompts: new PrismaPromptOverrideStore(prisma),
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
    prompts: new InMemoryPromptOverrideStore(),
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
function buildExtractor(loadPromptOverrides: () => Promise<PromptOverrides>): VisionExtractor {
  if (env.OPENAI_API_KEY) {
    logger.info(`Extractor: OpenAI ${env.EXTRACTION_MODEL}`);
    return new OpenAiVisionExtractor(env.OPENAI_API_KEY, env.EXTRACTION_MODEL, loadPromptOverrides);
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

/** Supabase-backed staging for direct-to-storage PDF uploads; a null-object that fails loudly otherwise. */
function buildUploadStaging(): UploadStagingStore {
  if (env.SUPABASE_SERVICE_KEY) {
    return new SupabaseUploadStagingStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, env.SUPABASE_BUCKET);
  }
  logger.info('Uploads: unconfigured. Set SUPABASE_SERVICE_KEY to accept chapter PDF uploads.');
  return new UnconfiguredUploadStagingStore();
}

/** OpenAI-backed "Fix LaTeX" refiner when a key is present; otherwise a null-object. */
function buildLatexRefiner(loadPromptOverrides: () => Promise<PromptOverrides>): LatexRefiner {
  if (env.OPENAI_API_KEY) {
    return new OpenAiLatexRefiner(env.OPENAI_API_KEY, env.LATEX_MODEL, loadPromptOverrides);
  }
  return new UnconfiguredLatexRefiner();
}

/** OpenAI vision detector for the Verify auto-crop when a key is present; otherwise a null-object. */
function buildDiagramDetector(loadPromptOverrides: () => Promise<PromptOverrides>): DiagramDetector {
  if (env.OPENAI_API_KEY) {
    logger.info(`Detector: OpenAI ${env.DETECTION_MODEL}`);
    return new OpenAiDiagramDetector(
      env.OPENAI_API_KEY,
      env.DETECTION_MODEL,
      env.DETECTION_MAX_TOKENS,
      loadPromptOverrides,
    );
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

/** OpenAI vision reader for the cut-upload "AI-fill paper details" button; otherwise a null-object. */
function buildPaperMetadataExtractor(): PaperMetadataExtractor {
  if (env.OPENAI_API_KEY) {
    logger.info(`Paper-metadata reader: OpenAI ${env.EXTRACTION_MODEL}`);
    return new OpenAiPaperMetadataExtractor(env.OPENAI_API_KEY, env.EXTRACTION_MODEL);
  }
  logger.info('Paper-metadata reader: unconfigured. Set OPENAI_API_KEY to AI-fill paper details.');
  return new UnconfiguredPaperMetadataExtractor();
}

export function createContainer(): Container {
  const { documents, sessions, jobs, questions, usage, limits, prompts } = buildPersistence();
  const promptsService = new PromptService(prompts);
  // The prompt builders read edits through this; the service caches it briefly so a multi-page run
  // isn't a DB read per page.
  const loadPromptOverrides = (): Promise<PromptOverrides> => promptsService.overrides();
  const jobQueue = buildQueue();
  const rasterizer: PdfRasterizer = new PdfToImgRasterizer();
  const extractor = buildExtractor(loadPromptOverrides);
  const driveService = buildDrive();

  // The age past which a stuck `queued`/`extracting` document is auto-reset on read. Floored to always
  // exceed the run budget (+1min) so the self-heal can never kill a genuinely in-flight extraction.
  const staleExtractionMs = Math.max(env.STALE_EXTRACTION_MS, env.EXTRACTION_TIMEOUT_MS + 60_000);

  const usageService = new UsageService(usage, limits, sessions, documents);
  const documentsService = new DocumentsService(documents, sessions, staleExtractionMs);
  const sessionsService = new SessionsService(sessions, documents, staleExtractionMs);
  const pagesService = new PagesService(documents, driveService, rasterizer);
  // Built before the questions service: deleting a verified question also drops its published bank
  // copy, so the questions service holds this store (and is the read/fix side's dependency too).
  const bankQuestionStore =
    env.DB_DRIVER === 'mongo'
      ? new MongoBankQuestionStore(getPrisma())
      : new UnconfiguredBankQuestionStore();
  const questionsService = new QuestionsService(
    questions,
    documents,
    bankQuestionStore,
    buildImageStore(),
    buildLatexRefiner(loadPromptOverrides),
    usageService,
    buildDiagramDetector(loadPromptOverrides),
    pagesService,
    buildQuestionReExtractor(),
    buildPaperMetadataExtractor(),
  );
  // The taxonomy dictionaries back both Masters CRUD and the publish-time FK resolver, so build the
  // one store here and share it.
  const taxonomyStore =
    env.DB_DRIVER === 'mongo'
      ? new MongoTaxonomyStore(getPrisma())
      : new UnconfiguredTaxonomyStore();
  const taxonomyResolver = new TaxonomyResolver(taxonomyStore);
  const bankPublisher =
    env.DB_DRIVER === 'mongo'
      ? new MongoBankPublisher(getPrisma())
      : new UnconfiguredBankPublisher();
  const publishService = new PublishService(documents, questions, bankPublisher, taxonomyResolver);
  const bankService = new BankService(bankQuestionStore);
  const catalogStore =
    env.DB_DRIVER === 'mongo'
      ? new MongoCatalogStore(getPrisma())
      : new UnconfiguredCatalogStore();
  const catalogService = new CatalogService(catalogStore);
  const examAccessStore =
    env.DB_DRIVER === 'mongo'
      ? new MongoExamAccessStore(getPrisma())
      : new UnconfiguredExamAccessStore();
  const examAccessService = new ExamAccessService(examAccessStore);
  const mastersService = new MastersService(taxonomyStore);
  // Shared in-process registry so the cancel action and the worker's deadline signal the same run.
  const runRegistry = new ExtractionRunRegistry();
  const extractionService = new ExtractionService(
    documents,
    jobs,
    jobQueue,
    usageService,
    env.EXTRACTION_MODEL,
    runRegistry,
  );
  const extractionWorker = new ExtractionWorker(
    documents,
    questions,
    jobs,
    driveService,
    rasterizer,
    extractor,
    usageService,
    runRegistry,
    env.EXTRACTION_TIMEOUT_MS,
  );
  const ingestionService = new IngestionService(
    driveService,
    documents,
    sessionsService,
    extractionService,
    buildUploadStaging(),
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
    examAccessService,
    mastersService,
    extractionService,
    extractionWorker,
    jobQueue,
    driveService,
    ingestionService,
    promptsService,
  };
}
