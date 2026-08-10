import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { CatalogQuestion } from '@ingest/contracts';
import { ejsonBool, ejsonNumber, escapeRegex, firstBatch, oid } from '../database/mongo-ejson.js';
import type {
  CatalogFilterOptionSets,
  CatalogFilters,
  CatalogFilterSelection,
  CatalogQuestionPage,
  CatalogStore,
} from '../../modules/catalog/index.js';

/** A keyword only searches once it's meaningful — matches eduents' 2-char floor. */
const MIN_SEARCH_LENGTH = 2;

/**
 * Parser for one raw bank `Question` document → the shared {@link CatalogQuestion}. Every field is
 * tolerant (`.catch`) because the collection predates this app and legacy rows omit most of it; a
 * bad row degrades field-by-field rather than dropping the whole question from the browse list.
 */
const RawCatalogQuestionSchema = z
  .object({
    _id: oid,
    question_number: ejsonNumber.nullable().catch(null),
    file_name: z.string().nullable().catch(null),
    question_text: z.string().catch(''),
    answer: z.string().nullable().catch(null),
    exam_name: z.string().nullable().catch(null),
    subject: z.string().nullable().catch(null),
    chapter: z.string().nullable().catch(null),
    section_name: z.string().nullable().catch(null),
    question_type: z.string().nullable().catch(null),
    topic: z.string().nullable().catch(null),
    flagged: ejsonBool.catch(false),
    options: z.array(z.string()).catch([]),
    isQuestionImage: ejsonBool.catch(false),
    question_image: z.string().nullable().catch(null),
    isOptionImage: ejsonBool.catch(false),
    option_images: z.array(z.string()).catch([]),
  })
  .transform(
    (doc): CatalogQuestion => ({
      id: doc._id,
      questionNumber: doc.question_number,
      fileName: doc.file_name,
      questionText: doc.question_text,
      answer: doc.answer,
      exam: doc.exam_name,
      subject: doc.subject,
      chapter: doc.chapter,
      section: doc.section_name,
      questionType: doc.question_type,
      topic: doc.topic,
      flagged: doc.flagged,
      options: doc.options,
      isQuestionImage: doc.isQuestionImage,
      questionImage: doc.question_image,
      isOptionImage: doc.isOptionImage,
      optionImages: doc.option_images,
    }),
  );

/** Distinct, non-empty, case-insensitively sorted values out of a raw `$addToSet` array (drops null). */
function cleanValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return Array.from(new Set(strings)).sort((a, b) => a.localeCompare(b));
}

/**
 * {@link CatalogStore} over the main bank's `Question` collection, using raw Mongo commands on the
 * shared connection (the bank has no Prisma model, so — like the bank fix store — this never touches
 * its schema or indexes). Reads only: a `find` for the id-cursored browse list, an `aggregate` for
 * the cascading filter option sets. Filter fields map to the collection's snake_case columns.
 */
export class MongoCatalogStore implements CatalogStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
  ) {}

  async listQuestions(
    filters: CatalogFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CatalogQuestionPage> {
    const filter = this.buildFilter(filters);
    if (cursor) filter._id = { $gt: { $oid: cursor } };
    const command = {
      find: this.collection,
      filter,
      sort: { _id: 1 },
      // Over-fetch by one to detect (and produce the cursor for) a next page.
      limit: limit + 1,
    } as unknown as Prisma.InputJsonObject;

    const rows = this.readBatch(await this.prisma.$runCommandRaw(command));
    const hasMore = rows.length > limit;
    const questions = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (questions[questions.length - 1]?.id ?? null) : null;
    return { questions, nextCursor };
  }

  async filterOptions(selection: CatalogFilterSelection): Promise<CatalogFilterOptionSets> {
    // One distinct-values sub-pipeline per field via `$facet`, each matched on the OTHER selected
    // fields but never on its own field. So a chosen Subject still lists every subject (you can
    // switch it), while the Chapter list shrinks to that subject — cascading without self-collapsing.
    const facet = (field: string): Prisma.InputJsonObject =>
      [
        { $match: this.optionsMatch(selection, field) },
        { $group: { _id: null, values: { $addToSet: `$${field}` } } },
      ] as unknown as Prisma.InputJsonObject;

    const command = {
      aggregate: this.collection,
      pipeline: [
        {
          $facet: {
            exams: facet('exam_name'),
            subjects: facet('subject'),
            chapters: facet('chapter'),
            sections: facet('section_name'),
            questionTypes: facet('question_type'),
          },
        },
      ],
      cursor: {},
    } as unknown as Prisma.InputJsonObject;

    const doc = firstBatch(await this.prisma.$runCommandRaw(command))[0] as
      | Record<string, Array<{ values?: unknown }> | undefined>
      | undefined;
    const valuesOf = (facetName: string): unknown => doc?.[facetName]?.[0]?.values;
    return {
      exams: cleanValues(valuesOf('exams')),
      subjects: cleanValues(valuesOf('subjects')),
      chapters: cleanValues(valuesOf('chapters')),
      sections: cleanValues(valuesOf('sections')),
      questionTypes: cleanValues(valuesOf('questionTypes')),
    };
  }

  /**
   * The `$match` for one facet: the selected taxonomy fields EXCEPT the one this facet distinct-ifies,
   * so a facet is narrowed by its siblings but never by itself (which would collapse it to the single
   * chosen value). `section_name` is never a selection input, so its facet just gets the full match.
   */
  private optionsMatch(selection: CatalogFilterSelection, excludeField: string): Record<string, unknown> {
    const match: Record<string, unknown> = {};
    if (selection.exam && excludeField !== 'exam_name') match.exam_name = selection.exam;
    if (selection.subject && excludeField !== 'subject') match.subject = selection.subject;
    if (selection.chapter && excludeField !== 'chapter') match.chapter = selection.chapter;
    if (selection.questionType && excludeField !== 'question_type') match.question_type = selection.questionType;
    return match;
  }

  /** Map the taxonomy filters + keyword to the collection's snake_case query shape. */
  private buildFilter(filters: CatalogFilters): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (filters.exam) filter.exam_name = filters.exam;
    if (filters.subject) filter.subject = filters.subject;
    if (filters.chapter) filter.chapter = filters.chapter;
    if (filters.section) filter.section_name = filters.section;
    if (filters.questionType) filter.question_type = filters.questionType;
    if (filters.flagged === true) filter.flagged = true;
    // "Not flagged" includes rows where the field is false, null, or absent — legacy rows have no flag.
    else if (filters.flagged === false) filter.flagged = { $ne: true };

    const keyword = filters.q?.trim() ?? '';
    if (keyword.length >= MIN_SEARCH_LENGTH) {
      const pattern = escapeRegex(keyword);
      filter.$or = [
        { question_text: { $regex: pattern, $options: 'i' } },
        { options: { $regex: pattern, $options: 'i' } },
      ];
    }
    return filter;
  }

  /** Pull the `firstBatch` out of a raw `find` reply and parse each document, dropping junk. */
  private readBatch(result: unknown): CatalogQuestion[] {
    const questions: CatalogQuestion[] = [];
    for (const item of firstBatch(result)) {
      const parsed = RawCatalogQuestionSchema.safeParse(item);
      if (parsed.success) questions.push(parsed.data);
    }
    return questions;
  }
}
