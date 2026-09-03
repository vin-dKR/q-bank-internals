/**
 * Storage PORT (§3) for staging a large chapter PDF that the browser uploads directly, bypassing the
 * serverless request-body limit (~4.5 MB) that a multipart upload through our function would hit.
 *
 * The flow: {@link createSignedUpload} mints a single-use URL the browser PUTs the bytes to; ingestion
 * then {@link download}s those bytes server-to-server (no request-body limit applies) and, once the
 * durable Document is filed, {@link remove}s the temporary object. Implemented against Supabase Storage
 * in `infrastructure/storage`, with a null-object when unconfigured.
 */
export interface UploadStagingStore {
  /** Mint a signed, single-use upload slot for a PDF of this name; returns where to PUT and what to ingest. */
  createSignedUpload(fileName: string): Promise<{ path: string; uploadUrl: string }>;
  /** Fetch the staged object's bytes (server-to-server) so ingestion can file them into Drive. */
  download(path: string): Promise<Buffer>;
  /** Delete the staged object once it has been filed; best-effort cleanup, never blocks the upload. */
  remove(path: string): Promise<void>;
}
