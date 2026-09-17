// Public surface of the taxonomy feature (§4): Masters → Question taxonomy — curate the shared bank's
// dictionaries (Exam / Subject / Chapter / Section / QuestionType / Level / Topic) that the extractor
// picks IDs from and the publisher stamps onto every bank question.
export { TaxonomyManager } from './components/taxonomy-manager.js';
export { useMastersVocabulary, type MastersVocabulary } from './hooks/use-masters-vocabulary.js';
