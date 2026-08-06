import type { Document } from '@ingest/contracts';

/**
 * A unit is one uploaded chapter part-set, keyed by its `(module · chapter · section)` — the same
 * key the uploader guards on. Its question PDF is the extractable part; answer/solution are bound
 * context the extractor reads, never independently "extracted". Grouping by unit is what lets the
 * session and verify screens state the truth ("one uploaded unit") instead of scattering loose files.
 */
export type DocumentUnit = {
  key: string;
  module: string;
  chapter: string;
  section: string;
  title: string;
  questions: Document[];
  supporting: Document[];
};

function unitKey(doc: Document): string {
  const norm = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return [norm(doc.path.module), norm(doc.path.chapter), norm(doc.path.section)].join(' | ');
}

/** Group documents into units, preserving first-seen order. */
export function groupByUnit(items: readonly Document[]): DocumentUnit[] {
  const byKey = new Map<string, DocumentUnit>();
  const units: DocumentUnit[] = [];

  for (const doc of items) {
    const key = unitKey(doc);
    let unit = byKey.get(key);
    if (!unit) {
      unit = {
        key,
        module: doc.path.module,
        chapter: doc.path.chapter,
        section: doc.path.section,
        title: [doc.path.chapter, doc.path.section].filter(Boolean).join(' · '),
        questions: [],
        supporting: [],
      };
      byKey.set(key, unit);
      units.push(unit);
    }
    (doc.kind === 'question' ? unit.questions : unit.supporting).push(doc);
  }

  return units;
}
