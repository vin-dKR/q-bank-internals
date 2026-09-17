import { errors } from '../../shared/errors/error-catalog.js';
import type { DictionaryRow, TaxonomyStore } from '../../modules/masters/index.js';

/**
 * Null-object {@link TaxonomyStore} for the in-memory dev driver. The taxonomy dictionaries live only
 * in the shared Eduents Mongo, so reads return empty (the masters screen renders with no entries) and
 * writes fail loudly, exactly like the bank/exam-access stores.
 */
export class UnconfiguredTaxonomyStore implements TaxonomyStore {
  list(): Promise<DictionaryRow[]> {
    return Promise.resolve([]);
  }

  findByKey(): Promise<DictionaryRow | null> {
    return Promise.resolve(null);
  }

  findById(): Promise<DictionaryRow | null> {
    return Promise.resolve(null);
  }

  create(): Promise<DictionaryRow> {
    return Promise.reject(errors.taxonomyUnavailable());
  }

  update(): Promise<DictionaryRow> {
    return Promise.reject(errors.taxonomyUnavailable());
  }

  remove(): Promise<void> {
    return Promise.reject(errors.taxonomyUnavailable());
  }

  usageCounts(): Promise<Map<string, number>> {
    return Promise.resolve(new Map<string, number>());
  }
}
