import { z } from 'zod';
import { ChapterKindSchema, ExamSchema, ModuleSchema, QuestionTypeSchema, SourceSchema } from '../common/vocabulary.js';
import { AnswerLayoutSchema, PaperMetadataSchema } from '../common/paper-metadata.js';
import { DriveFileSchema } from '../drive/drive.schema.js';
import { ChapterTopicSchema, DocumentSchema } from '../documents/document.schema.js';

/**
 * The nested-folder trail a cut chapter is filed under in Drive: exam → subject → module → chapter.
 * The ingestion service ensures each level exists (idempotently) before uploading.
 */
export const ChapterPathSchema = z.object({
  exam: ExamSchema,
  subject: z.string().min(1),
  module: ModuleSchema,
  chapter: z.string().min(1),
});
export type ChapterPath = z.infer<typeof ChapterPathSchema>;

/**
 * Metadata that travels as a JSON form-field alongside the multipart PDF upload. The PDF bytes are
 * built in the browser (cut + reflowed); this describes where it belongs and what it is.
 *
 * `sessionId` ties the upload to the durable Phase-1 session it belongs to, so the backend can
 * persist a Document record the moment the bytes land (see the ingestion service).
 */
export const ChapterUploadMetadataSchema = ChapterPathSchema.extend({
  // subject/module/chapter may be blank for a PYQ paper (a whole paper spans many); the refine below
  // still requires them for every other source. Overrides the strict ChapterPathSchema fields.
  subject: z.string(),
  module: z.string(),
  chapter: z.string(),
  sessionId: z.string().min(1),
  sectionName: z.string().min(1),
  questionType: QuestionTypeSchema,
  kind: ChapterKindSchema,
  /** Optional provenance of the chapter's questions: pyq / module / textbook (open string). */
  source: SourceSchema.optional(),
  /** Whether this chapter's questions are previous-year questions (PYQ) — set by the operator at cut time. */
  pyq: z.boolean().optional(),
  /** The exam a PYQ chapter's questions were asked in (e.g. NEET). Sent only when `pyq` is set. */
  pyqExam: z.string().optional(),
  /** The year a PYQ chapter's questions were asked (e.g. "2019"). Sent only when `pyq` is set. */
  pyqYear: z.string().optional(),
  /**
   * Paper-level provenance for a PYQ upload (exam name/year/session/shift/paper code …). Describes the
   * whole paper the questions came from; entered once (optionally AI-filled) and denormalized onto
   * every extracted question. Omitted for non-PYQ chapters.
   */
  paper: PaperMetadataSchema.optional(),
  /**
   * How this paper's answers are laid out: `separate` (answer key grouped elsewhere / a sibling PDF —
   * the default) or `inline` (each question is followed by its own answer in one combined PDF, so
   * extraction reads the answer beside each question). Absent ⇒ `separate`.
   */
  answerLayout: AnswerLayoutSchema.optional(),
  /**
   * Optional topic-level structure of a QUESTION part: each topic's predefined question-type blocks
   * with the page spans they occupy in the uploaded PDF. Omitted for the chapter-wise flow (and for
   * answer/solution parts) — the pipeline behaves exactly as before when absent.
   */
  topics: z.array(ChapterTopicSchema).optional(),
}).superRefine((meta, ctx) => {
  // subject/module/chapter are optional ONLY for previous-year-question papers; every other source
  // must still file under a full subject → module → chapter path so the bank stays browseable.
  const isPyq = (meta.source ?? '').trim().toLowerCase() === 'pyq';
  if (isPyq) return;
  for (const key of ['subject', 'module', 'chapter'] as const) {
    if (!meta[key].trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required` });
    }
  }
});
export type ChapterUploadMetadata = z.infer<typeof ChapterUploadMetadataSchema>;

/** What a successful chapter upload returns: the durable Document row plus the created Drive file. */
export const UploadChapterResponseSchema = z.object({
  document: DocumentSchema,
  driveFile: DriveFileSchema,
});
export type UploadChapterResponse = z.infer<typeof UploadChapterResponseSchema>;

/**
 * A chapter PDF is uploaded directly to staging storage (which bypasses the serverless request-body
 * limit that caps a multipart upload at ~4.5 MB), then ingested by reference. Step 1 asks the API for
 * a signed, single-use upload slot for a file of this name.
 */
export const SignedUploadRequestSchema = z.object({
  fileName: z.string().min(1),
});
export type SignedUploadRequest = z.infer<typeof SignedUploadRequestSchema>;

/** Step 1's reply: the absolute URL the browser PUTs the bytes to, plus the opaque object path to ingest. */
export const SignedUploadTargetSchema = z.object({
  /** Opaque staging path the client echoes back to finalize; the browser never interprets or builds it. */
  path: z.string().min(1),
  /** Absolute, single-use URL the browser uploads the PDF bytes to directly — no size limit at our function. */
  uploadUrl: z.string().url(),
});
export type SignedUploadTarget = z.infer<typeof SignedUploadTargetSchema>;

/**
 * Step 2 finalizes the upload: the bytes already live in staging storage at `storagePath`, so this
 * request carries only the small JSON metadata and never approaches the serverless body limit.
 */
export const UploadChapterRequestSchema = z.object({
  storagePath: z.string().min(1),
  metadata: ChapterUploadMetadataSchema,
});
export type UploadChapterRequest = z.infer<typeof UploadChapterRequestSchema>;
