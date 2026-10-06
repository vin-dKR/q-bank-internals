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
 * subject starting sets. Modules are independent providers; sections are module-scoped, chapters are
 * subject-scoped, and topics are chapter-scoped. Subjects may optionally declare many compatible exams
 * without becoming children of an exam.
 */
export class MastersService {
  constructor(private readonly store: TaxonomyStore) {}

  async list(dimension: TaxonomyDimension, query: DictionaryQuery): Promise<DictionaryList> {
    const filter: DictionaryFilter = {
      q: query.q,
      subjectId: dimension === 'chapter' ? query.subjectId : undefined,
      chapterId: dimension === 'topic' ? query.chapterId : undefined,
      moduleId: dimension === 'section' ? query.moduleId : undefined,
    };
    const rows = await this.store.list(dimension, filter);
    const counts = await this.store.usageCounts(
      dimension,
      rows.map((row) => row.id),
    );
    return {
      dimension,
      entries: rows.map((row) => this.toEntry(dimension, row, counts.get(row.id) ?? 0)),
    };
  }

  async create(
    dimension: TaxonomyDimension,
    input: CreateDictionaryEntry,
  ): Promise<DictionaryEntry> {
    const canonical = canonicalizeMaster(dimension, input.name);
    if (!canonical) throw errors.dictionaryValueRejected(dimension, input.name);

    if (input.subjectId !== undefined && dimension !== 'chapter') {
      throw errors.dictionaryFieldNotAllowed(dimension, 'subjectId');
    }
    if (input.chapterId !== undefined && dimension !== 'topic') {
      throw errors.dictionaryFieldNotAllowed(dimension, 'chapterId');
    }
    if (input.moduleId !== undefined && dimension !== 'section') {
      throw errors.dictionaryFieldNotAllowed(dimension, 'moduleId');
    }
    if (input.examIds !== undefined && dimension !== 'subject') {
      throw errors.dictionaryFieldNotAllowed(dimension, 'examIds');
    }
    if (input.relatedExamIds !== undefined) {
      throw errors.dictionaryFieldNotAllowed(dimension, 'relatedExamIds');
    }
    if (dimension === 'section' && !input.moduleId) {
      throw errors.dictionaryParentRequired('section', 'module');
    }

    const existing = await this.store.findByKey(dimension, canonical.key);
    if (existing) throw errors.dictionaryEntryExists(dimension, existing.name);

    const examIds = this.uniqueIds(input.examIds);
    await this.assertScopeExists(
      dimension,
      input.subjectId,
      input.chapterId,
      input.moduleId,
      examIds,
    );

    const row: NewDictionaryRow = {
      key: canonical.key,
      name: canonical.name,
      aliases: this.mergeAliases([canonical.name], input.aliases),
      kind: dimension === 'questionType' ? (canonical.kind ?? null) : null,
      rank: dimension === 'level' ? levelRank(canonical.key) : null,
      subjectId: dimension === 'chapter' ? (input.subjectId ?? null) : null,
      chapterId: dimension === 'topic' ? (input.chapterId ?? null) : null,
      moduleId: dimension === 'section' ? (input.moduleId ?? null) : null,
      examIds: dimension === 'subject' ? examIds : [],
      relatedExamIds: [],
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
      if (!QUESTION_KIND_KEYS.has(input.kind))
        throw errors.dictionaryValueRejected('questionType', input.kind);
      patch.kind = input.kind;
    }

    if (input.rank !== undefined) {
      if (dimension !== 'level') throw errors.dictionaryFieldNotAllowed(dimension, 'rank');
      patch.rank = input.rank;
    }

    if (input.subjectId !== undefined) {
      if (dimension !== 'chapter') {
        throw errors.dictionaryFieldNotAllowed(dimension, 'subjectId');
      }
      if (input.subjectId) await this.assertScopeExists(dimension, input.subjectId, undefined);
      patch.subjectId = input.subjectId;
    }

    if (input.chapterId !== undefined) {
      if (dimension !== 'topic') throw errors.dictionaryFieldNotAllowed(dimension, 'chapterId');
      if (input.chapterId) await this.assertScopeExists(dimension, undefined, input.chapterId);
      patch.chapterId = input.chapterId;
    }

    if (input.moduleId !== undefined) {
      if (dimension !== 'section') throw errors.dictionaryFieldNotAllowed(dimension, 'moduleId');
      if (!input.moduleId) throw errors.dictionaryParentRequired('section', 'module');
      await this.assertScopeExists(dimension, undefined, undefined, input.moduleId);
      patch.moduleId = input.moduleId;
    }

    if (input.examIds !== undefined) {
      if (dimension !== 'subject') throw errors.dictionaryFieldNotAllowed(dimension, 'examIds');
      const examIds = this.uniqueIds(input.examIds);
      await this.assertScopeExists(dimension, undefined, undefined, undefined, examIds);
      patch.examIds = examIds;
    }

    if (input.relatedExamIds !== undefined) {
      if (dimension !== 'exam') throw errors.dictionaryFieldNotAllowed(dimension, 'relatedExamIds');
      const relatedExamIds = this.uniqueIds(input.relatedExamIds);
      if (relatedExamIds.includes(id)) throw errors.dictionaryValueRejected('exam relation', current.name);
      await this.assertExamRelations(relatedExamIds);
      patch.relatedExamIds = relatedExamIds;
    }

    const updated = await this.store.update(dimension, id, patch);
    if (dimension === 'exam' && patch.relatedExamIds !== undefined) {
      await this.syncExamRelations(id, current.relatedExamIds, patch.relatedExamIds);
    }
    const counts = await this.store.usageCounts(dimension, [id]);
    return this.toEntry(dimension, updated, counts.get(id) ?? 0);
  }

  async remove(dimension: TaxonomyDimension, id: string): Promise<void> {
    if (CLOSED_MASTER_DIMENSIONS.has(dimension)) throw errors.dictionaryDimensionClosed(dimension);

    const current = await this.store.findById(dimension, id);
    if (!current) throw errors.dictionaryEntryNotFound(dimension, id);

    // Sections are owned by their Module. Do not permit the parent to disappear while those rows
    // still point at it; otherwise the UI would be unable to edit or filter the orphaned Sections.
    if (dimension === 'module') {
      const sections = await this.store.list('section', { moduleId: id });
      if (sections.length > 0) {
        throw errors.dictionaryEntryHasChildren(current.name, 'section', sections.length);
      }
    }

    const counts = await this.store.usageCounts(dimension, [id]);
    const used = counts.get(id) ?? 0;
    if (used > 0) throw errors.dictionaryEntryInUse(current.name, used);

    if (dimension === 'exam') {
      // Do not leave dangling graph edges when an unused exam is deleted.
      // Scan the tiny dictionary instead of trusting the current row alone so
      // this also cleans an old one-sided relation written before symmetry was
      // enforced.
      const exams = await this.store.list('exam', {});
      await Promise.all(
        exams
          .filter((exam) => exam.relatedExamIds.includes(id))
          .map((exam) =>
            this.store.update('exam', exam.id, {
              relatedExamIds: exam.relatedExamIds.filter((relatedId) => relatedId !== id),
            }),
          ),
      );
    }

    await this.store.remove(dimension, id);
  }

  /**
   * Idempotently create a dimension's canonical starting set: the 7 question kinds, the 3 difficulty
   * levels, and the curated subject vocabulary. Sections deliberately have no global seed: every new
   * section is filed under a module. Dimensions without a curated set (exam, module, chapter, section,
   * topic) are a no-op — they populate from operator creation and publish-time resolution.
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
    const blank = {
      kind: null,
      rank: null,
      subjectId: null,
      chapterId: null,
      moduleId: null,
      examIds: [],
      relatedExamIds: [],
    };
    switch (dimension) {
      case 'questionType':
        return QUESTION_KINDS.map((k) => ({
          ...blank,
          key: k.key,
          name: k.name,
          aliases: [k.name],
          kind: k.kind ?? k.key,
        }));
      case 'level':
        return LEVELS.map((l) => ({
          ...blank,
          key: l.key,
          name: l.name,
          aliases: [l.name],
          rank: l.rank,
        }));
      case 'subject':
        return CANONICAL_SUBJECTS.map((s) => ({
          ...blank,
          key: s.key,
          name: s.name,
          aliases: s.aliases,
        }));
      case 'exam':
      case 'module':
      case 'chapter':
      case 'section':
      case 'topic':
        return [];
    }
  }

  /** Reject a scoped row or optional subject→exam link whose declared parent ids do not resolve. */
  private async assertScopeExists(
    dimension: TaxonomyDimension,
    subjectId: string | undefined,
    chapterId: string | undefined,
    moduleId?: string,
    examIds: readonly string[] = [],
  ): Promise<void> {
    if (dimension === 'chapter' && subjectId) {
      const parent = await this.store.findById('subject', subjectId);
      if (!parent) throw errors.dictionaryParentNotFound('subject', subjectId);
    }
    if (dimension === 'topic' && chapterId) {
      const parent = await this.store.findById('chapter', chapterId);
      if (!parent) throw errors.dictionaryParentNotFound('chapter', chapterId);
    }
    if (dimension === 'section' && moduleId) {
      const parent = await this.store.findById('module', moduleId);
      if (!parent) throw errors.dictionaryParentNotFound('module', moduleId);
    }
    if (dimension === 'subject') {
      await Promise.all(
        examIds.map(async (examId) => {
          const parent = await this.store.findById('exam', examId);
          if (!parent) throw errors.dictionaryParentNotFound('exam', examId);
        }),
      );
    }
  }

  /** Validate the other end of an exam relation before any link is changed. */
  private async assertExamRelations(ids: readonly string[]): Promise<void> {
    await Promise.all(
      ids.map(async (examId) => {
        const exam = await this.store.findById('exam', examId);
        if (!exam) throw errors.dictionaryParentNotFound('exam', examId);
      }),
    );
  }

  /**
   * Exam links are an undirected graph: selecting either linked exam expands
   * the bank filter to the same connected set. Keep both stored ends in sync
   * so a direct database read remains understandable and robust to cache
   * boundaries. Existing one-sided legacy links are repaired on the next save.
   */
  private async syncExamRelations(
    id: string,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const affected = new Set([...before, ...after]);
    await Promise.all(
      [...affected].map(async (otherId) => {
        const other = await this.store.findById('exam', otherId);
        // The set was validated before the write. A concurrent delete simply
        // means there is no reciprocal row left to repair.
        if (!other) return;
        const shouldLink = after.includes(otherId);
        const related = shouldLink
          ? this.uniqueIds([...other.relatedExamIds, id])
          : other.relatedExamIds.filter((relatedId) => relatedId !== id);
        await this.store.update('exam', otherId, { relatedExamIds: related });
      }),
    );
  }

  /** Trim and de-duplicate ObjectId strings before validation/storage. */
  private uniqueIds(ids: readonly string[] | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids ?? []) {
      const trimmed = id.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
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

  private toEntry(
    dimension: TaxonomyDimension,
    row: DictionaryRow,
    questionCount: number,
  ): DictionaryEntry {
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
      moduleId: row.moduleId,
      examIds: row.examIds,
      relatedExamIds: row.relatedExamIds,
      questionCount,
    };
  }
}
