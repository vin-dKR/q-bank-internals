import { z } from 'zod';

/**
 * One uploaded file's size ceiling. A full exam syllabus is a few thousand topics — a hundred times this
 * would be someone uploading the wrong file.
 */
export const SYLLABUS_UPLOAD_MAX_CHARS = 2_000_000;

/** The upload formats the server can read. */
export const SYLLABUS_UPLOAD_FORMATS = ['json', 'csv'] as const;
export const SyllabusUploadFormatSchema = z.enum(SYLLABUS_UPLOAD_FORMATS);
export type SyllabusUploadFormat = z.infer<typeof SyllabusUploadFormatSchema>;

/** `bundled` ships with the app; `uploaded` was uploaded here and overrides the bundled file of that exam. */
export const SYLLABUS_SOURCES = ['bundled', 'uploaded'] as const;
export const SyllabusSourceSchema = z.enum(SYLLABUS_SOURCES);
export type SyllabusSource = z.infer<typeof SyllabusSourceSchema>;

const NameSchema = z.string().trim().min(1);

/** Other names the bank stores for the same exam, subject or chapter. Blank entries are dropped. */
const AliasesSchema = z
  .array(z.string())
  .default([])
  .transform((aliases) => aliases.map((alias) => alias.trim()).filter((alias) => alias !== ''));

/**
 * A syllabus as a person AUTHORS it — what an upload carries and what a bundled JSON file holds. No ids:
 * chapter and topic ids are generated from position when the syllabus is read, so topics can be reordered
 * or reworded freely. Only the topic TEXT is ever written to a question.
 */
export const SyllabusFileSchema = z.object({
  exam: NameSchema,
  title: NameSchema,
  aliases: AliasesSchema,
  subjects: z
    .array(
      z.object({
        subject: NameSchema,
        aliases: AliasesSchema,
        chapters: z
          .array(
            z.object({
              chapter: NameSchema,
              /** NCERT class, or null for a unit with no class of its own (p-Block Elements, say). */
              class: z.coerce.number().int().nullable().default(null),
              aliases: AliasesSchema,
              topics: z.array(NameSchema).min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type SyllabusFile = z.infer<typeof SyllabusFileSchema>;

/** One topic, with the id the AI answers with (unique within its subject). */
export const SyllabusTopicSchema = z.object({ id: z.string(), topic: z.string() });
export type SyllabusTopic = z.infer<typeof SyllabusTopicSchema>;

export const SyllabusChapterSchema = z.object({
  id: z.string(),
  chapter: z.string(),
  class: z.number().int().nullable(),
  aliases: z.array(z.string()),
  topics: z.array(SyllabusTopicSchema),
});
export type SyllabusChapter = z.infer<typeof SyllabusChapterSchema>;

export const SyllabusSubjectSchema = z.object({
  subject: z.string(),
  aliases: z.array(z.string()),
  chapters: z.array(SyllabusChapterSchema),
});
export type SyllabusSubject = z.infer<typeof SyllabusSubjectSchema>;

/** One exam's syllabus as the app uses it: the authored tree plus generated ids and where it came from. */
export const SyllabusSchema = z.object({
  exam: z.string(),
  title: z.string(),
  aliases: z.array(z.string()),
  source: SyllabusSourceSchema,
  /** When it was last uploaded; null for a bundled file, which changes only with a deploy. */
  updatedAt: z.string().datetime().nullable(),
  subjects: z.array(SyllabusSubjectSchema),
});
export type Syllabus = z.infer<typeof SyllabusSchema>;

/** One exam in the list: what it is, where it came from, and how much of it there is. */
export const SyllabusSummarySchema = z.object({
  exam: z.string(),
  title: z.string(),
  aliases: z.array(z.string()),
  source: SyllabusSourceSchema,
  updatedAt: z.string().datetime().nullable(),
  subjects: z.number().int().nonnegative(),
  chapters: z.number().int().nonnegative(),
  topics: z.number().int().nonnegative(),
});
export type SyllabusSummary = z.infer<typeof SyllabusSummarySchema>;

export const SyllabusListSchema = z.object({ syllabi: z.array(SyllabusSummarySchema) });
export type SyllabusList = z.infer<typeof SyllabusListSchema>;

/**
 * An upload: the file's text and which format to read it as. One file may carry several exams (a CSV with
 * more than one value in its `exam` column, or a JSON array), and each exam it names is REPLACED whole.
 */
export const SyllabusUploadSchema = z.object({
  format: SyllabusUploadFormatSchema,
  content: z.string().min(1).max(SYLLABUS_UPLOAD_MAX_CHARS),
  /** The uploaded file's name, kept so the list can show where a syllabus came from. */
  fileName: z.string().max(260).optional(),
});
export type SyllabusUpload = z.infer<typeof SyllabusUploadSchema>;

/** What an upload wrote: the exams now stored, and which of them replaced a syllabus that was already there. */
export const SyllabusUploadResultSchema = z.object({
  saved: z.array(SyllabusSummarySchema),
  replaced: z.array(z.string()),
});
export type SyllabusUploadResult = z.infer<typeof SyllabusUploadResultSchema>;

/** The upload formats documented for the operator: the CSV columns, and a ready-to-edit sample of each. */
export const SyllabusFormatsSchema = z.object({
  csvColumns: z.array(z.object({ column: z.string(), required: z.boolean(), description: z.string() })),
  json: z.string(),
  csv: z.string(),
});
export type SyllabusFormats = z.infer<typeof SyllabusFormatsSchema>;
