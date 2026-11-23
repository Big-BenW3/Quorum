/** Typed application errors. Messages are safe to show to clients; never put roster or ballot data in them. */

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "BAD_ORIGIN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INVALID_STATE"
  | "ROSTER_FROZEN"
  | "BALLOT_FROZEN"
  | "ELECTION_NOT_OPEN"
  | "VERIFICATION_FAILED"
  | "ALREADY_VOTED"
  | "CREDENTIAL_INVALID"
  | "BALLOT_INVALID"
  | "RESULTS_NOT_AVAILABLE"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_FAILED"
  | "CONFIG_ERROR"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  BAD_ORIGIN: 403,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INVALID_STATE: 409,
  ROSTER_FROZEN: 409,
  BALLOT_FROZEN: 409,
  ELECTION_NOT_OPEN: 409,
  VERIFICATION_FAILED: 403,
  ALREADY_VOTED: 409,
  CREDENTIAL_INVALID: 403,
  BALLOT_INVALID: 422,
  RESULTS_NOT_AVAILABLE: 403,
  PROVIDER_NOT_CONFIGURED: 501,
  PROVIDER_FAILED: 502,
  CONFIG_ERROR: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { fields?: Record<string, string>; retryAfterSec?: number; [k: string]: unknown },
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const notFound = (what = "That resource") => new AppError("NOT_FOUND", `${what} was not found.`);
export const forbidden = (msg = "You don't have permission to do that.") => new AppError("FORBIDDEN", msg);
export const invalidState = (msg: string) => new AppError("INVALID_STATE", msg);
export const configError = (msg: string) => new AppError("CONFIG_ERROR", msg);
