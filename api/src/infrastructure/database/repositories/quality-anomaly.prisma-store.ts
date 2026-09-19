import type { Prisma, PrismaClient, QualityAnomaly as AnomalyRow } from '@prisma/client';
import { z } from 'zod';
import {
  AnomalyKindSchema,
  AnomalySchema,
  AnomalyStatusSchema,
  type Anomaly,
  type AnomalyKind,
  type AnomalyKindCount,
  type AnomalySeverity,
  type AnomalyStatus,
  type FixQueuePage,
  type QualityFilterOptions,
} from '@ingest/contracts';
import { errors } from '../../../shared/errors/error-catalog.js';
import type {
  AnomalyFilters,
  AnomalyListPage,
  AnomalyPlaceCount,
  AnomalyStore,
  AnomalyTotals,
  DetectedAnomaly,
  ReviewStatus,
  TrackedAnomaly,
} from '../../../modules/quality/index.js';
import { ejsonNumber, escapeRegex, objectIdDate } from '../mongo-ejson.js';

/** The `@@map` name of the QualityAnomaly model, for the raw bulk update. */
const COLLECTION = 'ingest_quality_anomalies';

/** Rows per write round-trip. A full first scan creates thousands of rows. */
const WRITE_CHUNK = 500;

const OBJECT_ID = /^[a-f\d]{24}$/i;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** Map a stored row to the contract shape; a row whose kind was retired from the rule set is skipped. */
function toAnomaly(row: AnomalyRow): Anomaly | null {
  const parsed = AnomalySchema.safeParse({
    ...row,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    questionAddedAt: objectIdDate(row.questionId)?.toISOString() ?? null,
  });
  return parsed.success ? parsed.data : null;
}

/** The snapshot + detail columns a scan (re)writes on every row it sees. */
function snapshot(anomaly: DetectedAnomaly): Omit<DetectedAnomaly, 'key' | 'questionId' | 'kind' | 'field'> {
  return {
    ingestQuestionId: anomaly.ingestQuestionId,
    documentId: anomaly.documentId,
    group: anomaly.group,
    severity: anomaly.severity,
    detail: anomaly.detail,
    exam: anomaly.exam,
    subject: anomaly.subject,
    chapter: anomaly.chapter,
    questionType: anomaly.questionType,
    questionNumber: anomaly.questionNumber,
    fileName: anomaly.fileName,
    preview: anomaly.preview,
  };
}

const UpdateReplySchema = z.object({
  writeErrors: z.array(z.object({ errmsg: z.string().catch('') })).catch([]),
});

const CountSchema = z.array(z.object({ n: ejsonNumber })).catch([]);

const KindCountRowsSchema = z.array(z.object({ _id: z.string(), count: ejsonNumber })).catch([]);

const PlaceRowsSchema = z
  .array(z.object({ _id: z.string().catch('(none)'), open: ejsonNumber, questions: ejsonNumber }))
  .catch([]);

/** Subjects are few enough to show in full; chapters are not, so only the worst are returned. */
const ALL_PLACES = 50;
const WORST_CHAPTERS = 12;
const DistinctSchema = z.array(z.object({ _id: z.string() })).catch([]);

const QueueRowsSchema = z
  .array(
    z.object({
      _id: z.string(),
      count: ejsonNumber,
      kinds: z.array(z.string()).catch([]),
      severities: z.array(z.string()).catch([]),
      subject: z.string().nullable().catch(null),
      chapter: z.string().nullable().catch(null),
      questionNumber: ejsonNumber.nullable().catch(null),
      fileName: z.string().nullable().catch(null),
      preview: z.string().catch(''),
    }),
  )
  .catch([]);

/** The worst severity present on a question — how its queue row is ranked and badged. */
function worstSeverity(severities: string[]): AnomalySeverity {
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'low';
}

/**
 * The same constraints as {@link toWhere}, as a raw Mongo `$match`. `except` drops one taxonomy field, so a
 * cascading dropdown is narrowed by its siblings but never by its own current value.
 */
function toMatch(filters: AnomalyFilters, except?: 'exam' | 'subject' | 'chapter'): Record<string, unknown> {
  const match: Record<string, unknown> = { status: filters.status };
  if (filters.group) match.group = filters.group;
  if (filters.kind) match.kind = filters.kind;
  if (filters.severity) match.severity = filters.severity;
  if (filters.exam && except !== 'exam') match.exam = filters.exam;
  if (filters.subject && except !== 'subject') match.subject = filters.subject;
  if (filters.chapter && except !== 'chapter') match.chapter = filters.chapter;
  if (filters.q) {
    const pattern = escapeRegex(filters.q);
    match.$or = [
      { preview: { $regex: pattern, $options: 'i' } },
      { fileName: { $regex: pattern, $options: 'i' } },
      { questionId: filters.q },
    ];
  }
  return match;
}

function toWhere(filters: AnomalyFilters): Prisma.QualityAnomalyWhereInput {
  const where: Prisma.QualityAnomalyWhereInput = { status: filters.status };
  if (filters.group) where.group = filters.group;
  if (filters.kind) where.kind = filters.kind;
  if (filters.severity) where.severity = filters.severity;
  if (filters.exam) where.exam = filters.exam;
  if (filters.subject) where.subject = filters.subject;
  if (filters.chapter) where.chapter = filters.chapter;
  if (filters.q) {
    where.OR = [
      { preview: { contains: filters.q, mode: 'insensitive' } },
      { fileName: { contains: filters.q, mode: 'insensitive' } },
      { questionId: filters.q },
    ];
  }
  return where;
}

/** Prisma/Mongo {@link AnomalyStore} over `ingest_quality_anomalies`. */
export class PrismaQualityAnomalyStore implements AnomalyStore {
  constructor(private readonly prisma: PrismaClient) {}

  listTracked(): Promise<TrackedAnomaly[]> {
    return this.prisma.qualityAnomaly
      .findMany({ select: { id: true, key: true, questionId: true, status: true } })
      .then((rows) =>
        rows.flatMap((row) => {
          const status = AnomalyStatusSchema.safeParse(row.status);
          return status.success ? [{ id: row.id, key: row.key, questionId: row.questionId, status: status.data }] : [];
        }),
      );
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const rows of chunk(ids, WRITE_CHUNK)) {
      await this.prisma.qualityAnomaly.deleteMany({ where: { id: { in: rows } } });
    }
  }

  async createMany(anomalies: DetectedAnomaly[], seenAt: Date): Promise<void> {
    for (const rows of chunk(anomalies, WRITE_CHUNK)) {
      await this.prisma.qualityAnomaly.createMany({
        data: rows.map((anomaly) => ({
          ...snapshot(anomaly),
          key: anomaly.key,
          questionId: anomaly.questionId,
          kind: anomaly.kind,
          field: anomaly.field,
          status: 'open',
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          resolvedAt: null,
        })),
      });
    }
  }

  async refreshMany(updates: { id: string; anomaly: DetectedAnomaly }[], seenAt: Date): Promise<void> {
    // One raw `update` command per chunk: every row gets different values, and per-row Prisma updates would
    // be a round-trip each — thousands per scan.
    for (const rows of chunk(updates, WRITE_CHUNK)) {
      const command = {
        update: COLLECTION,
        updates: rows.map(({ id, anomaly }) => {
          const { questionNumber, ...rest } = snapshot(anomaly);
          return {
            q: { _id: { $oid: id } },
            u: {
              $set: {
                ...rest,
                // Explicit int so Prisma reads it back as the model's `Int`, not a double.
                questionNumber: questionNumber === null ? null : { $numberInt: String(Math.trunc(questionNumber)) },
                lastSeenAt: { $date: seenAt.toISOString() },
              },
            },
          };
        }),
        ordered: false,
      } as unknown as Prisma.InputJsonObject;
      const reply = UpdateReplySchema.parse(await this.prisma.$runCommandRaw(command));
      const [first] = reply.writeErrors;
      if (first) throw errors.qualityWriteFailed(`${String(reply.writeErrors.length)} refresh writes failed (${first.errmsg}).`);
    }
  }

  async setStatus(ids: string[], status: AnomalyStatus, resolvedAt: Date | null): Promise<void> {
    for (const rows of chunk(ids, WRITE_CHUNK)) {
      await this.prisma.qualityAnomaly.updateMany({ where: { id: { in: rows } }, data: { status, resolvedAt } });
    }
  }

  async list(filters: AnomalyFilters, cursor: string | null, limit: number): Promise<AnomalyListPage> {
    const where = toWhere(filters);
    const [rows, total] = await Promise.all([
      this.prisma.qualityAnomaly.findMany({
        where,
        orderBy: { id: 'desc' },
        // Over-fetch by one to detect (and produce the cursor for) a next page.
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.qualityAnomaly.count({ where }),
    ]);
    const page = rows.slice(0, limit);
    return {
      anomalies: page.map(toAnomaly).filter((anomaly): anomaly is Anomaly => anomaly !== null),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async listByQuestion(questionId: string): Promise<Anomaly[]> {
    if (!OBJECT_ID.test(questionId)) return [];
    const rows = await this.prisma.qualityAnomaly.findMany({ where: { questionId } });
    return rows.map(toAnomaly).filter((anomaly): anomaly is Anomaly => anomaly !== null);
  }

  /**
   * The filtered anomalies rolled up to one row per question. Grouped in the database (an aggregation over
   * the same filter) rather than by paging anomalies, so a question with eight problems still costs one row
   * and the page size means "questions", not "problems".
   */
  async queue(filters: AnomalyFilters, cursor: string | null, limit: number): Promise<FixQueuePage> {
    // Prisma types a raw pipeline stage as `InputJsonValue`, which cannot express a dynamically built
    // filter object; the value IS valid JSON, so it is asserted once here rather than at every stage.
    const match = toMatch(filters) as Prisma.InputJsonObject;
    const grouped = {
      $group: {
        _id: '$questionId',
        count: { $sum: 1 },
        kinds: { $addToSet: '$kind' },
        severities: { $addToSet: '$severity' },
        subject: { $first: '$subject' },
        chapter: { $first: '$chapter' },
        questionNumber: { $first: '$questionNumber' },
        fileName: { $first: '$fileName' },
        preview: { $first: '$preview' },
      },
    };
    // Newest question first, and the cursor walks the same descending id order. The grouped `_id` is the
    // question id as STORED — a plain string — so the cursor is compared as a string: Mongo never matches a
    // string against an ObjectId, which left every page after the first empty. Fixed-length lowercase hex
    // sorts the same as the ObjectIds it spells, so the order is unchanged.
    const pageMatch = cursor ? [{ $match: { _id: { $lt: cursor.toLowerCase() } } }] : [];
    const [page, counted] = await Promise.all([
      this.prisma.qualityAnomaly.aggregateRaw({
        pipeline: [{ $match: match }, grouped, ...pageMatch, { $sort: { _id: -1 } }, { $limit: limit + 1 }],
      }),
      this.prisma.qualityAnomaly.aggregateRaw({
        pipeline: [{ $match: match }, { $group: { _id: '$questionId' } }, { $count: 'n' }],
      }),
    ]);

    const rows = QueueRowsSchema.parse(page);
    const items = rows.slice(0, limit).map((row) => ({
      questionId: row._id,
      subject: row.subject,
      chapter: row.chapter,
      questionNumber: row.questionNumber,
      fileName: row.fileName,
      preview: row.preview,
      severity: worstSeverity(row.severities),
      anomalyCount: row.count,
      kinds: row.kinds.flatMap((kind) => {
        const parsed = AnomalyKindSchema.safeParse(kind);
        return parsed.success ? [parsed.data] : [];
      }),
      questionAddedAt: objectIdDate(row._id)?.toISOString() ?? null,
    }));
    return {
      items,
      nextCursor: rows.length > limit ? (items[items.length - 1]?.questionId ?? null) : null,
      total: CountSchema.parse(counted)[0]?.n ?? 0,
    };
  }

  /**
   * One aggregation per dropdown, each matched by the OTHER selections: picking an exam shrinks the subject
   * and chapter lists, while the exam list itself still shows every exam that has anomalies in this view.
   */
  async filterOptions(filters: AnomalyFilters): Promise<QualityFilterOptions> {
    const [exams, subjects, chapters, byKind] = await Promise.all([
      this.distinctFor('exam', filters),
      this.distinctFor('subject', filters),
      this.distinctFor('chapter', filters),
      this.countsByKind(filters),
    ]);
    return { exams, subjects, chapters, byKind };
  }

  /** Per-rule counts for the current filters, with the chosen group/rule left out (see the contract). */
  private async countsByKind(filters: AnomalyFilters): Promise<{ kind: AnomalyKind; count: number }[]> {
    // Counted across every rule, so the group and rule already chosen are cleared rather than applied.
    const unscoped: AnomalyFilters = { ...filters };
    delete unscoped.group;
    delete unscoped.kind;
    const rows = await this.prisma.qualityAnomaly.aggregateRaw({
      pipeline: [
        { $match: toMatch(unscoped) as Prisma.InputJsonObject },
        { $group: { _id: '$kind', count: { $sum: 1 } } },
      ],
    });
    return KindCountRowsSchema.parse(rows).flatMap((row) => {
      const kind = AnomalyKindSchema.safeParse(row._id);
      return kind.success ? [{ kind: kind.data, count: row.count }] : [];
    });
  }

  private async distinctFor(field: 'exam' | 'subject' | 'chapter', filters: AnomalyFilters): Promise<string[]> {
    const rows = await this.prisma.qualityAnomaly.aggregateRaw({
      pipeline: [
        { $match: { ...toMatch(filters, field), [field]: { $nin: [null, ''] } } as Prisma.InputJsonObject },
        { $group: { _id: `$${field}` } },
      ],
    });
    return DistinctSchema.parse(rows)
      .map((row) => row._id)
      .sort((a, b) => a.localeCompare(b));
  }

  async totals(): Promise<AnomalyTotals> {
    const [grouped, openQuestions, subjects, chapters, bySubject, byChapter] = await Promise.all([
      this.prisma.qualityAnomaly.groupBy({ by: ['kind', 'status'], _count: { _all: true } }),
      this.prisma.qualityAnomaly.aggregateRaw({
        pipeline: [{ $match: { status: 'open' } }, { $group: { _id: '$questionId' } }, { $count: 'n' }],
      }),
      this.distinct('subject'),
      this.distinct('chapter'),
      this.openBy('subject', ALL_PLACES),
      this.openBy('chapter', WORST_CHAPTERS),
    ]);

    const byKind = new Map<AnomalyKind, AnomalyKindCount>();
    const totals = { open: 0, ignored: 0, resolved: 0 };
    for (const row of grouped) {
      const kind = AnomalyKindSchema.safeParse(row.kind);
      const status = AnomalyStatusSchema.safeParse(row.status);
      if (!kind.success || !status.success) continue;
      const counts = byKind.get(kind.data) ?? { kind: kind.data, open: 0, ignored: 0, resolved: 0 };
      counts[status.data] += row._count._all;
      totals[status.data] += row._count._all;
      byKind.set(kind.data, counts);
    }

    return {
      ...totals,
      questionsWithOpen: CountSchema.parse(openQuestions)[0]?.n ?? 0,
      byKind: [...byKind.values()],
      bySubject,
      byChapter,
      subjects,
      chapters,
    };
  }

  /**
   * Open problems grouped by subject or chapter, worst first. `$addToSet` on the question id makes the
   * second number DISTINCT QUESTIONS, so a question carrying five problems is counted once.
   */
  private async openBy(field: 'subject' | 'chapter', limit: number): Promise<AnomalyPlaceCount[]> {
    const rows = await this.prisma.qualityAnomaly.aggregateRaw({
      pipeline: [
        { $match: { status: 'open' } },
        { $group: { _id: { $ifNull: [`$${field}`, '(none)'] }, open: { $sum: 1 }, questions: { $addToSet: '$questionId' } } },
        { $project: { open: 1, questions: { $size: '$questions' } } },
        { $sort: { open: -1 } },
        { $limit: limit },
      ],
    });
    return PlaceRowsSchema.parse(rows).map((row) => ({ name: row._id, open: row.open, questions: row.questions }));
  }

  async updateStatus(id: string, status: ReviewStatus): Promise<Anomaly | null> {
    // A malformed id can match no row, and Prisma rejects it as an ObjectId before querying.
    if (!OBJECT_ID.test(id)) return null;
    const { count } = await this.prisma.qualityAnomaly.updateMany({
      where: { id },
      data: { status, resolvedAt: null },
    });
    if (count === 0) return null;
    const row = await this.prisma.qualityAnomaly.findUnique({ where: { id } });
    return row ? toAnomaly(row) : null;
  }

  /** Distinct non-empty values of a snapshot column, sorted, for the filter dropdowns. */
  private async distinct(field: 'subject' | 'chapter'): Promise<string[]> {
    const rows = await this.prisma.qualityAnomaly.aggregateRaw({
      pipeline: [{ $match: { [field]: { $nin: [null, ''] } } }, { $group: { _id: `$${field}` } }],
    });
    return DistinctSchema.parse(rows)
      .map((row) => row._id)
      .sort((a, b) => a.localeCompare(b));
  }
}
