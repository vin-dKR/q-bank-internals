import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { UploadStagingStore } from '../../modules/ingestion/index.js';

/** All staged uploads live under this prefix, so `download`/`remove` can never touch a published object. */
const STAGING_PREFIX = 'tmp-uploads/';

/** Keep only path-safe characters in the operator's file name; the uuid ahead of it guarantees uniqueness. */
function safeName(fileName: string): string {
  const cleaned = fileName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'upload.pdf';
}

/**
 * {@link UploadStagingStore} backed by Supabase Storage. The browser uploads the PDF straight to a
 * signed URL (no request-body limit), and the server later pulls the bytes to file them into Drive.
 * Reuses the same bucket + service key as the image store; staged objects live under `tmp-uploads/`
 * and are removed once ingested.
 */
export class SupabaseUploadStagingStore implements UploadStagingStore {
  private readonly client: ReturnType<typeof createClient>;

  constructor(
    url: string,
    serviceKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceKey);
  }

  async createSignedUpload(fileName: string): Promise<{ path: string; uploadUrl: string }> {
    const path = `${STAGING_PREFIX}${randomUUID()}-${safeName(fileName)}`;
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(path);
    if (error) throw errors.uploadStagingFailed(error.message);
    return { path: data.path, uploadUrl: data.signedUrl };
  }

  async download(path: string): Promise<Buffer> {
    this.assertStaged(path);
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error) throw errors.uploadStagingFailed(error.message);
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(path: string): Promise<void> {
    this.assertStaged(path);
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) throw errors.uploadStagingFailed(error.message);
  }

  /** Refuse any path the server did not mint, so a finalize call can only reach its own staged object. */
  private assertStaged(path: string): void {
    if (!path.startsWith(STAGING_PREFIX)) throw errors.uploadStagingInvalidPath();
  }
}
