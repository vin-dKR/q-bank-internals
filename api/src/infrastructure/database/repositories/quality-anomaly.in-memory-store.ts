import type {
  Anomaly,
  AnomalyKind,
  AnomalyKindCount,
  AnomalySeverity,
  AnomalyStatus,
  FixQueuePage,
  QualityFilterOptions,
} from '@ingest/contracts';
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
import { objectIdDate } from '../mongo-ejson.js';

type StoredAnomaly = Omit<Anomaly, 'questionAddedAt'> & { key: string };

/** The contract shape of a stored row: the reconcile key stays internal, the added date is derived. */
const toAnomaly = ({ key: _key, ...anomaly }: StoredAnomaly): Anomaly => ({
  ...anomaly,
  questionAddedAt: objectIdDate(anomaly.questionId)?.toISOString() ?? null,
});

/** The worst severity present on a question — how its queue row is ranked and badged. */
function worstSeverity(severities: AnomalySeverity[]): AnomalySeverity {
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'low';
}

/** In-memory {@link AnomalyStore} (dev). Anomalies live for the process lifetime only. */
export class InMemoryQualityAnomalyStore implements AnomalyStore {
  private readonly rows = new Map<string, StoredAnomaly>();
  private sequence = 0;

  listTracked(): Promise<TrackedAnomaly[]> {
    return Promise.resolve(
      [...this.rows.values()].map(({ id, key, questionId, status }) => ({ id, key, questionId, status })),
    );
  }

  deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) this.rows.delete(id);
    return Promise.resolve();
  }

  createMany(anomalies: DetectedAnomaly[], seenAt: Date): Promise<void> {
    const at = seenAt.toISOString();
    for (const anomaly of anomalies) {
      this.sequence += 1;
      // Zero-padded so ids sort like the Mongo ObjectIds they stand in for (and pass the cursor format).
      const id = this.sequence.toString(16).padStart(24, '0');
      this.rows.set(id, { ...anomaly, id, status: 'open', firstSeenAt: at, lastSeenAt: at, resolvedAt: null });
    }
    return Promise.resolve();
  }

  refreshMany(updates: { id: string; anomaly: DetectedAnomaly }[], seenAt: Date): Promise<void> {
    for (const { id, anomaly } of updates) {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, ...anomaly, id, lastSeenAt: seenAt.toISOString() });
    }
    return Promise.resolve();
  }

  setStatus(ids: string[], status: AnomalyStatus, resolvedAt: Date | null): Promise<void> {
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, status, resolvedAt: resolvedAt ? resolvedAt.toISOString() : null });
    }
    return Promise.resolve();
  }

  list(filters: AnomalyFilters, cursor: string | null, limit: number): Promise<AnomalyListPage> {
    const q = filters.q?.toLowerCase();
    const matching = [...this.rows.values()]
      .filter(
        (row) =>
          row.status === filters.status &&
          (!filters.group || row.group === filters.group) &&
          (!filters.kind || row.kind === filters.kind) &&
          (!filters.severity || row.severity === filters.severity) &&
          (!filters.exam || row.exam === filters.exam) &&
          (!filters.subject || row.subject === filters.subject) &&
          (!filters.chapter || row.chapter === filters.chapter) &&
          (!q ||
            row.preview.toLowerCase().includes(q) ||
            (row.fileName?.toLowerCase().includes(q) ?? false) ||
            row.questionId === filters.q),
      )
      .sort((a, b) => b.id.localeCompare(a.id));
    const start = cursor ? matching.findIndex((row) => row.id === cursor) + 1 : 0;
    const page = matching.slice(start, start + limit);
    const hasMore = start + limit < matching.length;
    return Promise.resolve({
      anomalies: page.map(toAnomaly),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      total: matching.length,
    });
  }

  listByQuestion(questionId: string): Promise<Anomaly[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.questionId === questionId).map(toAnomaly),
    );
  }

  async queue(filters: AnomalyFilters, cursor: string | null, limit: number): Promise<FixQueuePage> {
    const { anomalies } = await this.list(filters, null, Number.MAX_SAFE_INTEGER);
    const byQuestion = new Map<string, Anomaly[]>();
    for (const anomaly of anomalies) {
      byQuestion.set(anomaly.questionId, [...(byQuestion.get(anomaly.questionId) ?? []), anomaly]);
    }
    const items = [...byQuestion.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([questionId, rows]) => {
        const [first] = rows;
        if (!first) throw new Error(`Empty anomaly group for question "${questionId}".`);
        return {
          questionId,
          subject: first.subject,
          chapter: first.chapter,
          questionNumber: first.questionNumber,
          fileName: first.fileName,
          preview: first.preview,
          severity: worstSeverity(rows.map((row) => row.severity)),
          anomalyCount: rows.length,
          kinds: [...new Set(rows.map((row) => row.kind))],
          questionAddedAt: first.questionAddedAt,
        };
      });
    const start = cursor ? items.findIndex((item) => item.questionId === cursor) + 1 : 0;
    const page = items.slice(start, start + limit);
    return {
      items: page,
      nextCursor: start + limit < items.length ? (page[page.length - 1]?.questionId ?? null) : null,
      total: items.length,
    };
  }

  filterOptions(filters: AnomalyFilters): Promise<QualityFilterOptions> {
    const rows = [...this.rows.values()];
    const matches = (row: StoredAnomaly, except: 'exam' | 'subject' | 'chapter'): boolean =>
      row.status === filters.status &&
      (!filters.group || row.group === filters.group) &&
      (!filters.kind || row.kind === filters.kind) &&
      (!filters.severity || row.severity === filters.severity) &&
      (except === 'exam' || !filters.exam || row.exam === filters.exam) &&
      (except === 'subject' || !filters.subject || row.subject === filters.subject) &&
      (except === 'chapter' || !filters.chapter || row.chapter === filters.chapter);
    const values = (field: 'exam' | 'subject' | 'chapter'): string[] =>
      [
        ...new Set(
          rows
            .filter((row) => matches(row, field))
            .map((row) => row[field])
            .filter((value): value is string => value !== null && value !== ''),
        ),
      ].sort((a, b) => a.localeCompare(b));

    // Per-rule counts ignore the chosen group/rule, exactly as the Mongo store does.
    const counts = new Map<AnomalyKind, number>();
    const q = filters.q?.toLowerCase();
    for (const row of rows) {
      const inScope =
        row.status === filters.status &&
        (!filters.severity || row.severity === filters.severity) &&
        (!filters.exam || row.exam === filters.exam) &&
        (!filters.subject || row.subject === filters.subject) &&
        (!filters.chapter || row.chapter === filters.chapter) &&
        (!q || row.preview.toLowerCase().includes(q) || (row.fileName?.toLowerCase().includes(q) ?? false));
      if (inScope) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
    }
    return Promise.resolve({
      exams: values('exam'),
      subjects: values('subject'),
      chapters: values('chapter'),
      byKind: [...counts].map(([kind, count]) => ({ kind, count })),
    });
  }

  totals(): Promise<AnomalyTotals> {
    const rows = [...this.rows.values()];
    const byKind = new Map<AnomalyKind, AnomalyKindCount>();
    const totals = { open: 0, ignored: 0, resolved: 0 };
    for (const row of rows) {
      const counts = byKind.get(row.kind) ?? { kind: row.kind, open: 0, ignored: 0, resolved: 0 };
      counts[row.status] += 1;
      totals[row.status] += 1;
      byKind.set(row.kind, counts);
    }
    const distinct = (values: (string | null)[]): string[] =>
      [...new Set(values.filter((value): value is string => value !== null && value !== ''))].sort((a, b) =>
        a.localeCompare(b),
      );
    const openBy = (field: 'subject' | 'chapter'): AnomalyPlaceCount[] => {
      const places = new Map<string, { open: number; questions: Set<string> }>();
      for (const row of rows.filter((candidate) => candidate.status === 'open')) {
        const name = row[field] ?? '(none)';
        const place = places.get(name) ?? { open: 0, questions: new Set<string>() };
        place.open += 1;
        place.questions.add(row.questionId);
        places.set(name, place);
      }
      return [...places.entries()]
        .map(([name, place]) => ({ name, open: place.open, questions: place.questions.size }))
        .sort((a, b) => b.open - a.open);
    };
    return Promise.resolve({
      ...totals,
      questionsWithOpen: new Set(rows.filter((row) => row.status === 'open').map((row) => row.questionId)).size,
      byKind: [...byKind.values()],
      bySubject: openBy('subject'),
      byChapter: openBy('chapter'),
      subjects: distinct(rows.map((row) => row.subject)),
      chapters: distinct(rows.map((row) => row.chapter)),
    });
  }

  updateStatus(id: string, status: ReviewStatus): Promise<Anomaly | null> {
    const row = this.rows.get(id);
    if (!row) return Promise.resolve(null);
    const updated = { ...row, status, resolvedAt: null };
    this.rows.set(id, updated);
    return Promise.resolve(toAnomaly(updated));
  }
}
