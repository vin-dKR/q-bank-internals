import { createClient } from '@supabase/supabase-js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { ImageStore } from '../../modules/questions/index.js';

/**
 * {@link ImageStore} backed by Supabase Storage — the same bucket the main Eduents bank reads, so a
 * crop uploaded here is publish-ready. The service key stays on the server (never in the browser).
 */
export class SupabaseImageStore implements ImageStore {
  private readonly client: ReturnType<typeof createClient>;

  constructor(
    url: string,
    serviceKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceKey);
  }

  async upload(name: string, bytes: Buffer, contentType: string): Promise<string> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(name, bytes, { contentType, upsert: true });
    if (error) throw errors.imageUploadFailed(error.message);
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(name);
    return data.publicUrl;
  }
}
