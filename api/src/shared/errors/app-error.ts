/**
 * The one error type the whole backend throws (§7). Carries a machine `code`, an HTTP `status`,
 * and a `message` safe to show a client. Construct these via the catalog in `error-catalog.ts`,
 * never by hand — that keeps status/code pairs consistent across the codebase.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}
