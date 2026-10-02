import type { PagePreviewStore } from '../../modules/pages/index.js';

/** Null-object cache for local setups that intentionally omit Supabase credentials. */
export class UnconfiguredPagePreviewStore implements PagePreviewStore {
  find(): Promise<null> {
    return Promise.resolve(null);
  }

  save(): Promise<string> {
    return Promise.reject(new Error('Source-page preview storage is not configured.'));
  }
}
