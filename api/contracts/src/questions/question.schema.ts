import { z } from 'zod';
import { SourcePathSchema } from '../common/source-path.js';
import { PaperMetadataSchema } from '../common/paper-metadata.js';

/** A figure extracted from the page, stored in Drive and referenced by the question. */
export const QuestionImageSchema = z.object({
  driveFileId: z.string(),
  alt: z.string(),
});
export type QuestionImage = z.infer<typeof QuestionImageSchema>;

/** One answer option. `body` is LaTeX-bearing text (rendered with KaTeX on the client). */
export const QuestionOptionSchema = z.object({
  label: z.string().min(1), // "A", "B", ...
  body: z.string(),
  isCorrect: z.boolean(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

/** One labelled entry in a match-the-column column — e.g. `{ label: 'A', body: 'V = \\(\\sqrt{GM/r}\\)' }`. */
export const MatchEntrySchema = z.object({
  label: z.string().min(1), // "A".."D" (col I), "p".."s" (col II), "t".."w" (col III)
  body: z.string(), // LaTeX-bearing
  // Optional figure attached to this entry (Supabase URL); null when none. Ingest-only annotation,
  // defaulted so match data written before this field still parses.
  image: z.string().nullable().default(null),
});
export type MatchEntry = z.infer<typeof MatchEntrySchema>;

/** One column of a match-the-column question: a heading plus its labelled entries. */
export const MatchColumnSchema = z.object({
  title: z.string(), // "Column I (Velocity)"
  entries: z.array(MatchEntrySchema),
});
export type MatchColumn = z.infer<typeof MatchColumnSchema>;

/**
 * Structured "match the column" data. `columns` holds two OR MORE columns (papers use 2 or 3), each
 * with its own labelled entries. `key` is the correct matching FROM the first column's labels to the
 * labels they match in the later columns, e.g. `{ A: ['p','t'], B: ['q','u'] }`; it may be empty when
 * the question sheet does not print the answer (filled from the answer key, or by the operator in
 * verify). The flat `answer` string mirrors this map ("A-p,t; B-q,u") so a plain renderer still shows
 * the matching. Null on every non-match question.
 */
export const MatchDataSchema = z.object({
  columns: z.array(MatchColumnSchema).min(2),
  key: z.record(z.string(), z.array(z.string())),
});
export type MatchData = z.infer<typeof MatchDataSchema>;

/** Render a match key as the flat mirror string, e.g. `{ A:['p','t'], B:['q'] }` → `"A-p,t; B-q"`. */
export function matchKeyToAnswer(key: Record<string, readonly string[]>): string {
  return Object.entries(key)
    .filter(([, targets]) => targets.length > 0)
    .map(([label, targets]) => `${label}-${targets.join(',')}`)
    .join('; ');
}

/**
 * Best-effort parse of a flat match-answer string ("A-p,t; B-q,u", "A→pt", "A - p, t") back into the
 * structured key. Segments split on ';' or newlines; each is "<label><sep><targets>" where the
 * targets split on commas/whitespace, or — when run together as single characters ("pt") — per
 * character. Unparseable input yields `{}` so the operator can fill the matching in verify.
 */
export function parseMatchKey(answer: string): Record<string, string[]> {
  const key: Record<string, string[]> = {};
  for (const segment of answer.split(/[;\n]+/)) {
    const match = /^\s*([A-Za-z0-9]+)\s*(?:[-–—>:→=]+|\s)\s*(.+)$/.exec(segment.trim());
    if (!match) continue;
    const label = (match[1] ?? '').trim();
    const rest = (match[2] ?? '').trim();
    if (!label || !rest) continue;
    const targets = /[,\s]/.test(rest) ? rest.split(/[,\s]+/).filter(Boolean) : [...rest];
    if (targets.length > 0) key[label] = targets;
  }
  return key;
}

/**
 * One persisted crop rectangle, in the source page image's NATURAL pixels (the same numbers the
 * verify canvas records). Stored on the question so a saved crop re-materialises as an adjustable box
 * on any device/reload — not just a flat thumbnail. `url` ties it to the attached image; `type` +
 * `optionIndex` say which destination it filled. The page is the question's `sourceRegion.page`.
 */
export const ImageCropSchema = z.object({
  url: z.string(),
  type: z.enum(['question', 'option', 'passage']),
  optionIndex: z.number().int().nonnegative(),
  nx: z.number(),
  ny: z.number(),
  nw: z.number(),
  nh: z.number(),
});
export type ImageCrop = z.infer<typeof ImageCropSchema>;

/**
 * The verified question record — the thing published to the bank.
 * `sourceRegion` keeps the page + bounding box it was read from, so a bad extraction stays fixable.
 */
export const QuestionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  // The printed question number (1, 2, 3 …) as read from the page. Null when the model could not
  // read one. Used later to map an auto-detected figure back to the question it belongs to.
  questionNumber: z.number().int().nullable(),
  path: SourcePathSchema,
  stem: z.string(), // LaTeX-bearing
  options: z.array(QuestionOptionSchema),
  answer: z.string(),
  // The worked solution / explanation text (LaTeX-bearing), merged from the sibling solution PDF.
  // Null when no solution source was provided for the question.
  explanation: z.string().nullable(),
  images: z.array(QuestionImageSchema),
  // Structured match-the-column data (columns + correct matching) when this is a MATRIX MATCH
  // question; null for every other type. The flat `answer` above mirrors `match.key` as text.
  match: MatchDataSchema.nullable(),
  // Comprehension grouping (BLA-125, v2). A comprehension prints one shared passage followed by several
  // sub-questions; each sub-question is its OWN row carrying its OWN real questionType, and the shared
  // passage text + image live ONCE in a separate {@link PassageSchema} record. `passageId` references
  // that record (null on ordinary questions) — group membership is `passageId != null`, NOT a per-row
  // type — and doubles as the bank group_id on publish. `groupOrder` is this sub-question's 0-based
  // position within its group. Both defaulted so rows written before this field still parse.
  passageId: z.string().nullable().default(null),
  groupOrder: z.number().int().nullable().default(null),
  // Bank-aligned image fields (mirrors the main Question collection so publish is a straight copy).
  // `questionImage` is a comma-separated list of Supabase URLs; `optionImages[i]` is the URL for option i.
  isQuestionImage: z.boolean(),
  questionImage: z.string().nullable(),
  isOptionImage: z.boolean(),
  optionImages: z.array(z.string()),
  // Figures attached to the worked solution / explanation (Supabase URLs). Ingest-only annotation for
  // diagrams that belong to the reasoning; empty by default. Unlike question/option figures these are
  // not re-materialised as editable canvas boxes on reload — they persist as thumbnails.
  explanationImages: z.array(z.string()).default([]),
  // Persisted crop rectangles (natural image pixels) for the attached figures — ingest-only, empty by
  // default. Lets every saved crop reappear as an editable box on the verify canvas on any device.
  imageCrops: z.array(ImageCropSchema).default([]),
  // Editable metadata on the verify screen (mirrors the bank fields).
  questionType: z.string().nullable(),
  // Per-question difficulty (easy | medium | hard), classified by the AI at extraction and correctable
  // on the Verify screen. Resolved to the bank's Level FK on publish. Defaulted so rows extracted
  // before difficulty existed still parse (absent → null).
  level: z.string().nullable().default(null),
  sectionName: z.string().nullable(),
  topic: z.string().nullable(),
  // Per-question subject, set per node in the structure tree — for a paper that spans subjects (a PYQ
  // paper) each question publishes under its own subject. Null falls back to the document's subject.
  subject: z.string().nullable(),
  // Marked on the Verify screen to distinguish a question needing later attention. Carried through to
  // the published bank row so a flagged question stays findable in the Questions browse.
  flagged: z.boolean(),
  // Per-question PYQ provenance the model reads off the page when this question's segment is toggled
  // PYQ: whether it is a previous-year question, plus the SOURCE exam + year it originally appeared in
  // (e.g. "NEET" / "2019") — a separate axis from the document-level target exam/subject. `isPyq` is
  // false and exam/year null on ordinary questions and on legacy rows (which fall back to the document).
  isPyq: z.boolean(),
  pyqExam: z.string().nullable(),
  pyqYear: z.string().nullable(),
  // Paper-level PYQ provenance denormalized from the document (exam name/year/session/shift/paper
  // code …), so every published question carries the paper it came from. Null on non-PYQ questions
  // and on legacy rows. `pyqExam`/`pyqYear` above remain the per-question source the model reads on
  // the page; `paper.examName`/`examYear` are the whole-paper values and normally agree.
  paper: PaperMetadataSchema.nullable(),
  sourceRegion: z.object({
    page: z.number().int().positive(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Question = z.infer<typeof QuestionSchema>;

/**
 * The shared passage of a comprehension block (BLA-125, v2), stored ONCE and referenced by every
 * sub-question via {@link QuestionSchema.passageId}. `id` is the group's stable identity (a hash of the
 * normalized passage + documentId, deterministic across re-extract/re-publish) and is stamped as the
 * bank `group_id` on publish. `text` is the LaTeX-bearing passage; `passageImage` is the one shared
 * figure (Supabase URL) and `imageCrops` persists its crop rects so the box re-materialises on the
 * verify canvas. Editing the passage once here replaces the old N-sibling passage fan-out.
 */
export const PassageSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  text: z.string(),
  passageImage: z.string().nullable().default(null),
  imageCrops: z.array(ImageCropSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Passage = z.infer<typeof PassageSchema>;

/** Editable fields on a comprehension passage — the operator fixes the shared passage/image in ONE place. */
export const UpdatePassageSchema = PassageSchema.pick({
  text: true,
  passageImage: true,
  imageCrops: true,
}).partial();
export type UpdatePassage = z.infer<typeof UpdatePassageSchema>;

/**
 * The verify/preview read for one document: its questions PLUS the passages they reference. The client
 * joins them by {@link QuestionSchema.passageId} to render each shared passage ONCE above its ordered
 * sub-questions. `passages` is empty for a document with no comprehension groups.
 */
export const QuestionListResponseSchema = z.object({
  questions: z.array(QuestionSchema),
  passages: z.array(PassageSchema),
});
export type QuestionListResponse = z.infer<typeof QuestionListResponseSchema>;

/**
 * Manually group already-extracted questions into a NEW comprehension (BLA-125, v2). The verify screen
 * sends the selected question ids (in reading order); the server creates one shared {@link PassageSchema}
 * (empty text until the operator re-extracts it off the page), points each question's `passageId` at it,
 * and stamps `groupOrder` in the given order. The fix-up for a page whose passage the extractor missed.
 */
export const GroupQuestionsSchema = z.object({
  documentId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1),
});
export type GroupQuestions = z.infer<typeof GroupQuestionsSchema>;

/** Query for reading the questions extracted from one document (the verify/preview screen). */
export const QuestionListQuerySchema = z.object({
  documentId: z.string().min(1),
});
export type QuestionListQuery = z.infer<typeof QuestionListQuerySchema>;

/** Editable fields — what the verify screen is allowed to change before publishing. */
export const UpdateQuestionSchema = QuestionSchema.pick({
  stem: true,
  options: true,
  answer: true,
  match: true,
  explanation: true,
  images: true,
  isQuestionImage: true,
  questionImage: true,
  isOptionImage: true,
  optionImages: true,
  explanationImages: true,
  imageCrops: true,
  questionType: true,
  level: true,
  sectionName: true,
  topic: true,
  pyqExam: true,
  pyqYear: true,
  paper: true,
  flagged: true,
}).partial();
export type UpdateQuestion = z.infer<typeof UpdateQuestionSchema>;

/** One question's pending verify edits, addressed by id — the unit of a batch update. */
export const QuestionBatchUpdateSchema = z.object({
  id: z.string().min(1),
  patch: UpdateQuestionSchema,
});
export type QuestionBatchUpdate = z.infer<typeof QuestionBatchUpdateSchema>;

/** Push several questions' verify edits in one call — only the dirty ones, never a full resend. */
export const BatchUpdateQuestionsSchema = z.object({
  updates: z.array(QuestionBatchUpdateSchema).min(1),
});
export type BatchUpdateQuestions = z.infer<typeof BatchUpdateQuestionsSchema>;

/**
 * Per-question outcome of a batch update. `updated` holds the saved rows; `failed` the ids that
 * could not be saved, each with a human-readable reason — the client keeps those dirty for retry.
 */
export const BatchUpdateQuestionsResultSchema = z.object({
  updated: z.array(QuestionSchema),
  failed: z.array(z.object({ id: z.string(), message: z.string() })),
});
export type BatchUpdateQuestionsResult = z.infer<typeof BatchUpdateQuestionsResultSchema>;

/** Response from uploading one cropped image to storage: the public URL to save on the question. */
export const UploadedImageSchema = z.object({ url: z.string() });
export type UploadedImage = z.infer<typeof UploadedImageSchema>;

/** Ask the AI to wrap the math in `\(...\)` LaTeX delimiters (the one-click "Fix LaTeX"). */
export const RefineLatexSchema = z.object({ text: z.string() });
export type RefineLatex = z.infer<typeof RefineLatexSchema>;

/** The AI-refined text, ready to save back onto the question. */
export const RefinedLatexSchema = z.object({ text: z.string() });
export type RefinedLatex = z.infer<typeof RefinedLatexSchema>;

/**
 * Ask the AI to re-read the source page of ONE already-extracted question and re-extract its fields
 * from scratch (stem, options, answer, explanation) — the "read the page again" companion to the
 * LaTeX refiner. Addressed by the question's id together with its document (which resolves the page).
 *
 * `source` overrides WHICH page image is read: by default the question's own source page, but the
 * verify screen points the answer/explanation re-read at the sibling answer/solution document and
 * this topic's page in it, so those fields are read from the answer/solution PDF — never the question
 * sheet. The question's identity (its number/stem/type) is still resolved from `documentId`.
 */
export const ReExtractSourceSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive(),
});
export type ReExtractSource = z.infer<typeof ReExtractSourceSchema>;

export const ReExtractQuestionSchema = z.object({
  documentId: z.string().min(1),
  questionId: z.string().min(1),
  source: ReExtractSourceSchema.optional(),
  // Optional question-type override for the re-read: the verify screen sends the type the operator
  // has just selected (before saving the draft) so the model re-extracts with the RIGHT config —
  // e.g. switching a mis-typed question to "matrix" and re-reading yields the match columns, not
  // garbled options. Omitted ⇒ the server uses the question's stored type.
  questionType: z.string().min(1).nullable().optional(),
});
export type ReExtractQuestion = z.infer<typeof ReExtractQuestionSchema>;

/**
 * The freshly re-extracted fields for one question, ready to drop into the verify card's draft.
 * `answer`/`explanation` are best-effort: a question paper rarely prints them, so they come back
 * empty/null unless the page itself shows the correct choice or a worked solution.
 */
export const ReExtractedQuestionSchema = z.object({
  stem: z.string(),
  options: z.array(QuestionOptionSchema),
  answer: z.string(),
  explanation: z.string().nullable(),
  // Structured match-the-column data when the re-read question is a MATRIX MATCH type (columns +
  // correct matching); null for every other type. Mirrors {@link QuestionSchema.match} so a matrix
  // re-extraction can drop straight into the verify card's match table instead of garbling `options`.
  match: MatchDataSchema.nullable(),
});
export type ReExtractedQuestion = z.infer<typeof ReExtractedQuestionSchema>;

/**
 * Ask the AI to re-read a whole COMPREHENSION GROUP off its source page (BLA-125): the shared passage
 * plus every sub-question at once. Addressed by the group's stable `passageId` within its document; the
 * service resolves the group's Passage record + member rows (and their source pages) from it. `source`
 * redirects the page read exactly as {@link ReExtractQuestionSchema} does (e.g. re-read
 * answers/explanations from the sibling solution PDF). `questionType` is carried for symmetry. This is
 * the group companion to the single-question re-read.
 */
export const ReExtractGroupSchema = z.object({
  documentId: z.string().min(1),
  passageId: z.string().min(1),
  source: ReExtractSourceSchema.optional(),
  questionType: z.string().min(1).nullable().optional(),
});
export type ReExtractGroup = z.infer<typeof ReExtractGroupSchema>;

/**
 * One re-extracted sub-question of a group, already matched back to the existing row it should update
 * (by printed number, else by position) so the Verify client can drop each straight onto the right
 * card's draft. Extends the single-question re-extract shape with the target `questionId`.
 */
export const ReExtractedSubQuestionSchema = ReExtractedQuestionSchema.extend({
  questionId: z.string(),
});
export type ReExtractedSubQuestion = z.infer<typeof ReExtractedSubQuestionSchema>;

/**
 * The result of a whole-group re-read: the freshly-read shared `passage` (applied ONCE to the group's
 * {@link PassageSchema} record by the client) and the per-sub-question fields, each carrying the
 * `questionId` of the existing row it maps to. Sub-questions the model did not return keep their
 * current draft; extras it invented (no matching row) are dropped server-side, so the array only ever
 * addresses real rows.
 */
export const ReExtractedGroupSchema = z.object({
  passage: z.string(),
  subQuestions: z.array(ReExtractedSubQuestionSchema),
});
export type ReExtractedGroup = z.infer<typeof ReExtractedGroupSchema>;

/** Result of publishing extracted questions into the main bank: how many rows were written. */
export const PublishResultSchema = z.object({ published: z.number().int().nonnegative() });
export type PublishResult = z.infer<typeof PublishResultSchema>;

/** One document's outcome inside a session publish: rows written, or the error that stopped it. */
export const PublishDocumentResultSchema = z.object({
  documentId: z.string(),
  published: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type PublishDocumentResult = z.infer<typeof PublishDocumentResultSchema>;

/**
 * Result of publishing a whole session. One document failing no longer aborts the run — its error is
 * captured per-document and the rest still publish. `published` is the rolled-up total across
 * documents (kept as a top-level field so a caller that only reads the count still works).
 */
export const PublishSessionResultSchema = z.object({
  published: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  documents: z.array(PublishDocumentResultSchema),
});
export type PublishSessionResult = z.infer<typeof PublishSessionResultSchema>;

/** Ask the AI to locate the figures on one rendered page of a document (the Verify auto-crop). */
export const DetectFiguresRequestSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive(),
});
export type DetectFiguresRequest = z.infer<typeof DetectFiguresRequestSchema>;

/** One detected figure and its intended destination in the extracted question. */
export const DetectedFigureSchema = z.object({
  // The extracted question this figure attaches to (its stem or an option). Empty string when `target`
  // is `passage` — a shared comprehension figure attaches to `passageId` instead of a question.
  questionId: z.string(),
  target: z.enum(['question', 'option', 'passage']).default('question'),
  /** Zero-based option position when `target` is `option`. */
  optionIndex: z.number().int().nonnegative().default(0),
  // The comprehension passage this figure attaches to, when `target` is `passage`; null otherwise.
  passageId: z.string().nullable().default(null),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [x, y, width, height]
  /**
   * The verbatim first line the detector read directly above the figure ("line above"). Lets the
   * operator confirm by eye which extracted question a crop belongs to. Empty when the model gave none.
   */
  snippet: z.string().default(''),
});
export type DetectedFigure = z.infer<typeof DetectedFigureSchema>;

/**
 * Result of a figure-detection pass over one page: the page's natural pixel size (so the client can
 * scale each bbox to the displayed image) and the detected figures mapped to their questions.
 */
export const DetectedFiguresSchema = z.object({
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  figures: z.array(DetectedFigureSchema),
});
export type DetectedFigures = z.infer<typeof DetectedFiguresSchema>;

/**
 * Most pages one detect-figures batch request may carry. Keeps a request comfortably inside
 * serverless time limits; the client chunks a longer document into successive requests using this
 * same constant, so the two sides can never disagree on the cap.
 */
export const DETECT_FIGURES_MAX_PAGES = 10;

/**
 * Ask the AI to locate the figures on several pages of one document in a single request (the
 * whole-document detect). The page-count cap keeps one request comfortably inside serverless time
 * limits; the client chunks a longer document into successive requests and shows progress per chunk.
 */
export const DetectFiguresBatchRequestSchema = z.object({
  documentId: z.string().min(1),
  pages: z.array(z.number().int().positive()).min(1).max(DETECT_FIGURES_MAX_PAGES),
});
export type DetectFiguresBatchRequest = z.infer<typeof DetectFiguresBatchRequestSchema>;

/**
 * One page's figure-detection result inside a batch response: the detections, or — when that page's
 * vision call failed — the failure message. A failed page never fails the whole batch; the client
 * folds it into the run summary while the other pages' (already paid-for) detections still apply.
 */
export const DetectedFiguresPageSchema = z.discriminatedUnion('ok', [
  DetectedFiguresSchema.extend({ ok: z.literal(true), page: z.number().int().positive() }),
  z.object({ ok: z.literal(false), page: z.number().int().positive(), error: z.string() }),
]);
export type DetectedFiguresPage = z.infer<typeof DetectedFiguresPageSchema>;

/**
 * Whole-document detection result: one entry per requested page that has extracted questions.
 * Requested pages without questions are skipped server-side (nothing to attach a figure to).
 */
export const DetectedFiguresBatchSchema = z.object({
  pages: z.array(DetectedFiguresPageSchema),
});
export type DetectedFiguresBatch = z.infer<typeof DetectedFiguresBatchSchema>;
