import { errors } from '../../shared/errors/error-catalog.js';
import type { UploadStagingStore } from '../../modules/ingestion/index.js';

/**
 * Null-object {@link UploadStagingStore} used when Supabase is not configured, so the app still boots.
 * Any upload attempt fails loudly with a clear, catalogued error rather than a confusing 500.
 */
export class UnconfiguredUploadStagingStore implements UploadStagingStore {
  createSignedUpload(): Promise<{ path: string; uploadUrl: string }> {
    return Promise.reject(errors.uploadStagingNotConfigured());
  }

  download(): Promise<Buffer> {
    return Promise.reject(errors.uploadStagingNotConfigured());
  }

  remove(): Promise<void> {
    return Promise.reject(errors.uploadStagingNotConfigured());
  }
}
