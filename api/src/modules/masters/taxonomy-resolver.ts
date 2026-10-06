import type { TaxonomyDimension } from '@ingest/contracts';
import {
  type Canonical,
  canonicalizeMaster,
  deriveKindFromStructure,
  levelRank,
  norm,
  slug,
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
   * raw name → resolved entry, creating an OPEN-vocabulary canonical row on first sight;
   * junk/unknown → null. QuestionType is deliberately different: its rows are curated/seeded,
   * so publishing an extracted value must never invent a dictionary row.
   * `parentId` is the resolved subject (for a chapter), module (for a section), or chapter (for a
   * topic) to scope a NEW row to.
   */
  async resolve(
    raw: string | null | undefined,
    parentId: string | null = null,
  ): Promise<Resolved | null> {
    const canon = canonicalizeMaster(this.dimension, raw);
    const hasCuratedQuestionTypeCandidate =
      this.dimension === 'questionType' && Boolean(raw?.trim());
    // Preserve the cheap null/junk path for every dimension. The one exception is a non-empty
    // QuestionType that is unknown to the built-in fold map: it may still name an existing curated row.
    if (!canon && !hasCuratedQuestionTypeCandidate) return null;
    const rows = await this.rows();

    // The extraction vocabulary has a few more precise tokens than the historical seven master
    // kinds (for example `true_false` and `fill_blank`). Prefer an explicitly curated matching row
    // before folding either token to its generic Subjective kind. This only ever reads an existing row.
    if (hasCuratedQuestionTypeCandidate && raw) {
      const exact = this.existingQuestionType(rows, raw);
      if (exact) return toResolved(exact);
    }

    if (!canon) {
      // QuestionType remains closed for creation, but a live master snapshot may contain a curated
      // custom row. Resolve only an existing exact key/name/alias for it; never let an unknown model
      // string create a new taxonomy row merely because the prompt listed dynamic masters.
      if (!hasCuratedQuestionTypeCandidate || !raw) return null;
      const existing = this.existingQuestionType(rows, raw);
      return existing ? toResolved(existing) : null;
    }

    // Match by key, OR by an alias folded the SAME way (aliases are stored in display form, so a
    // slug-keyed dimension needs canonicalizeMaster here — a raw lowercase compare would miss them).
    const hit = rows.find(
      (row) =>
        row.key === canon.key ||
        row.aliases.some((alias) => canonicalizeMaster(this.dimension, alias)?.key === canon.key),
    );
    if (hit) {
      // A legacy Section with no module remains a safe global fallback. But a Section already filed
      // under another module must never be stamped onto this question merely because the display
      // spelling happens to match. The shared bank still has a globally-unique Section.key; until its
      // migration makes `(moduleId, key)` unique, preserve the raw section text and leave this FK null
      // rather than silently crossing providers.
      if (
        this.dimension === 'section' &&
        hit.moduleId !== null &&
        (parentId === null || hit.moduleId !== parentId)
      ) {
        return null;
      }
      return toResolved(hit);
    }

    // A Section must have a resolved module to be created. This keeps an import/legacy document with
    // no module from polluting Masters with a new globally-unscoped row; an already-existing legacy
    // global Section was handled above and remains readable.
    if (this.dimension === 'section' && parentId === null) return null;

    // Unlike the open dimensions, QuestionType is a deliberately curated taxonomy. The raw
    // question_type remains on the published question and its built-in kind is derived below, but a
    // missing master must leave its FK null rather than letting an extraction create a new row.
    if (this.dimension === 'questionType') return null;

    // Section keys are currently globally unique in the shared bank, but scope the in-flight work by
    // module anyway. Otherwise two concurrent imports for different providers could share the first
    // promise and incorrectly stamp its Section FK onto both questions before the database's unique
    // key rejects the second insert. Once Eduents migrates to a `(moduleId, key)` unique identity,
    // this also becomes the correct de-duplication boundary automatically.
    const inflightKey =
      this.dimension === 'section' ? `${parentId ?? 'unscoped'}:${canon.key}` : canon.key;
    const pending = this.inflight.get(inflightKey);
    if (pending) return pending;

    const created = this.createAndCache(canon, parentId);
    this.inflight.set(inflightKey, created);
    try {
      return await created;
    } finally {
      this.inflight.delete(inflightKey);
    }
  }

  /** Exact/slug-equivalent lookup for a pre-existing curated QuestionType row; never creates. */
  private existingQuestionType(rows: DictionaryRow[], raw: string): DictionaryRow | undefined {
    const rawKey = norm(raw);
    const slugKey = slug(raw);
    return rows.find(
      (row) =>
        norm(row.key) === rawKey ||
        row.key === slugKey ||
        norm(row.name) === rawKey ||
        row.aliases.some((alias) => norm(alias) === rawKey || slug(alias) === slugKey),
    );
  }

  /** Insert the canonical row; on a unique-race or an unconfigured store, re-read (or degrade to null). */
  private async createAndCache(
    canon: Canonical,
    parentId: string | null,
  ): Promise<Resolved | null> {
    const row: NewDictionaryRow = {
      key: canon.key,
      name: canon.name,
      aliases: [canon.name],
      kind: this.dimension === 'questionType' ? (canon.kind ?? null) : null,
      rank: this.dimension === 'level' ? levelRank(canon.key) : null,
      subjectId: this.dimension === 'chapter' ? parentId : null,
      chapterId: this.dimension === 'topic' ? parentId : null,
      moduleId: this.dimension === 'section' ? parentId : null,
      examIds: [],
      relatedExamIds: [],
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
      if (
        again &&
        this.dimension === 'section' &&
        again.moduleId !== null &&
        (parentId === null || again.moduleId !== parentId)
      ) {
        return null;
      }
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
    const dict = (dimension: TaxonomyDimension): DimensionDict =>
      new DimensionDict(dimension, store);
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
    // Keep built-in extraction categories useful even before a deployment has seeded (or curated) a
    // matching QuestionType row. This derives only the denormalized kind; it does NOT manufacture an
    // FK or rewrite the raw `question_type`, so a custom/unknown model value still stays unresolved.
    const builtInQuestionType = canonicalizeMaster('questionType', input.questionType);
    const [exam, subject, questionType, level, module] = await Promise.all([
      this.dicts.exam.resolve(input.exam),
      this.dicts.subject.resolve(input.subject),
      this.dicts.questionType.resolve(input.questionType),
      this.dicts.level.resolve(input.level),
      this.dicts.module.resolve(input.module),
    ]);
    // Modules identify the source/provider (for example Allen or PW), so they resolve independently
    // and remain reusable across every subject and exam. Their Sections are then filed beneath that
    // module, while chapters are independently scoped to their subject.
    const [chapter, section] = await Promise.all([
      this.dicts.chapter.resolve(input.chapter, subject?.id ?? null),
      this.dicts.section.resolve(input.section, module?.id ?? null),
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
      questionKind: structuralKind ?? questionType?.kind ?? builtInQuestionType?.kind ?? null,
      levelId: level?.id ?? null,
      levelName: level?.name ?? null,
      levelRank: level?.rank ?? null,
    };
  }
}
