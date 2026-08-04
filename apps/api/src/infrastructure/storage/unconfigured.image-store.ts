import { errors } from '../../shared/errors/error-catalog.js';
import type { ImageStore } from '../../modules/questions/index.js';

/**
 * Null-object {@link ImageStore} used when Supabase is not configured, so the app still boots. Any
 * real upload fails loudly with a clear, catalogued error.
 */
export class UnconfiguredImageStore implements ImageStore {
  upload(): Promise<string> {
    return Promise.reject(errors.imageUploadFailed('SUPABASE_SERVICE_KEY is not configured.'));
  }
}
