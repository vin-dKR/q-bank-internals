import { createClient } from '@supabase/supabase-js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { PagePreviewStore } from '../../modules/pages/index.js';

const PREVIEW_PREFIX = 'source-previews/';

function objectName(page: number): string {
  return `page-${String(page)}.webp`;
}

/**
 * Durable source-page previews in the existing public Supabase bucket. The deterministic object
 * path lets the CDN cache one immutable preview per document page across Vercel cold starts.
 */
export class SupabasePagePreviewStore implements PagePreviewStore {
  private readonly client: ReturnType<typeof createClient>;

  constructor(
    url: string,
    serviceKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceKey);
  }

  async find(documentId: string, page: number): Promise<string | null> {
    const prefix = `${PREVIEW_PREFIX}${documentId}/`;
    const name = objectName(page);
    const { data, error } = await this.client.storage.from(this.bucket).list(prefix, { limit: 1, search: name });
    if (error) throw errors.imageUploadFailed(error.message);
    if (!data.some((entry) => entry.name === name)) return null;
    return this.publicUrl(`${prefix}${name}`);
  }

  async save(documentId: string, page: number, bytes: Buffer): Promise<string> {
    const path = `${PREVIEW_PREFIX}${documentId}/${objectName(page)}`;
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
    if (error) throw errors.imageUploadFailed(error.message);
    return this.publicUrl(path);
  }

  private publicUrl(path: string): string {
    return this.client.storage.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }
}
