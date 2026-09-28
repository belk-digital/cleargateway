export const ERROR_CODES = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  invalid_state_transition: 409,
  rate_limited: 429,
  internal_error: 500,
  live_mode_disabled: 403,
  conflict: 409,
  not_configured: 503,
  not_implemented: 501,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Application error carrying a stable machine-readable code. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = ERROR_CODES[code];
    this.details = details;
  }
}

/** Public error envelope returned by every failing API response. */
export interface ErrorResponse {
  error: { code: ErrorCode; message: string; request_id: string; details?: unknown };
}
