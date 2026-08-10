import type { CatalogFilterOptionSets, CatalogQuestionPage, CatalogStore } from '../../modules/catalog/index.js';

/**
 * Null-object {@link CatalogStore} for the in-memory dev driver — browsing the bank needs a real
 * database. Both reads return empty so the Questions page renders its designed empty state rather
 * than erroring (mirrors how {@link UnconfiguredBankQuestionStore} degrades the fix screen).
 */
export class UnconfiguredCatalogStore implements CatalogStore {
  listQuestions(): Promise<CatalogQuestionPage> {
    return Promise.resolve({ questions: [], nextCursor: null });
  }

  filterOptions(): Promise<CatalogFilterOptionSets> {
    return Promise.resolve({ exams: [], subjects: [], chapters: [], sections: [], questionTypes: [] });
  }
}
