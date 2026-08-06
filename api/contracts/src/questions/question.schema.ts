import { z } from 'zod';
import { SourcePathSchema } from '../common/source-path.js';

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
  // Bank-aligned image fields (mirrors the main Question collection so publish is a straight copy).
  // `questionImage` is a comma-separated list of Supabase URLs; `optionImages[i]` is the URL for option i.
  isQuestionImage: z.boolean(),
  questionImage: z.string().nullable(),
  isOptionImage: z.boolean(),
  optionImages: z.array(z.string()),
  // Editable metadata on the verify screen (mirrors the bank fields).
  questionType: z.string().nullable(),
  sectionName: z.string().nullable(),
  topic: z.string().nullable(),
  sourceRegion: z.object({
    page: z.number().int().positive(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Question = z.infer<typeof QuestionSchema>;

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
  explanation: true,
  images: true,
  isQuestionImage: true,
  questionImage: true,
  isOptionImage: true,
  optionImages: true,
  questionType: true,
  sectionName: true,
  topic: true,
}).partial();
export type UpdateQuestion = z.infer<typeof UpdateQuestionSchema>;

/** Response from uploading one cropped image to storage: the public URL to save on the question. */
export const UploadedImageSchema = z.object({ url: z.string() });
export type UploadedImage = z.infer<typeof UploadedImageSchema>;

/** Ask the AI to wrap the math in `\(...\)` LaTeX delimiters (the one-click "Fix LaTeX"). */
export const RefineLatexSchema = z.object({ text: z.string() });
export type RefineLatex = z.infer<typeof RefineLatexSchema>;

/** The AI-refined text, ready to save back onto the question. */
export const RefinedLatexSchema = z.object({ text: z.string() });
export type RefinedLatex = z.infer<typeof RefinedLatexSchema>;

/** Result of publishing extracted questions into the main bank: how many rows were inserted. */
export const PublishResultSchema = z.object({ published: z.number().int().nonnegative() });
export type PublishResult = z.infer<typeof PublishResultSchema>;

/** Ask the AI to locate the figures on one rendered page of a document (the Verify auto-crop). */
export const DetectFiguresRequestSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive(),
});
export type DetectFiguresRequest = z.infer<typeof DetectFiguresRequestSchema>;

/** One detected figure and its intended destination in the extracted question. */
export const DetectedFigureSchema = z.object({
  questionId: z.string(),
  target: z.enum(['question', 'option']).default('question'),
  /** Zero-based option position when `target` is `option`. */
  optionIndex: z.number().int().nonnegative().default(0),
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
