/**
 * Metrics over repeated runs of the same cases (#42). The model isn't
 * deterministic, so one pass can't tell its noise from a real change: a set
 * reports each metric's mean over its runs, the min–max of the four that
 * decide an experiment, and each case's majority outcome.
 */
import type { Autonomy } from "../agent/policy.js";
import type { Decision } from "../satella-client/schemas.js";
import { computeMetrics, type Metrics } from "./metrics.js";
import type { CaseResult } from "./types.js";

/** The metrics an experiment is decided on: their spread is kept. */
export const SPREAD_METRICS = [
  "accuracy",
  "approvedFraudRate",
  "autoApprovedFraudRate",
  "autonomyAccuracy",
] as const satisfies readonly (keyof Metrics)[];

export type SpreadMetric = (typeof SPREAD_METRICS)[number];

/** `[min, max]` across runs; null when no run had a case to measure. */
export type Spread = Record<SpreadMetric, [number, number] | null>;

export interface RunMetrics {
  runs: number;
  /**
   * Each rate and mean averaged over the runs that measured it. `cases` is
   * one run's; `scored` the fewest of any run and `failed` the most.
   */
  mean: Metrics;
  spread: Spread;
}

export function computeRunMetrics(
  runs: readonly (readonly CaseResult[])[],
  options: { includeExternal: boolean },
): RunMetrics {
  const each = runs.map((results) => computeMetrics(results, options));
  const values = (key: keyof Metrics) =>
    each.map((metrics) => metrics[key]).filter((v): v is number => v !== null);
  const average = (key: keyof Metrics) => {
    const measured = values(key);
    return measured.length === 0
      ? null
      : measured.reduce((total, v) => total + v, 0) / measured.length;
  };
  const range = (key: SpreadMetric): [number, number] | null => {
    const measured = values(key);
    return measured.length === 0
      ? null
      : [Math.min(...measured), Math.max(...measured)];
  };

  return {
    runs: runs.length,
    mean: {
      cases: each[0]?.cases ?? 0,
      scored: Math.min(...values("scored")),
      failed: Math.max(...values("failed")),
      accuracy: average("accuracy"),
      approvedFraudRate: average("approvedFraudRate"),
      autoApprovedFraudRate: average("autoApprovedFraudRate"),
      escalationRate: average("escalationRate"),
      autonomyAccuracy: average("autonomyAccuracy"),
      brier: average("brier"),
      meanInputTokens: average("meanInputTokens"),
      meanOutputTokens: average("meanOutputTokens"),
      meanLatencyMs: average("meanLatencyMs"),
    },
    spread: {
      accuracy: range("accuracy"),
      approvedFraudRate: range("approvedFraudRate"),
      autoApprovedFraudRate: range("autoApprovedFraudRate"),
      autonomyAccuracy: range("autonomyAccuracy"),
    },
  };
}

/**
 * One list per case of its results across runs, in run order; cases in run
 * 1's order. Every run replays the same cases, so they line up.
 */
export function byCase(
  runs: readonly (readonly CaseResult[])[],
): CaseResult[][] {
  const [first = []] = runs;
  return first.map((result) =>
    runs.flatMap((run) => run.filter((r) => r.caseId === result.caseId)),
  );
}

export interface MajorityOutcome {
  /** Null on a tie, or when too few runs scored to make a majority. */
  decision: Decision | null;
  autonomy: Autonomy | null;
  /** A tie matches nothing: a case the model can't settle isn't right. */
  correct: boolean;
  autonomyCorrect: boolean;
}

/** What more than half of a case's runs decided; a failed run votes for nothing. */
export function majorityOutcome(
  results: readonly CaseResult[],
): MajorityOutcome {
  const [first] = results;
  const decision = majority(results.map((r) => r.outcome?.decision));
  const autonomy = majority(results.map((r) => r.outcome?.autonomy));
  return {
    decision,
    autonomy,
    correct:
      decision !== null &&
      (first?.expected.decisions.includes(decision) ?? false),
    autonomyCorrect: autonomy !== null && autonomy === first?.expected.autonomy,
  };
}

/** Whether more than half of a case's runs pass `test`. */
export function inMajority(
  results: readonly CaseResult[],
  test: (result: CaseResult) => boolean,
): boolean {
  return results.filter(test).length * 2 > results.length;
}

function majority<T>(votes: readonly (T | undefined)[]): T | null {
  for (const vote of new Set(votes)) {
    if (vote === undefined) continue;
    if (votes.filter((v) => v === vote).length * 2 > votes.length) return vote;
  }
  return null;
}
