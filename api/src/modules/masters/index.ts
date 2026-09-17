// Public surface of the masters module (§4): Masters → Question taxonomy — CRUD + seeding over the
// shared bank's normalized dictionary collections (Exam / Subject / Chapter / Section / QuestionType /
// Level / Topic), so operators curate the vocabulary the extractor and publisher resolve against.
export { MastersService } from './masters.service.js';
export { createMastersRouter } from './masters.routes.js';
export { TaxonomyResolver } from './taxonomy-resolver.js';
export type { ResolvedTaxonomy, QuestionTaxonomyInput, Resolved } from './taxonomy-resolver.js';
export type {
  TaxonomyStore,
  DictionaryRow,
  DictionaryFilter,
  NewDictionaryRow,
  DictionaryPatch,
} from './masters.repository.js';
