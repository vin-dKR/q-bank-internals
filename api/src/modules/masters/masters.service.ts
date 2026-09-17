import type {
  CreateDictionaryEntry,
  DictionaryEntry,
  DictionaryList,
  DictionaryQuery,
  SeedDictionary,
  TaxonomyDimension,
  UpdateDictionaryEntry,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import {
  CANONICAL_SECTIONS,
  CANONICAL_SUBJECTS,
  CLOSED_MASTER_DIMENSIONS,
  LEVELS,
  QUESTION_KINDS,
  canonicalizeMaster,
  levelRank,
  norm,
} from '../../shared/taxonomy/fold-maps.js';
import type {
  DictionaryFilter,
  DictionaryPatch,
  DictionaryRow,
  NewDictionaryRow,
  TaxonomyStore,
} from './masters.repository.js';

/** The canonical kinds a QuestionType row may declare — the closed branch vocabulary. */
const QUESTION_KIND_KEYS = new Set(QUESTION_KINDS.map((k) => k.key));

/**
 * Masters → Question taxonomy (§2). The single authority for the shared bank's dictionary collections:
 * lists each dimension with its bank-usage count, creates/renames/deletes canonical entries (folding
 * every write through the SAME `foldMaps` the publisher and eduents use, so the vocabulary can never
 * re-dirty), and seeds the closed vocabularies (question kinds, difficulty levels) plus the curated
 * subject/section starting sets. Chapters are subject-scoped; topics are chapter-scoped.
 */
export class MastersService {
  constructor(private readonly store: TaxonomyStore) {}

  async list(dimension: TaxonomyDimension, query: DictionaryQuery): Promise<DictionaryList> {
    const filter: DictionaryFilter = {
      q: query.q,
      subjectId: query.subjectId,
      chapterId: query.chapterId,
    };
    const rows = await this.store.list(dimension, filter);
    const counts = await this.store.usageCounts(dimension, rows.map((row) => row.id));
    return {
      dimension,
      entries: rows.map((row) => this.toEntry(dimension, row, counts.get(row.id) ?? 0)),
    };
  }

  async create(dimension: TaxonomyDimension, input: CreateDictionaryEntry): Promise<DictionaryEntry> {
    const canonical = canonicalizeMaster(dimension, input.name);
    if (!canonical) throw errors.dictionaryValueRejected(dimension, input.name);

    const existing = await this.store.findByKey(dimension, canonical.key);
    if (existing) throw errors.dictionaryEntryExists(dimension, existing.name);

    await this.assertScopeExists(dimension, input.subjectId, input.chapterId);

    const row: NewDictionaryRow = {
      key: canonical.key,
      name: canonical.name,
      aliases: this.mergeAliases([canonical.name], input.aliases),
      kind: dimension === 'questionType' ? (canonical.kind ?? null) : null,
      rank: dimension === 'level' ? levelRank(canonical.key) : null,
      subjectId: dimension === 'chapter' ? (input.subjectId ?? null) : null,
      chapterId: dimension === 'topic' ? (input.chapterId ?? null) : null,
    };
    const created = await this.store.create(dimension, row);
    return this.toEntry(dimension, created, 0);
  }

  async update(
    dimension: TaxonomyDimension,
    id: string,
    input: UpdateDictionaryEntry,
  ): Promise<DictionaryEntry> {
    const current = await this.store.findById(dimension, id);
    if (!current) throw errors.dictionaryEntryNotFound(dimension, id);

    const patch: DictionaryPatch = {};

    if (input.name !== undefined) {
      // The key is the stable identity FKs point at, so a rename never changes it — it updates the
      // display name and keeps the old spelling reachable by folding it into aliases.
      patch.name = input.name.trim();
      patch.aliases = this.mergeAliases([...current.aliases, patch.name], input.aliases);
    } else if (input.aliases !== undefined) {
      patch.aliases = this.mergeAliases([current.name], input.aliases);
    }

    if (input.kind !== undefined) {
      if (dimension !== 'questionType') throw errors.dictionaryFieldNotAllowed(dimension, 'kind');
      if (!QUESTION_KIND_KEYS.has(input.kind)) throw errors.dictionaryValueRejected('questionType', input.kind);
      patch.kind = input.kind;
    }

    if (input.rank !== undefined) {
      if (dimension !== 'level') throw errors.dictionaryFieldNotAllowed(dimension, 'rank');
      patch.rank = input.rank;
    }

    if (input.subjectId !== undefined) {
      if (dimension !== 'chapter') throw errors.dictionaryFieldNotAllowed(dimension, 'subjectId');
      if (input.subjectId) await this.assertScopeExists(dimension, input.subjectId, undefined);
      patch.subjectId = input.subjectId;
    }

    if (input.chapterId !== undefined) {
      if (dimension !== 'topic') throw errors.dictionaryFieldNotAllowed(dimension, 'chapterId');
      if (input.chapterId) await this.assertScopeExists(dimension, undefined, input.chapterId);
      patch.chapterId = input.chapterId;
    }

    const updated = await this.store.update(dimension, id, patch);
    const counts = await this.store.usageCounts(dimension, [id]);
    return this.toEntry(dimension, updated, counts.get(id) ?? 0);
  }

  async remove(dimension: TaxonomyDimension, id: string): Promise<void> {
    if (CLOSED_MASTER_DIMENSIONS.has(dimension)) throw errors.dictionaryDimensionClosed(dimension);

    const current = await this.store.findById(dimension, id);
    if (!current) throw errors.dictionaryEntryNotFound(dimension, id);

    const counts = await this.store.usageCounts(dimension, [id]);
    const used = counts.get(id) ?? 0;
    if (used > 0) throw errors.dictionaryEntryInUse(current.name, used);

    await this.store.remove(dimension, id);
  }

  /**
   * Idempotently create a dimension's canonical starting set: the 7 question kinds, the 3 difficulty
   * levels, and the curated subject/section vocabularies. Dimensions without a curated set (exam,
   * chapter, topic) are a no-op — they populate from operator creation and publish-time resolution.
   */
  async seed(dimension: TaxonomyDimension): Promise<SeedDictionary> {
    const canonicalRows = this.seedRows(dimension);
    let created = 0;
    for (const row of canonicalRows) {
      const existing = await this.store.findByKey(dimension, row.key);
      if (existing) continue;
      await this.store.create(dimension, row);
      created += 1;
    }
    const { entries } = await this.list(dimension, {});
    return { dimension, created, entries };
  }

  private seedRows(dimension: TaxonomyDimension): NewDictionaryRow[] {
    const blank = { kind: null, rank: null, subjectId: null, chapterId: null };
    switch (dimension) {
      case 'questionType':
        return QUESTION_KINDS.map((k) => ({ ...blank, key: k.key, name: k.name, aliases: [k.name], kind: k.kind ?? k.key }));
      case 'level':
        return LEVELS.map((l) => ({ ...blank, key: l.key, name: l.name, aliases: [l.name], rank: l.rank }));
      case 'subject':
        return CANONICAL_SUBJECTS.map((s) => ({ ...blank, key: s.key, name: s.name, aliases: s.aliases }));
      case 'section':
        return CANONICAL_SECTIONS.map((s) => ({ ...blank, key: s.key, name: s.name, aliases: s.aliases }));
      case 'exam':
      case 'chapter':
      case 'topic':
        return [];
    }
  }

  /** Reject a chapter/topic whose declared parent id does not resolve to a real subject/chapter row. */
  private async assertScopeExists(
    dimension: TaxonomyDimension,
    subjectId: string | undefined,
    chapterId: string | undefined,
  ): Promise<void> {
    if (dimension === 'chapter' && subjectId) {
      const parent = await this.store.findById('subject', subjectId);
      if (!parent) throw errors.dictionaryParentNotFound('subject', subjectId);
    }
    if (dimension === 'topic' && chapterId) {
      const parent = await this.store.findById('chapter', chapterId);
      if (!parent) throw errors.dictionaryParentNotFound('chapter', chapterId);
    }
  }

  /** Trim, drop blanks, and de-duplicate aliases case-insensitively, preserving first-seen casing. */
  private mergeAliases(base: string[], extra: string[] | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of [...base, ...(extra ?? [])]) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const key = norm(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  private toEntry(dimension: TaxonomyDimension, row: DictionaryRow, questionCount: number): DictionaryEntry {
    return {
      id: row.id,
      dimension,
      key: row.key,
      name: row.name,
      aliases: row.aliases,
      kind: row.kind,
      rank: row.rank,
      subjectId: row.subjectId,
      chapterId: row.chapterId,
      questionCount,
    };
  }
}
