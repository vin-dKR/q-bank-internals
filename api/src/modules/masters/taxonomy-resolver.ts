import type { TaxonomyDimension } from '@ingest/contracts';
import {
  type Canonical,
  canonicalizeMaster,
  deriveKindFromStructure,
  levelRank,
} from '../../shared/taxonomy/fold-maps.js';
import type { DictionaryRow, NewDictionaryRow, TaxonomyStore } from './masters.repository.js';

/** A resolved dictionary entry: the FK id + clean label (+ kind/rank for the closed dimensions). */
export type Resolved = { id: string; name: string; kind: string | null; rank: number | null };

/** The names a question is filed under, plus the structural signals that decide `questionKind`. */
export type QuestionTaxonomyInput = {
  exam?: string | null;
  subject?: string | null;
  module?: string | null;
  chapter?: string | null;
  section?: string | null;
  questionType?: string | null;
  level?: string | null;
  groupId?: unknown;
  passage?: unknown;
  matchColumns?: unknown;
  matchKey?: unknown;
};

/** Every additive FK/label field to stamp onto a bank question (all null when a name is junk/absent). */
export type ResolvedTaxonomy = {
  examId: string | null;
  examName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  moduleId: string | null;
  moduleName: string | null;
  chapterId: string | null;
  chapterName: string | null;
  sectionId: string | null;
  sectionLabel: string | null;
  questionTypeId: string | null;
  questionTypeName: string | null;
  questionKind: string | null;
  levelId: string | null;
  levelName: string | null;
  levelRank: number | null;
};

const CACHE_TTL_MS = 5 * 60_000;

/**
 * One dimension's cached find-or-create dictionary. The cache stores the load PROMISE so concurrent
 * first-callers share one `list`; per-key in-flight promises dedupe concurrent creates so a burst of
 * questions carrying the same brand-new value can never insert it twice.
 */
class DimensionDict {
  private cache: { at: number; rows: Promise<DictionaryRow[]> } | null = null;
  private inflight = new Map<string, Promise<Resolved | null>>();

  constructor(
    private readonly dimension: TaxonomyDimension,
    private readonly store: TaxonomyStore,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  /** The current dictionary rows (cached, no create) — the read the extractor injects into its prompt. */
  snapshot(): Promise<DictionaryRow[]> {
    return this.rows();
  }

  private rows(): Promise<DictionaryRow[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.rows;
    // Cache the PROMISE so concurrent callers share one list — but drop it on rejection, or a single
    // transient read failure would be cached for the whole TTL and keep failing after Mongo recovers.
    const rows = this.store.list(this.dimension, {}).catch((error: unknown) => {
      this.cache = null;
      throw error;
    });
    this.cache = { at: Date.now(), rows };
    return rows;
  }

  /**
   * raw name → resolved entry, creating the canonical row on first sight; junk/unknown → null.
   * `parentId` is the resolved subject (for a chapter) / chapter (for a topic) to scope a NEW row to.
   */
  async resolve(raw: string | null | undefined, parentId: string | null = null): Promise<Resolved | null> {
    const canon = canonicalizeMaster(this.dimension, raw);
    if (!canon) return null;

    // Match by key, OR by an alias folded the SAME way (aliases are stored in display form, so a
    // slug-keyed dimension needs canonicalizeMaster here — a raw lowercase compare would miss them).
    const hit = (await this.rows()).find(
      (row) =>
        row.key === canon.key ||
        row.aliases.some((alias) => canonicalizeMaster(this.dimension, alias)?.key === canon.key),
    );
    if (hit) return toResolved(hit);

    const pending = this.inflight.get(canon.key);
    if (pending) return pending;

    const created = this.createAndCache(canon, parentId);
    this.inflight.set(canon.key, created);
    try {
      return await created;
    } finally {
      this.inflight.delete(canon.key);
    }
  }

  /** Insert the canonical row; on a unique-race or an unconfigured store, re-read (or degrade to null). */
  private async createAndCache(canon: Canonical, parentId: string | null): Promise<Resolved | null> {
    const row: NewDictionaryRow = {
      key: canon.key,
      name: canon.name,
      aliases: [canon.name],
      kind: this.dimension === 'questionType' ? (canon.kind ?? null) : null,
      rank: this.dimension === 'level' ? levelRank(canon.key) : null,
      subjectId: this.dimension === 'chapter' ? parentId : null,
      chapterId: this.dimension === 'topic' ? parentId : null,
    };
    try {
      const created = await this.store.create(this.dimension, row);
      this.invalidate();
      return toResolved(created);
    } catch {
      // A unique-key race (another writer inserted it) or an unconfigured store. Re-read: a hit means
      // the race, no hit means no DB — an FK left null is the documented safe fallback (raw preserved).
      this.invalidate();
      const again = (await this.rows()).find((r) => r.key === canon.key);
      return again ? toResolved(again) : null;
    }
  }
}

function toResolved(row: DictionaryRow): Resolved {
  return { id: row.id, name: row.name, kind: row.kind, rank: row.rank };
}

/**
 * The write-path resolver (§2 of eduents' QUESTION_WRITE_CONTRACT): given the raw names a question is
 * filed under, return the indexed FK ids + clean labels + `questionKind`/`levelRank` to stamp onto the
 * bank row. Folds every value through the SAME `foldMaps` eduents uses, so ingest can never re-dirty
 * the shared vocabulary. `questionKind` prefers structure (passage → comprehension, match → matrix)
 * over the type string, matching the read path's OR-fallback.
 */
export class TaxonomyResolver {
  private readonly dicts: Record<TaxonomyDimension, DimensionDict>;

  constructor(store: TaxonomyStore) {
    const dict = (dimension: TaxonomyDimension): DimensionDict => new DimensionDict(dimension, store);
    this.dicts = {
      exam: dict('exam'),
      subject: dict('subject'),
      module: dict('module'),
      chapter: dict('chapter'),
      section: dict('section'),
      questionType: dict('questionType'),
      level: dict('level'),
      topic: dict('topic'),
    };
  }

  /** One dimension's current dictionary rows (cached, no create) — for injecting live masters context. */
  snapshot(dimension: TaxonomyDimension): Promise<DictionaryRow[]> {
    return this.dicts[dimension].snapshot();
  }

  async resolveQuestionTaxonomy(input: QuestionTaxonomyInput): Promise<ResolvedTaxonomy> {
    const [exam, subject, section, questionType, level] = await Promise.all([
      this.dicts.exam.resolve(input.exam),
      this.dicts.subject.resolve(input.subject),
      this.dicts.section.resolve(input.section),
      this.dicts.questionType.resolve(input.questionType),
      this.dicts.level.resolve(input.level),
    ]);
    // Only chapters are subject-scoped. Modules identify the source/provider (for example Allen or PW),
    // so they resolve independently and remain reusable across every subject and exam.
    const [chapter, module] = await Promise.all([
      this.dicts.chapter.resolve(input.chapter, subject?.id ?? null),
      this.dicts.module.resolve(input.module),
    ]);
    const structuralKind = deriveKindFromStructure({
      group_id: input.groupId,
      passage: input.passage,
      match_columns: input.matchColumns,
      match_key: input.matchKey,
    });
    return {
      examId: exam?.id ?? null,
      examName: exam?.name ?? null,
      subjectId: subject?.id ?? null,
      subjectName: subject?.name ?? null,
      moduleId: module?.id ?? null,
      moduleName: module?.name ?? null,
      chapterId: chapter?.id ?? null,
      chapterName: chapter?.name ?? null,
      sectionId: section?.id ?? null,
      sectionLabel: section?.name ?? null,
      questionTypeId: questionType?.id ?? null,
      questionTypeName: questionType?.name ?? null,
      questionKind: structuralKind ?? questionType?.kind ?? null,
      levelId: level?.id ?? null,
      levelName: level?.name ?? null,
      levelRank: level?.rank ?? null,
    };
  }
}
