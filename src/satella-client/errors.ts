import { DomainError } from "../errors.js";

export type SatellaErrorCode =
  | "SATELLA_BAD_REQUEST"
  | "SATELLA_UNAUTHORIZED"
  | "SATELLA_FORBIDDEN"
  | "SATELLA_NOT_FOUND"
  | "STALE_SUBJECT"
  | "SATELLA_RATE_LIMITED"
  | "SATELLA_UNAVAILABLE"
  | "SATELLA_CONTRACT_VIOLATION";

const codeByStatus: Partial<Record<number, SatellaErrorCode>> = {
  400: "SATELLA_BAD_REQUEST",
  401: "SATELLA_UNAUTHORIZED",
  403: "SATELLA_FORBIDDEN",
  404: "SATELLA_NOT_FOUND",
  // The only documented 409 is a stale subject version: re-review, don't retry.
  409: "STALE_SUBJECT",
  429: "SATELLA_RATE_LIMITED",
};

/**
 * A failed call to the agent API. The message names the request and status
 * only: response bodies never reach logs (CLAUDE.md §4, minimal logs).
 */
export class SatellaApiError extends DomainError {
  constructor(
    readonly code: SatellaErrorCode,
    readonly request: string,
    readonly status: number | null,
    /** Set on `SATELLA_RATE_LIMITED` when Satella sent `Retry-After`. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(
      `${request} failed: ${code}${status === null ? "" : ` (${String(status)})`}`,
    );
  }

  static fromStatus(
    request: string,
    status: number,
    retryAfterSeconds: number | null,
  ): SatellaApiError {
    return new SatellaApiError(
      codeByStatus[status] ?? "SATELLA_UNAVAILABLE",
      request,
      status,
      status === 429 ? retryAfterSeconds : null,
    );
  }
}
