import type {
  ChapterPath,
  ChapterUploadMetadata,
  Document,
  DriveFile,
  SignedUploadTarget,
  DetectStructureRequest,
  DetectStructureResult,
  StructureDetectionUsage,
  StructureEstimate,
  StructureEstimateRequest,
  StructureCropOcrRequest,
  StructureCropOcrResult,
} from '@ingest/contracts';
import { DetectedStructureSchema } from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { DriveService } from '../drive/index.js';
import type { CreateDocumentInput, DocumentRepository } from '../documents/index.js';
import type { SessionsService } from '../sessions/index.js';
import type { ExtractionService } from '../extraction/index.js';
import type { UploadStagingStore } from './upload-staging.store.js';
import type { StructureExtractor } from './structure-extractor.js';
import type { UsageService } from '../usage/index.js';
import { validateStructure } from './validate-structure.js';
import type { StructureRuleResolver } from '../structure-rules/index.js';
import type { PageOcr, PageOcrSession } from './page-ocr.js';
import { reusableStructureCrop, structureCropContextKey } from './structure-text-batches.js';

/** What an upload produces: the Drive file that was filed, plus the durable Document row it created. */
export type UploadChapterResult = { document: Document; driveFile: DriveFile };

/**
 * Orchestrates filing a cut chapter PDF into Drive AND recording it as a durable, session-scoped
 * Document — the breakable checkpoint that lets Phase 1 finish without waiting on Phase 2. It
 * ensures the nested exam → subject → module → chapter folder path exists, uploads the bytes, then
 * persists a Document (status `uploaded`) under the session so extraction can pick it up later.
 * When the session is in auto-run mode, it also enqueues extraction immediately (pipeline mode).
 */
export class IngestionService {
  constructor(
    private readonly driveService: DriveService,
    private readonly documents: DocumentRepository,
    private readonly sessions: SessionsService,
    private readonly extraction: ExtractionService,
    private readonly staging: UploadStagingStore,
    private readonly structureExtractor: StructureExtractor,
    private readonly usage: UsageService,
    private readonly structureRules: StructureRuleResolver,
    private readonly cropOcr: PageOcr,
    private readonly minimumOcrConfidence: number,
  ) {}

  async estimateStructure(input: StructureEstimateRequest): Promise<StructureEstimate> {
    const rule = await this.structureRules.resolveContext(input.context);
    return this.structureExtractor.estimate({ ...input, rule });
  }

  /** OCR runs separately so its text can be corrected and saved before any paid AI call. */
  async readStructureCrop(input: StructureCropOcrRequest): Promise<StructureCropOcrResult> {
    let session: PageOcrSession | null = null;
    try {
      const png = await this.staging.download(input.storagePath);
      if (
        png.length < 24 ||
        png.length > 10 * 1024 * 1024 ||
        png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        png.subarray(12, 16).toString() !== 'IHDR'
      )
        throw errors.structureDetectionFailed('Upload a PNG crop smaller than 10 MB.');
      if (png.readUInt32BE(16) * png.readUInt32BE(20) > 20_000_000)
        throw errors.structureDetectionFailed(
          'The crop image is too large. Select a smaller heading region.',
        );
      session = await this.cropOcr.open();
      const lines = (await session.recognize(png)).sort(
        (a, b) => a.box.top - b.box.top || a.box.left - b.box.left,
      );
      const text = lines
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join('\n');
      if (text.length > 12000)
        throw errors.structureDetectionFailed(
          'This crop contains too much text. Select only the heading region.',
        );
      const confidence = lines
        .filter((line) => line.text.trim() && Number.isFinite(line.confidence))
        .map((line) => line.confidence);
      const warnings = [...new Set(lines.flatMap((line) => line.warnings ?? []))];
      if (!text)
        warnings.push(
          'No text was recognized. Adjust the crop or enter the printed text manually.',
        );
      if (confidence.some((value) => value < this.minimumOcrConfidence))
        warnings.push(
          'Some OCR lines have low confidence. Check the crop and correct the text before saving.',
        );
      return {
        cropId: input.cropId,
        text,
        confidence: confidence.length
          ? confidence.reduce((sum, value) => sum + value, 0) / confidence.length
          : null,
        warnings,
      };
    } catch (error) {
      if (AppError.is(error)) throw error;
      throw errors.structureDetectionFailed(
        'The crop could not be read by Tesseract. Adjust it and run OCR again.',
      );
    } finally {
      try {
        await session?.close();
      } finally {
        await this.staging.remove(input.storagePath).catch((error: unknown) => {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            'Failed to clean up OCR crop',
          );
        });
      }
    }
  }

  /** Text-only detection is pre-upload; no PDF images are sent to the model. */
  async detectStructure(input: DetectStructureRequest): Promise<DetectStructureResult> {
    const report: { usage: StructureDetectionUsage | null } = { usage: null };
    try {
      if (input.sessionId) await this.sessions.getById(input.sessionId);
      const rule = await this.structureRules.resolveContext(input.context);
      const contextKey = structureCropContextKey(input.context, rule);
      if (
        input.crops.some(
          (crop) =>
            crop.text.trim() &&
            (input.cropOnly || !reusableStructureCrop(crop, input.savedCrops, contextKey)),
        )
      )
        await this.usage.assertWithinLimit();
      const raw = await this.structureExtractor.extract({
        crops: input.crops,
        pageCount: input.pageCount,
        context: input.context,
        rule,
        ...(input.savedCrops && !input.cropOnly ? { savedCrops: input.savedCrops } : {}),
        beforeBatch: () => this.usage.assertWithinLimit(),
        onUsage: async (usage) => {
          const previous = report.usage;
          report.usage = previous
            ? {
                ...usage,
                promptTokens: previous.promptTokens + usage.promptTokens,
                completionTokens: previous.completionTokens + usage.completionTokens,
                totalTokens: previous.totalTokens + usage.totalTokens,
                cachedPromptTokens: previous.cachedPromptTokens + usage.cachedPromptTokens,
                reasoningTokens: previous.reasoningTokens + usage.reasoningTokens,
                callCount: previous.callCount + usage.callCount,
                costUsd:
                  previous.costUsd === null || usage.costUsd === null
                    ? null
                    : previous.costUsd + usage.costUsd,
              }
            : usage;
          try {
            await this.usage.recordUsage({
              source: 'structure-detection',
              model: usage.model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              callCount: usage.callCount,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            });
          } catch (error) {
            logger.warn(
              { err: error instanceof Error ? error.message : String(error) },
              'Failed to record structure-detection usage',
            );
          }
        },
      });
      const parsed = DetectedStructureSchema.safeParse(raw);
      if (!parsed.success)
        throw errors.structureDetectionFailed(
          'The AI returned invalid crop headings. Try extraction again.',
        );
      return {
        version: 1,
        pageCount: input.pageCount,
        answerLayout: input.context.answerLayout,
        rule,
        ...(input.cropOnly && parsed.data.nodes.length === 0
          ? { nodes: [], warnings: parsed.data.warnings ?? [] }
          : validateStructure(raw, input.pageCount, input.context.answerLayout, rule)),
        cropResults: parsed.data.cropResults ?? [],
        ...(parsed.data.aiCallCount !== undefined ? { aiCallCount: parsed.data.aiCallCount } : {}),
        usage: report.usage,
      };
    } catch (error) {
      // A refused, truncated or invalid result can still have consumed tokens.
      if (report.usage && AppError.is(error))
        throw errors.structureDetectionChargedFailure(error, report.usage);
      throw error;
    }
  }

  /**
   * Mint a signed, single-use slot the browser uploads the PDF straight to. This is what lets a chapter
   * PDF exceed the serverless request-body limit (~4.5 MB): the bytes go to storage directly, and only
   * a small reference is finalized through {@link uploadChapter}.
   */
  async createSignedUpload(fileName: string): Promise<SignedUploadTarget> {
    return this.staging.createSignedUpload(fileName);
  }

  /**
   * Ensure the exam → subject → module → chapter folder chain exists, returning the deepest folder's
   * id. Blank segments are skipped (a PYQ paper may omit subject/module/chapter), so the file is filed
   * under the deepest level the operator actually named — e.g. just under the exam folder.
   */
  async ensureChapterPath(path: ChapterPath): Promise<string> {
    const segments = [path.exam, path.subject, path.module, path.chapter]
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    let parentId: string | undefined;
    for (const name of segments) {
      const folder = await this.driveService.findOrCreateFolder(name, parentId);
      parentId = folder.id;
    }
    // `exam` is always present (required for every source), so at least one folder was created.
    return parentId as string;
  }

  /**
   * File a chapter's question/answer PDF into its Drive folder (creating the path if needed) and
   * persist a Document under its session. Fails fast if the session is unknown, before any writes.
   */
  async uploadChapter(input: {
    metadata: ChapterUploadMetadata;
    storagePath: string;
  }): Promise<UploadChapterResult> {
    const { metadata, storagePath } = input;
    const session = await this.sessions.getById(metadata.sessionId); // 404s here if the session is gone
    // The browser already uploaded the PDF straight to staging; pull those bytes server-to-server (no
    // request-body limit applies here) so a large paper that couldn't fit through the function still files.
    const bytes = await this.staging.download(storagePath);

    const path = {
      module: metadata.module,
      chapter: metadata.chapter,
      section: metadata.sectionName,
    };
    // A PYQ paper may omit the chapter, so fall back to the exam for a still-meaningful file name. This
    // is a DISPLAY label only — the document's identity is the client-minted uploadGroupId, so two
    // uploads of the same file (same derived name) are two distinct documents.
    const name = `${metadata.chapter.trim() || metadata.exam.trim() || 'paper'}-${metadata.kind}.pdf`;

    // Identity is (session · uploadGroupId · kind). Only an idempotent retry of the SAME upload action
    // (same id) finds a twin — a genuine second upload mints a fresh id and creates a new document. A
    // twin already in flight / extracted is left untouched (the retry must not clobber its results).
    const twin = await this.documents.findLiveByIdentity({
      sessionId: metadata.sessionId,
      uploadGroupId: metadata.uploadGroupId,
      kind: metadata.kind,
    });
    if (twin && twin.status !== 'uploaded' && twin.status !== 'failed') {
      throw errors.documentUnitVersionExists(name, twin.status);
    }

    const folderId = await this.ensureChapterPath(metadata);
    const driveFile = await this.driveService.uploadPdf({ name, bytes, folderId });

    const createInput: CreateDocumentInput = {
      sessionId: metadata.sessionId,
      driveFileId: driveFile.id,
      fileName: name,
      uploadGroupId: metadata.uploadGroupId,
      path,
      kind: metadata.kind,
      sectionName: metadata.sectionName,
      questionType: metadata.questionType ?? null,
      // Persist the operator's per-chapter exam/subject onto the document so publish reads the
      // authoritative value from here, not the first-write-wins session backfill below.
      exam: metadata.exam,
      subject: metadata.subject,
      pyq: metadata.pyq ?? false,
      pyqExam: metadata.pyqExam ?? null,
      pyqYear: metadata.pyqYear ?? null,
      // Paper-level PYQ provenance + answer layout, chosen once for the whole paper at cut time.
      paper: metadata.paper ?? null,
      answerLayout: metadata.answerLayout ?? 'separate',
      source: metadata.source ?? null,
      pageRange: null,
      topics: metadata.topics ?? [],
    };

    // Replace the not-yet-extracted twin in place, else create a fresh row.
    const document = twin
      ? await this.documents.replaceSource(twin.id, createInput)
      : await this.documents.create(createInput);

    // Make the (possibly auto-created) session informative by filling its exam/subject/module from
    // the first upload — only where still blank, so it never fights an operator's edit.
    await this.sessions.backfillContext(metadata.sessionId, {
      exam: metadata.exam,
      subject: metadata.subject,
      module: metadata.module,
    });

    // Pipeline mode: kick off extraction now for question PDFs. It runs on the worker, so the upload
    // response is not delayed — the "don't wait on Phase 2" guarantee still holds.
    if (session.autoRun && document.kind === 'question') {
      try {
        await this.extraction.enqueue(document.id);
      } catch (error) {
        // Never fail an upload because auto-enqueue hiccuped; the file is safely persisted either way.
        logger.warn(
          { documentId: document.id, err: error instanceof Error ? error.message : String(error) },
          'Auto-run enqueue failed; document left as uploaded',
        );
      }
    }

    // The staged object has served its purpose now the Document + Drive file exist; drop it best-effort
    // so a failed cleanup can never fail an upload that already succeeded.
    void this.staging.remove(storagePath).catch((error: unknown) => {
      logger.warn(
        { storagePath, err: error instanceof Error ? error.message : String(error) },
        'Failed to remove staged upload after ingest',
      );
    });

    return { document, driveFile };
  }
}
