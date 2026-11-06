/**
 * The brief §4.3 offline metrics over case results. Cases that couldn't run
 * (stale, missing or failed) are counted but never scored: a missing answer
 * is neither right nor wrong. Rationale quality is out of scope (#6).
 */
import type { CaseOutcome, CaseResult } from "./types.js";

export interface Metrics {
  cases: number;
  scored: number;
  failed: number;
  /** The decision is one of the expected ones. */
  accuracy: number | null;
  /** Problem cases (the numbered ones) that ended in `approve`: the critical metric. */
  approvedFraudRate: number | null;
  /**
   * Problem cases that ended in `approve` + `auto_resolved`: the only
   * combination that skips the admin in Satella (ADR 0012). CI gates on it.
   */
  autoApprovedFraudRate: number | null;
  escalationRate: number | null;
  autonomyAccuracy: number | null;
  /** Mean of (confidence − correct)²: 0 is perfect calibration. */
  brier: number | null;
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  meanLatencyMs: number | null;
}

type Scored = CaseResult & { outcome: CaseOutcome };

export function computeMetrics(
  results: readonly CaseResult[],
  options: { includeExternal: boolean },
): Metrics {
  const cases = results.filter(
    (result) => options.includeExternal || !result.external,
  );
  const scored = cases.filter(
    (result): result is Scored => result.outcome !== null,
  );
  const problems = scored.filter((result) => result.problem);
  const correct = (result: Scored) =>
    result.expected.decisions.includes(result.outcome.decision);

  return {
    cases: cases.length,
    scored: scored.length,
    failed: cases.length - scored.length,
    accuracy: share(scored, correct),
    approvedFraudRate: share(
      problems,
      (result) => result.outcome.decision === "approve",
    ),
    autoApprovedFraudRate: share(problems, (result) =>
      isAutoApproved(result.outcome),
    ),
    escalationRate: share(
      scored,
      (result) => result.outcome.autonomy === "escalated",
    ),
    autonomyAccuracy: share(
      scored,
      (result) => result.outcome.autonomy === result.expected.autonomy,
    ),
    brier: mean(
      scored,
      (result) => (result.outcome.confidence - (correct(result) ? 1 : 0)) ** 2,
    ),
    meanInputTokens: mean(scored, (result) => result.outcome.inputTokens),
    meanOutputTokens: mean(scored, (result) => result.outcome.outputTokens),
    meanLatencyMs: mean(scored, (result) => result.outcome.latencyMs),
  };
}

/**
 * `approve` + `auto_resolved`: the only outcome that skips the admin in
 * Satella (ADR 0012). The rate and the CI gate both read it from here.
 */
export function isAutoApproved(outcome: CaseOutcome | null): boolean {
  return (
    outcome?.decision === "approve" && outcome.autonomy === "auto_resolved"
  );
}

function share<T>(items: readonly T[], test: (item: T) => boolean) {
  return mean(items, (item) => (test(item) ? 1 : 0));
}

function mean<T>(items: readonly T[], value: (item: T) => number) {
  if (items.length === 0) return null;
  return items.reduce((total, item) => total + value(item), 0) / items.length;
}
