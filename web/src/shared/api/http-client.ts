import type { z } from 'zod';
import { config } from '../../config/env.js';

/** The error shape the backend's error middleware always sends. Parsed here, thrown as `ApiError`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions<S extends z.ZodTypeAny> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Schema the `data` payload is validated against — reuses @ingest/contracts, so no drift (§6.1). */
  schema: S;
};

/**
 * The ONE http client for the whole app (§6.4). Unwraps `{ data }`, throws `ApiError` on `{ error }`,
 * and validates the payload against the shared contract schema so the frontend never trusts an
 * unvalidated shape. Every feature's `api/` layer calls through here — never `fetch` directly.
 */
export async function request<S extends z.ZodTypeAny>(
  path: string,
  options: RequestOptions<S>,
): Promise<z.infer<S>> {
  const init: RequestInit = { method: options.method ?? 'GET' };
  if (options.body instanceof FormData) {
    // Let the browser set the multipart boundary; do NOT set content-type ourselves.
    init.body = options.body;
  } else if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, init);

  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(error?.code ?? 'UNKNOWN', response.status, error?.message ?? 'Request failed');
  }

  const data = (payload as { data: unknown }).data;
  return options.schema.parse(data) as z.infer<S>;
}
