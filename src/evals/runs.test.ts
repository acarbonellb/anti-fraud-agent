// Checks the metrics over repeated runs (#42): each metric's mean and, for
// the four that decide an experiment, its min–max; and each case's majority
// outcome, where a tie matches nothing. Pure functions over hand-made results
// whose expected values are worked out by hand below; fakes nothing.
import { describe, expect, it } from "vitest";

import { caseResult as result } from "../test-support/fake-results.js";
import { byCase, computeRunMetrics, majorityOutcome } from "./runs.js";

const reject = { decisions: ["reject"], autonomy: "auto_resolved" } as const;
const approve = { decisions: ["approve"], autonomy: "auto_resolved" } as const;

// Two gated cases, three runs:
// - 10 (fraud): reject/auto 0.9 · reject/escalated 0.7 · approve/auto 0.8
// - N1 (clean): approve/auto 0.9 · approve/auto 0.9 · request_info/escalated 0.6
const runs = [
  [
    result("10", reject, { decision: "reject", confidence: 0.9 }),
    result("N1", approve, { confidence: 0.9, inputTokens: 100 }),
  ],
  [
    result("10", reject, {
      decision: "reject",
      autonomy: "escalated",
      confidence: 0.7,
    }),
    result("N1", approve, { confidence: 0.9, inputTokens: 200 }),
  ],
  [
    result("10", reject, { confidence: 0.8 }),
    result("N1", approve, {
      decision: "request_info",
      autonomy: "escalated",
      confidence: 0.6,
      inputTokens: 600,
    }),
  ],
];

describe("metrics over runs", () => {
  const metrics = computeRunMetrics(runs, { includeExternal: false });

  it("averages each run's metrics", () => {
    expect(metrics.runs).toBe(3);
    // Accuracy per run 1, 1, 0; autonomy accuracy 1, ½, ½; escalation 0, ½, ½.
    expect(metrics.mean.accuracy).toBeCloseTo(2 / 3);
    expect(metrics.mean.autonomyAccuracy).toBeCloseTo(2 / 3);
    expect(metrics.mean.escalationRate).toBeCloseTo(1 / 3);
    // Approved and auto-approved fraud per run 0, 0, 1.
    expect(metrics.mean.approvedFraudRate).toBeCloseTo(1 / 3);
    expect(metrics.mean.autoApprovedFraudRate).toBeCloseTo(1 / 3);
    // Brier per run 0.01, 0.05, (0.64 + 0.36) / 2 = 0.5.
    expect(metrics.mean.brier).toBeCloseTo(0.56 / 3);
    // Mean input tokens per run 50, 100, 300.
    expect(metrics.mean.meanInputTokens).toBe(150);
  });

  it("keeps the min–max of the metrics that decide an experiment", () => {
    expect(metrics.spread).toEqual({
      accuracy: [0, 1],
      approvedFraudRate: [0, 1],
      autoApprovedFraudRate: [0, 1],
      autonomyAccuracy: [0.5, 1],
    });
  });

  it("counts the cases of one run, the fewest scored and the most failed", () => {
    const failing = [
      runs[0] ?? [],
      [runs[1]?.[0] ?? result("10", reject, {}), result("N1", approve, null)],
    ];
    expect(
      computeRunMetrics(failing, { includeExternal: false }),
    ).toMatchObject({ mean: { cases: 2, scored: 1, failed: 1 } });
  });

  it("leaves a metric with nothing to measure empty, mean and range", () => {
    const clean = [[result("N1", approve, {})], [result("N1", approve, {})]];
    const { mean, spread } = computeRunMetrics(clean, {
      includeExternal: false,
    });
    expect(mean.approvedFraudRate).toBeNull();
    expect(spread.approvedFraudRate).toBeNull();
    expect(spread.accuracy).toEqual([1, 1]);
  });

  it("matches one run's metrics when there is one run", () => {
    const [first = []] = runs;
    const one = computeRunMetrics([first], { includeExternal: false });
    expect(one.mean.accuracy).toBe(1);
    expect(one.spread.accuracy).toEqual([1, 1]);
  });
});

describe("a case's majority outcome", () => {
  const [fraud = [], clean = []] = byCase(runs);

  it("groups each case's results across runs, in run order", () => {
    expect(fraud.map((r) => r.outcome?.confidence)).toEqual([0.9, 0.7, 0.8]);
    expect(clean.map((r) => r.caseId)).toEqual(["N1", "N1", "N1"]);
  });

  it("takes the decision and autonomy most runs agree on", () => {
    expect(majorityOutcome(fraud)).toEqual({
      decision: "reject",
      autonomy: "auto_resolved",
      correct: true,
      autonomyCorrect: true,
    });
  });

  it("matches nothing on a tie", () => {
    const tie = [
      result("10", reject, { decision: "reject" }),
      result("10", reject, { decision: "approve" }),
    ];
    expect(majorityOutcome(tie)).toEqual({
      decision: null,
      autonomy: "auto_resolved",
      correct: false,
      autonomyCorrect: true,
    });
  });

  it("needs a majority of the runs, not of the runs that scored", () => {
    const thin = [
      result("10", reject, { decision: "reject" }),
      result("10", reject, null),
      result("10", reject, null),
    ];
    expect(majorityOutcome(thin)).toMatchObject({
      decision: null,
      correct: false,
    });
  });
});
