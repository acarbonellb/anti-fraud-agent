/**
 * Which failed reviews the pass tries again, and for how long (#57). A
 * failure that can pass (the model or Satella down, rate limited, a 5xx) is
 * queued; one that won't (a 400, a 403, a contract violation, a bug) is not,
 * since another try would fail the same way and stall the feed (ADR 0017
 * point 3).
 */
import { ProviderError } from "../providers/types.js";
import { SatellaApiError } from "../satella-client/errors.js";
import type { Subject } from "../satella-client/index.js";
import type { PendingRetry } from "../store/retry-queue.js";

/** A subject is dropped after this many failed reviews, the first included. */
export const MAX_REVIEW_FAILURES = 3;

export function isTransient(error: unknown): boolean {
  if (error instanceof SatellaApiError) {
    // `SATELLA_UNAVAILABLE` also covers a timeout and any 5xx.
    return (
      error.code === "SATELLA_UNAVAILABLE" ||
      error.code === "SATELLA_RATE_LIMITED"
    );
  }
  if (error instanceof ProviderError) {
    if (error.code === "LLM_UNAVAILABLE") return true;
    // 408 and 429 come back after a wait; Anthropic's 529 is "overloaded".
    const { status } = error;
    return (
      error.code === "LLM_HTTP_ERROR" &&
      status !== null &&
      (status === 408 || status === 429 || status >= 500)
    );
  }
  return false;
}

export function subjectKey(subject: Subject): string {
  return `${subject.type}:${subject.id}`;
}

export type ReviewOutcome =
  | { outcome: "completed" }
  | { outcome: "failed"; code: string; transient: boolean };

/**
 * The queue after one review of `subject`. A subject that failed again goes
 * to the back, so one that keeps failing doesn't hold the others up.
 */
export function afterReview(
  queue: readonly PendingRetry[],
  subject: Subject,
  review: ReviewOutcome,
): { queue: PendingRetry[]; abandoned: PendingRetry | null } {
  const key = subjectKey(subject);
  const previous = queue.find((retry) => subjectKey(retry.subject) === key);
  const rest = queue.filter((retry) => subjectKey(retry.subject) !== key);
  if (review.outcome === "completed" || !review.transient) {
    return { queue: rest, abandoned: null };
  }
  const retry: PendingRetry = {
    subject: { type: subject.type, id: subject.id },
    failures: (previous?.failures ?? 0) + 1,
    code: review.code,
  };
  return retry.failures >= MAX_REVIEW_FAILURES
    ? { queue: rest, abandoned: retry }
    : { queue: [...rest, retry], abandoned: null };
}
