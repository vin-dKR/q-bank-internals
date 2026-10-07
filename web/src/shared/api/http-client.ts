import type { z } from 'zod';
import { JSON_STREAM_CONTENT_TYPE } from '@ingest/contracts';
import { config } from '../../config/env.js';
import { ApiError } from './api-error.js';
import { readJsonEvents } from './read-json-events.js';
export { ApiError } from './api-error.js';

type RequestOptions<S extends z.ZodTypeAny> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Schema the `data` payload is validated against — reuses @ingest/contracts, so no drift (§6.1). */
  schema: S;
  /** Public API adapters can validate a direct JSON response instead of our `{ data }` envelope. */
  raw?: boolean;
  timeoutMs?: number;
};

/**
 * The ONE http client for the whole app (§6.4). Unwraps `{ data }`, throws `ApiError` on `{ error }`,
 * and validates the payload against the shared contract schema so the frontend never trusts an
 * unvalidated shape. Every feature's `api/` layer calls through here — never `fetch` directly.
 */
async function sendRequest(
  path: string,
  options: Pick<RequestOptions<z.ZodTypeAny>, 'method' | 'body' | 'timeoutMs'>,
  accept?: string,
): Promise<Response> {
  const init: RequestInit = { method: options.method ?? 'GET' };
  const headers = new Headers();
  if (accept) headers.set('accept', accept);
  if (options.timeoutMs) init.signal = AbortSignal.timeout(options.timeoutMs);
  if (options.body instanceof FormData) {
    // Let the browser set the multipart boundary; do NOT set content-type ourselves.
    init.body = options.body;
  } else if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  init.headers = headers;
  return fetch(path.startsWith('https://') ? path : `${config.apiBaseUrl}${path}`, init);
}

async function jsonPayload(response: Response): Promise<unknown> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      .error;
    throw new ApiError(
      error?.code ?? 'UNKNOWN',
      response.status,
      error?.message ?? 'Request failed',
      error?.details,
    );
  }

  return payload;
}

export async function request<S extends z.ZodTypeAny>(
  path: string,
  options: RequestOptions<S>,
): Promise<z.infer<S>> {
  const payload = await jsonPayload(await sendRequest(path, options));
  const data = options.raw ? payload : (payload as { data: unknown }).data;
  return options.schema.parse(data) as z.infer<S>;
}

/** One streamed POST; connection failures never retry a potentially paid AI request. */
export async function requestEvents<S extends z.ZodTypeAny>(
  path: string,
  options: Omit<RequestOptions<S>, 'raw'> & {
    onEvent: (event: z.infer<S>) => boolean;
    /** An older server's ordinary JSON result can be consumed without issuing another request. */
    onJsonResponse: (data: unknown) => void;
  },
): Promise<void> {
  const response = await sendRequest(path, options, JSON_STREAM_CONTENT_TYPE);
  if (!response.ok || !response.headers.get('content-type')?.startsWith(JSON_STREAM_CONTENT_TYPE)) {
    const payload = await jsonPayload(response);
    options.onJsonResponse((payload as { data: unknown }).data);
    return;
  }
  try {
    if (!response.body) throw new Error('Missing progress response body.');
    await readJsonEvents(response.body, (value) =>
      options.onEvent(options.schema.parse(value) as z.infer<S>),
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      'STREAM_INTERRUPTED',
      response.status,
      'The progress connection was interrupted or returned invalid data. Generation was not restarted automatically.',
    );
  }
}
