// Checks the brief §4.3 metrics over a hand-made table of case results,
// whose expected values are worked out by hand below. Pure function; fakes
// nothing.
import { describe, expect, it } from "vitest";

import { computeMetrics } from "./metrics.js";
import type { CaseOutcome, CaseResult } from "./types.js";

function result(
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
            endedBy: "submitted",
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
            ...outcome,
          },
    failure: outcome === null ? "stale: missing_recording" : null,
    ...extra,
  };
}

const reject = { decisions: ["reject"], autonomy: "auto_resolved" } as const;
const ask = { decisions: ["request_info"], autonomy: "escalated" } as const;
const approve = { decisions: ["approve"], autonomy: "auto_resolved" } as const;

// Scored, gated: 10, 13, 15, N1.
// - 10: reject/auto, confidence 0.9 → correct, autonomy right.
// - 13: approve/auto, confidence 0.8 → wrong, an approved fraud, autonomy wrong.
// - 15: request_info/escalated, confidence 0.6 → correct, autonomy right.
// - N1: approve/escalated, confidence 0.7 → correct, autonomy wrong.
const table: CaseResult[] = [
  result("10", reject, {
    decision: "reject",
    confidence: 0.9,
    inputTokens: 1000,
    outputTokens: 100,
    latencyMs: 2000,
  }),
  result("13", ask, {
    decision: "approve",
    confidence: 0.8,
    inputTokens: 2000,
    outputTokens: 300,
    latencyMs: 4000,
  }),
  result("15", ask, {
    decision: "request_info",
    autonomy: "escalated",
    confidence: 0.6,
    inputTokens: 3000,
    outputTokens: 200,
    latencyMs: 1000,
  }),
  result("N1", approve, {
    decision: "approve",
    autonomy: "escalated",
    confidence: 0.7,
    inputTokens: 2000,
    outputTokens: 200,
    latencyMs: 1000,
  }),
  // Needs the external tools: an approved fraud that doesn't count when gated.
  result(
    "01",
    reject,
    { decision: "approve", confidence: 1, inputTokens: 5000, latencyMs: 9000 },
    { external: true },
  ),
  // Couldn't run: counted, never scored.
  result("12", ask, null),
];

describe("gated metrics (external cases left out)", () => {
  const metrics = computeMetrics(table, { includeExternal: false });

  it("counts what was scored and what couldn't run", () => {
    expect(metrics).toMatchObject({ cases: 5, scored: 4, failed: 1 });
  });

  it("scores decisions, autonomy and escalations", () => {
    expect(metrics.accuracy).toBe(0.75);
    expect(metrics.autonomyAccuracy).toBe(0.5);
    expect(metrics.escalationRate).toBe(0.5);
  });

  it("rates approved fraud over the problem cases only", () => {
    // 13 of the problem cases 10, 13 and 15.
    expect(metrics.approvedFraudRate).toBeCloseTo(1 / 3);
  });

  it("computes the Brier score of confidence against correctness", () => {
    // (0.9−1)² + (0.8−0)² + (0.6−1)² + (0.7−1)² = 0.01 + 0.64 + 0.16 + 0.09
    expect(metrics.brier).toBeCloseTo(0.9 / 4);
  });

  it("averages tokens and latency per scored case", () => {
    expect(metrics.meanInputTokens).toBe(2000);
    expect(metrics.meanOutputTokens).toBe(200);
    expect(metrics.meanLatencyMs).toBe(2000);
  });
});

describe("all cases (external ones included)", () => {
  const metrics = computeMetrics(table, { includeExternal: true });

  it("counts the external approved fraud", () => {
    expect(metrics).toMatchObject({ cases: 6, scored: 5, failed: 1 });
    // 13 and 01 of the problem cases 10, 13, 15 and 01.
    expect(metrics.approvedFraudRate).toBe(0.5);
  });
});

describe("auto-approved fraud", () => {
  it("counts only the approvals that would skip the admin", () => {
    // 13: approved and auto-resolved. 15: approved, but escalated to the admin.
    // 10: rejected. Two approved frauds; one auto-approved.
    const metrics = computeMetrics(
      [
        result("13", ask, { decision: "approve", autonomy: "auto_resolved" }),
        result("15", ask, { decision: "approve", autonomy: "escalated" }),
        result("10", reject, { decision: "reject" }),
        result("N1", approve, { decision: "approve" }),
      ],
      { includeExternal: false },
    );
    expect(metrics.approvedFraudRate).toBeCloseTo(2 / 3);
    expect(metrics.autoApprovedFraudRate).toBeCloseTo(1 / 3);
  });
});

describe("nothing scored", () => {
  it("leaves the rates empty instead of dividing by zero", () => {
    const metrics = computeMetrics([result("12", ask, null)], {
      includeExternal: false,
    });
    expect(metrics).toMatchObject({
      scored: 0,
      accuracy: null,
      approvedFraudRate: null,
      autoApprovedFraudRate: null,
      brier: null,
      meanLatencyMs: null,
    });
  });
});
