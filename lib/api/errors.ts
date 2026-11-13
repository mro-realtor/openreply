/**
 * Structured API errors shared by the REST API and the MCP server.
 */

export type ApiErrorCode =
  | "FEATURE_DISABLED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CAMPAIGN_NOT_DRAFT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export const apiErrors = {
  featureDisabled: () =>
    new ApiError("FEATURE_DISABLED", 404, "Not found"),
  unauthenticated: (message = "A valid API token is required") =>
    new ApiError("UNAUTHENTICATED", 401, message, {
      headers: { "WWW-Authenticate": 'Bearer realm="openreply"' },
    }),
  forbidden: (message = "This token does not have the required scope") =>
    new ApiError("FORBIDDEN", 403, message),
  notFound: (what = "Resource") =>
    new ApiError("NOT_FOUND", 404, `${what} not found`),
  validation: (message: string, details?: unknown) =>
    new ApiError("VALIDATION_FAILED", 400, message, { details }),
  notDraft: () =>
    new ApiError(
      "CAMPAIGN_NOT_DRAFT",
      409,
      "Only inactive draft campaigns can be edited through the API"
    ),
  idempotencyReused: () =>
    new ApiError(
      "IDEMPOTENCY_KEY_REUSED",
      422,
      "This Idempotency-Key was already used with a different request body"
    ),
  idempotencyInProgress: () =>
    new ApiError(
      "IDEMPOTENCY_IN_PROGRESS",
      409,
      "A request with this Idempotency-Key is still being processed"
    ),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError("RATE_LIMITED", 429, "Too many requests", {
      headers: { "Retry-After": String(retryAfterSeconds) },
    }),
  unavailable: (message = "Service temporarily unavailable") =>
    new ApiError("SERVICE_UNAVAILABLE", 503, message),
};

export interface ErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
  requestId: string;
}

export function errorBody(error: ApiError, requestId: string): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
    requestId,
  };
}
