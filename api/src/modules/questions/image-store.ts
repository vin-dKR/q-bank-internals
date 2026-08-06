/**
 * Storage PORT (§3) for verified question/option image crops. Implemented against Supabase (the
 * same bucket the main bank reads) in `infrastructure/storage`, with a null-object when unconfigured.
 */
export interface ImageStore {
  /** Upload image bytes under `name`; returns the public URL to save on the question. */
  upload(name: string, bytes: Buffer, contentType: string): Promise<string>;
}
