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
  // The agent API's only 409 is a stale subject version: re-review, don't retry.
  409: "STALE_SUBJECT",
  429: "SATELLA_RATE_LIMITED",
};

/**
 * A failed call to the agent API. Carries Satella's own error code (e.g.
 * `INVALID_CURSOR`, `VALIDATION`) for diagnosis, but never its message or
 * any other part of the body: minimal logs (CLAUDE.md §4).
 */
export class SatellaApiError extends DomainError {
  constructor(
    readonly code: SatellaErrorCode,
    readonly request: string,
    readonly status: number | null,
    readonly details: {
      /** Satella's `error.code`, when the body had one. */
      satellaCode?: string | null;
      /** Set on `SATELLA_RATE_LIMITED` when Satella sent `Retry-After`. */
      retryAfterSeconds?: number | null;
    } = {},
  ) {
    const satellaCode = details.satellaCode ?? null;
    super(
      `${request} failed: ${code}` +
        (status === null ? "" : ` (${String(status)})`) +
        (satellaCode === null ? "" : ` [${satellaCode}]`),
    );
  }

  get satellaCode(): string | null {
    return this.details.satellaCode ?? null;
  }

  get retryAfterSeconds(): number | null {
    return this.details.retryAfterSeconds ?? null;
  }

  static fromResponse(
    request: string,
    status: number,
    satellaCode: string | null,
    retryAfterSeconds: number | null,
  ): SatellaApiError {
    return new SatellaApiError(
      codeByStatus[status] ?? "SATELLA_UNAVAILABLE",
      request,
      status,
      {
        satellaCode,
        retryAfterSeconds: status === 429 ? retryAfterSeconds : null,
      },
    );
  }
}
