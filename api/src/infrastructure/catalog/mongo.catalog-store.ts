import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { CatalogQuestion, CatalogSort, MatchData } from '@ingest/contracts';
import { AiFilledSchema, MatchDataSchema } from '@ingest/contracts';
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
 * Assemble the bank's separate `match_columns` + `match_key` (written at publish for MATRIX questions)
 * into the shared {@link MatchData} shape, or null when the row is not a matrix question. Validated
 * against the contract so a malformed stored table degrades to null — the flat `answer` still shows the
 * matching — rather than making the whole browse response fail the client's schema parse.
 */
function toMatchData(columns: unknown, key: unknown): MatchData | null {
  if (columns === null || columns === undefined) return null;
  const parsed = MatchDataSchema.safeParse({ columns, key: key ?? {} });
  return parsed.success ? parsed.data : null;
}

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
    // Worked solution/explanation and structured match data are written at publish; surfaced here so the
    // browse renders the same complete question the bank stores. `match_*` stay unknown and are validated
    // by {@link toMatchData}. All absent on ordinary/legacy rows.
    explanation: z.string().nullable().catch(null),
    match_columns: z.unknown(),
    match_key: z.unknown(),
    exam_name: z.string().nullable().catch(null),
    subject: z.string().nullable().catch(null),
    chapter: z.string().nullable().catch(null),
    section_name: z.string().nullable().catch(null),
    question_type: z.string().nullable().catch(null),
    topic: z.string().nullable().catch(null),
    // Comprehension grouping (BLA-125), stamped at publish; null/absent on ordinary and legacy rows.
    passage: z.string().nullable().catch(null),
    passage_image: z.string().nullable().catch(null),
    group_id: z.string().nullable().catch(null),
    group_order: ejsonNumber.nullable().catch(null),
    flagged: ejsonBool.catch(false),
    // PYQ provenance stamped at publish; absent/false on non-PYQ and legacy rows.
    is_pyq: ejsonBool.catch(false),
    pyq_exam: z.string().nullable().catch(null),
    pyq_year: z.string().nullable().catch(null),
    // Provenance stamped at publish (null on legacy rows) — only `document_id` is needed here, to let
    // the browse card reopen the source in Verify. Tolerant so a malformed ref degrades to null.
    ingest_ref: z.object({ document_id: z.string() }).nullable().catch(null),
    options: z.array(z.string()).catch([]),
    isQuestionImage: ejsonBool.catch(false),
    question_image: z.string().nullable().catch(null),
    isOptionImage: ejsonBool.catch(false),
    option_images: z.array(z.string()).catch([]),
    // AI provenance written by the quality screens; a malformed tag is dropped rather than half-trusted.
    ai_filled: AiFilledSchema.catch({}),
  })
  .transform(
    (doc): CatalogQuestion => ({
      id: doc._id,
      questionNumber: doc.question_number,
      fileName: doc.file_name,
      questionText: doc.question_text,
      answer: doc.answer,
      explanation: doc.explanation,
      exam: doc.exam_name,
      subject: doc.subject,
      chapter: doc.chapter,
      section: doc.section_name,
      questionType: doc.question_type,
      topic: doc.topic,
      passage: doc.passage,
      passageImage: doc.passage_image,
      groupId: doc.group_id,
      groupOrder: doc.group_order,
      flagged: doc.flagged,
      isPyq: doc.is_pyq,
      pyqExam: doc.pyq_exam,
      pyqYear: doc.pyq_year,
      documentId: doc.ingest_ref?.document_id ?? null,
      options: doc.options,
      isQuestionImage: doc.isQuestionImage,
      questionImage: doc.question_image,
      isOptionImage: doc.isOptionImage,
      optionImages: doc.option_images,
      match: toMatchData(doc.match_columns, doc.match_key),
      aiFilled: doc.ai_filled,
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
    // The ingest taxonomy sources, unioned into the filter options so a value entered in Cut & Upload
    // v2 shows in the dropdowns before any question of it is published. Their `@@map` collection names.
    private readonly documentCollection = 'ingest_documents',
    private readonly sessionCollection = 'ingest_sessions',
  ) {}

  async listQuestions(
    filters: CatalogFilters,
    sort: CatalogSort,
    cursor: string | null,
    limit: number,
  ): Promise<CatalogQuestionPage> {
    // `total` counts the whole filtered set (no cursor), so it stays constant across pages; the page
    // window is the cursor-bounded `find`. Both share the same filter and run concurrently.
    const filter = this.buildFilter(filters);
    // Sort on `_id` (which encodes creation time): newest = descending, oldest = ascending. The cursor
    // walks in the SAME direction — `$lt` for descending, `$gt` for ascending — so paging past the last
    // row of a page always fetches the NEXT rows in the chosen order. Grouping still holds: a group's
    // consecutive-id siblings stay contiguous whichever way the id sequence is read.
    const direction = sort === 'oldest' ? 1 : -1;
    const beyondCursor = direction === 1 ? { $gt: { $oid: cursor } } : { $lt: { $oid: cursor } };
    const pageFilter = cursor ? { ...filter, _id: beyondCursor } : filter;
    const findCommand = {
      find: this.collection,
      filter: pageFilter,
      sort: { _id: direction },
      // Over-fetch by one to detect (and produce the cursor for) a next page.
      limit: limit + 1,
    } as unknown as Prisma.InputJsonObject;
    const countCommand = { count: this.collection, query: filter } as unknown as Prisma.InputJsonObject;

    const [findReply, countReply] = await Promise.all([
      this.prisma.$runCommandRaw(findCommand),
      this.prisma.$runCommandRaw(countCommand),
    ]);

    const rows = this.readBatch(findReply);
    const hasMore = rows.length > limit;
    const questions = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (questions[questions.length - 1]?.id ?? null) : null;
    const total = ejsonNumber.catch(0).parse((countReply as Record<string, unknown>).n ?? 0);
    return { questions, nextCursor, total };
  }

  async filterOptions(selection: CatalogFilterSelection): Promise<CatalogFilterOptionSets> {
    // Each dropdown is the UNION of the published `Question` collection and the ingest taxonomy, so a
    // value typed in Cut & Upload v2 appears before any question of it is published. Exam/subject live
    // only on the session (a document has no exam/subject column); module/chapter/section/type live on
    // the document (module also on the session). Three collections → three `$facet` reads, unioned in
    // JS. Each facet is narrowed by the OTHER selected fields it *has* (never its own), so the cascade
    // holds where the field exists — module narrows chapter via the document's `path`.
    const [published, docs, sessions] = await Promise.all([
      this.runFacets(this.collection, [
        { name: 'exams', field: 'exam_name', match: this.publishedMatch(selection, 'exam_name') },
        { name: 'subjects', field: 'subject', match: this.publishedMatch(selection, 'subject') },
        { name: 'chapters', field: 'chapter', match: this.publishedMatch(selection, 'chapter') },
        { name: 'sections', field: 'section_name', match: this.publishedMatch(selection, 'section_name') },
        { name: 'questionTypes', field: 'question_type', match: this.publishedMatch(selection, 'question_type') },
      ]),
      this.runFacets(this.documentCollection, [
        { name: 'modules', field: 'path.module', match: this.documentMatch(selection, 'path.module') },
        { name: 'chapters', field: 'path.chapter', match: this.documentMatch(selection, 'path.chapter') },
        { name: 'sectionsPath', field: 'path.section', match: this.documentMatch(selection, 'path.section') },
        { name: 'sectionsName', field: 'sectionName', match: this.documentMatch(selection, 'path.section') },
        { name: 'questionTypes', field: 'questionType', match: this.documentMatch(selection, 'questionType') },
      ]),
      this.runFacets(this.sessionCollection, [
        { name: 'exams', field: 'exam', match: this.sessionMatch(selection, 'exam') },
        { name: 'subjects', field: 'subject', match: this.sessionMatch(selection, 'subject') },
        { name: 'modules', field: 'module', match: this.sessionMatch(selection, 'module') },
      ]),
    ]);

    const pick = (sets: Record<string, string[]>, name: string): string[] => sets[name] ?? [];
    return {
      exams: cleanValues([...pick(published, 'exams'), ...pick(sessions, 'exams')]),
      subjects: cleanValues([...pick(published, 'subjects'), ...pick(sessions, 'subjects')]),
      modules: cleanValues([...pick(sessions, 'modules'), ...pick(docs, 'modules')]),
      chapters: cleanValues([...pick(published, 'chapters'), ...pick(docs, 'chapters')]),
      sections: cleanValues([
        ...pick(published, 'sections'),
        ...pick(docs, 'sectionsPath'),
        ...pick(docs, 'sectionsName'),
      ]),
      questionTypes: cleanValues([...pick(published, 'questionTypes'), ...pick(docs, 'questionTypes')]),
    };
  }

  /**
   * Run one `$facet` distinct-per-field aggregation over `collection` and return each facet's cleaned
   * values keyed by its `name`. One `$addToSet` group per spec, matched by that spec's cascade filter.
   */
  private async runFacets(
    collection: string,
    specs: readonly { name: string; field: string; match: Record<string, unknown> }[],
  ): Promise<Record<string, string[]>> {
    const facets: Record<string, unknown> = {};
    for (const spec of specs) {
      facets[spec.name] = [
        { $match: spec.match },
        { $group: { _id: null, values: { $addToSet: `$${spec.field}` } } },
      ];
    }
    const command = {
      aggregate: collection,
      pipeline: [{ $facet: facets }],
      cursor: {},
    } as unknown as Prisma.InputJsonObject;

    const doc = firstBatch(await this.prisma.$runCommandRaw(command))[0] as
      | Record<string, Array<{ values?: unknown }> | undefined>
      | undefined;
    const result: Record<string, string[]> = {};
    for (const spec of specs) result[spec.name] = cleanValues(doc?.[spec.name]?.[0]?.values);
    return result;
  }

  /**
   * The `$match` for a published-`Question` facet: the selected taxonomy fields EXCEPT the one this
   * facet distinct-ifies, so a facet is narrowed by its siblings but never by itself. `module` and
   * `section_name` are not columns on this collection, so they never constrain it.
   */
  private publishedMatch(selection: CatalogFilterSelection, excludeField: string): Record<string, unknown> {
    const match: Record<string, unknown> = {};
    if (selection.exam && excludeField !== 'exam_name') match.exam_name = selection.exam;
    if (selection.subject && excludeField !== 'subject') match.subject = selection.subject;
    if (selection.chapter && excludeField !== 'chapter') match.chapter = selection.chapter;
    if (selection.questionType && excludeField !== 'question_type') match.question_type = selection.questionType;
    return match;
  }

  /** The `$match` for an `ingest_documents` facet — narrowed by the selection fields a document carries. */
  private documentMatch(selection: CatalogFilterSelection, excludeField: string): Record<string, unknown> {
    const match: Record<string, unknown> = {};
    if (selection.module && excludeField !== 'path.module') match['path.module'] = selection.module;
    if (selection.chapter && excludeField !== 'path.chapter') match['path.chapter'] = selection.chapter;
    if (selection.questionType && excludeField !== 'questionType') match.questionType = selection.questionType;
    return match;
  }

  /** The `$match` for an `ingest_sessions` facet — narrowed by the selection fields a session carries. */
  private sessionMatch(selection: CatalogFilterSelection, excludeField: string): Record<string, unknown> {
    const match: Record<string, unknown> = {};
    if (selection.exam && excludeField !== 'exam') match.exam = selection.exam;
    if (selection.subject && excludeField !== 'subject') match.subject = selection.subject;
    if (selection.module && excludeField !== 'module') match.module = selection.module;
    return match;
  }

  /** Map the taxonomy filters + keyword to the collection's snake_case query shape. */
  private buildFilter(filters: CatalogFilters): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    // `$or` clauses (comprehension membership, keyword) are collected here and ANDed together, so two
    // of them never collide on a single top-level `$or` key.
    const and: Record<string, unknown>[] = [];
    if (filters.exam) filter.exam_name = filters.exam;
    if (filters.subject) filter.subject = filters.subject;
    // `module` is stamped onto the bank row at publish, so the Module dropdown now narrows the list.
    if (filters.module) filter.module = filters.module;
    if (filters.chapter) filter.chapter = filters.chapter;
    if (filters.section) filter.section_name = filters.section;
    // "comprehension" is NOT a per-row type — each sub-question keeps its own type (single_correct …),
    // and the group is identified by `group_id`. So the type filter means "belongs to a comprehension
    // group" (or a legacy row literally typed so), not `question_type == 'comprehension'`.
    if (filters.questionType?.toLowerCase() === 'comprehension') {
      and.push({ $or: [{ group_id: { $ne: null } }, { question_type: filters.questionType }] });
    } else if (filters.questionType) {
      filter.question_type = filters.questionType;
    }
    if (filters.flagged === true) filter.flagged = true;
    // "Not flagged" includes rows where the field is false, null, or absent — legacy rows have no flag.
    else if (filters.flagged === false) filter.flagged = { $ne: true };
    if (filters.pyq === true) filter.is_pyq = true;
    // "Not PYQ" includes rows where the field is false, null, or absent — legacy rows have no PYQ flag.
    else if (filters.pyq === false) filter.is_pyq = { $ne: true };

    // "Content" edge-case filters (the browse image/structure checkboxes). Include-only: a checkbox is
    // on (narrow to rows that HAVE the feature) or absent, so only the `=== true` case constrains. A
    // question can carry an image as either the boolean flag OR the URL column (legacy rows set only the
    // column), so those go through an `$or` pushed into `and[]` — never a colliding top-level `$or`. A
    // string column counts as an image only when non-null AND non-empty; an array only when it has a
    // non-empty element.
    if (filters.hasQuestionImage === true) {
      and.push({ $or: [{ isQuestionImage: true }, { question_image: { $nin: [null, ''] } }] });
    }
    if (filters.hasOptionImage === true) {
      and.push({ $or: [{ isOptionImage: true }, { option_images: { $elemMatch: { $nin: [null, ''] } } }] });
    }
    if (filters.hasPassageImage === true) filter.passage_image = { $nin: [null, ''] };
    // "Has any image" spans every place a figure can live — question, options, passage, AND inside a
    // matrix's cells (`match_columns[].entries[].image`), which is a distinct image location the other
    // fields miss. A `$nin` must sit under `$elemMatch` on an array so it means "at least one non-empty
    // element", not "no element is empty".
    if (filters.hasImage === true) {
      and.push({
        $or: [
          { isQuestionImage: true },
          { question_image: { $nin: [null, ''] } },
          { isOptionImage: true },
          { option_images: { $elemMatch: { $nin: [null, ''] } } },
          { passage_image: { $nin: [null, ''] } },
          { match_columns: { $elemMatch: { entries: { $elemMatch: { image: { $nin: [null, ''] } } } } } },
        ],
      });
    }
    // A comprehension member is identified by its `group_id` (the shared passage's id); `passage`
    // non-empty also catches a legacy row that carried the passage text without a group id.
    if (filters.hasPassage === true) {
      and.push({ $or: [{ group_id: { $nin: [null, ''] } }, { passage: { $nin: [null, ''] } }] });
    }
    // Matrix-match presence keys off the structured `match_columns` (null on every other type), which
    // is more reliable than the free-text question_type string a matrix row might be mislabelled with.
    if (filters.hasMatch === true) filter.match_columns = { $ne: null };
    // The tag set is removed whole when its last field is untagged, so its presence means "some AI data".
    if (filters.aiFilled === true) filter.ai_filled = { $type: 'object' };

    const keyword = filters.q?.trim() ?? '';
    if (keyword.length >= MIN_SEARCH_LENGTH) {
      const pattern = escapeRegex(keyword);
      // `passage` is matched too, and — being denormalized onto every sibling row — a passage keyword
      // returns the whole comprehension group, not just one sub-question.
      and.push({
        $or: [
          { question_text: { $regex: pattern, $options: 'i' } },
          { options: { $regex: pattern, $options: 'i' } },
          { passage: { $regex: pattern, $options: 'i' } },
        ],
      });
    }
    if (and.length > 0) filter.$and = and;
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
