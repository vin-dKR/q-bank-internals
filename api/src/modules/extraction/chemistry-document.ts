import type { Document } from '@ingest/contracts';

/** Operator subject and source metadata select the chemistry-specific extraction workflow. */
export function isChemistryDocument(document: Document): boolean {
  const values = [document.subject, document.path.chapter, document.path.section, ...document.topics.map((topic) => topic.subject)];
  return values.some((value) => typeof value === 'string' && /chemistry|chemical|organic|inorganic|अकार्बनिक|कार्बनिक|रसायन/i.test(value));
}
