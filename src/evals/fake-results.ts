/**
 * Hand-made case results for the tests of what is computed over them
 * (metrics, runs, gate, report). Only what a test names differs from a
 * scored, gated, auto-resolved approval.
 */
import type { CaseOutcome, CaseResult } from "./types.js";

export function caseResult(
  caseId: string,
  expected: CaseResult["expected"],
  outcome: Partial<CaseOutcome> | null,
  extra: Partial<CaseResult> = {},
): CaseResult {
  return {
    caseId,
    slug: `case-${caseId}`,
    title: caseId,
    problem: !caseId.startsWith("N"),
    external: false,
    expected,
    outcome:
      outcome === null
        ? null
        : {
            decision: "approve",
            autonomy: "auto_resolved",
            confidence: 0.5,
            reasons: [],
            authoredWeb: false,
            venue: [],
            endedBy: "submitted",
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
            costMicros: 0,
            ...outcome,
          },
    failure: outcome === null ? "stale: missing_recording" : null,
    ...extra,
  };
}
