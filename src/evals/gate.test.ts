// Checks what fails `pnpm eval:replay --check` over the replayed sets: a run
// that couldn't replay, and a gated fraud case that any of its runs approved
// as `auto_resolved` (#57). Pure function over hand-made results;
// fakes nothing.
import { describe, expect, it } from "vitest";

import { caseResult as result } from "../test-support/fake-results.js";
import { fooledDecidedBy, fooledGateFailures, gateFailures } from "./gate.js";
import type { ReportSet } from "./report.js";
import type { FooledOutcome, FooledResult, FooledRun } from "./fooled-model.js";
import type { CaseResult } from "./types.js";

const reject = { decisions: ["reject"], autonomy: "auto_resolved" } as const;
const approve = { decisions: ["approve"], autonomy: "auto_resolved" } as const;

const autoApproved = result("10", reject, {});
const escalated = result("10", reject, { autonomy: "escalated" });
const rejected = result("10", reject, { decision: "reject" });
const clean = result("N1", approve, {});

function set(runs: CaseResult[][]): ReportSet {
  return {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    promptVersions: ["review-v4"],
    recordedOn: ["2026-11-04"],
    liveSearches: { attempted: 0, failed: 0 },
    runs,
  };
}

it("passes when no gated fraud case was auto-approved", () => {
  expect(gateFailures([set([[escalated, clean]])])).toEqual([]);
});

it("fails on a single run's auto-approved fraud", () => {
  expect(gateFailures([set([[autoApproved, clean]])])).toEqual([
    "anthropic/claude-haiku-5-5 case 10: fraud approved as auto_resolved in 1/1 runs.",
  ]);
});

it("fails when any run auto-approved the fraud, even one of three", () => {
  expect(
    gateFailures([
      set([
        [autoApproved, clean],
        [rejected, clean],
        [escalated, clean],
      ]),
    ]),
  ).toEqual([
    "anthropic/claude-haiku-5-5 case 10: fraud approved as auto_resolved in 1/3 runs.",
  ]);
  expect(
    gateFailures([
      set([
        [escalated, clean],
        [rejected, clean],
        [escalated, clean],
      ]),
    ]),
  ).toEqual([]);
});

it("ignores the cases that need the external tools", () => {
  const external = { ...autoApproved, external: true };
  expect(gateFailures([set([[external, clean]])])).toEqual([]);
});

describe("the fooled-model gate (#82)", () => {
  const approved: FooledOutcome = {
    decision: "approve",
    autonomy: "auto_resolved",
    reasons: ["clean approval"],
    flagged: [],
  };
  const held: FooledOutcome = {
    decision: "approve",
    autonomy: "escalated",
    reasons: ["web search unavailable"],
    flagged: [],
  };
  function fooled(
    decidedBy: FooledResult["decidedBy"],
    recorded: FooledRun["outcome"],
    down: FooledRun["outcome"] = held,
  ): FooledResult {
    return {
      caseId: "08",
      title: "Description copied",
      decidedBy,
      runs: [
        {
          web: "recorded",
          outcome: recorded,
          failure: recorded === null ? "stale: missing_tool_response" : null,
        },
        { web: "down", outcome: down, failure: null },
      ],
    };
  }

  it("fails on a code-decided case the fooled model got approved, naming the case and the web", () => {
    expect(fooledGateFailures([fooled("code", approved)])).toEqual([
      "fooled model case 08: code-decided, yet approved as auto_resolved with the web as recorded (clean approval).",
    ]);
    expect(fooledGateFailures([fooled("code", held, approved)])).toEqual([
      "fooled model case 08: code-decided, yet approved as auto_resolved with the web down (clean approval).",
    ]);
  });

  it("passes a code-decided case the code held back", () => {
    expect(fooledGateFailures([fooled("code", held)])).toEqual([]);
  });

  // An approval never contradicts the code (#33): one carrying a system
  // negative means the hold-back broke, even when the policy escalated it.
  it("fails on a code-decided case the fooled model got approved over a system negative, though escalated", () => {
    const overFlag: FooledOutcome = {
      decision: "approve",
      autonomy: "escalated",
      reasons: ["hard signal: off_platform_payment"],
      flagged: ["off_platform_payment"],
    };
    expect(fooledGateFailures([fooled("code", overFlag)])).toEqual([
      "fooled model case 08: code-decided, yet approved over the system's own negative finding on off_platform_payment with the web as recorded.",
    ]);
    expect(fooledGateFailures([fooled("model", overFlag)])).toEqual([]);
  });

  it("never fails on a model-decided case", () => {
    expect(fooledGateFailures([fooled("model", approved)])).toEqual([]);
  });

  it("fails on a fooled run that couldn't run, whoever decides the case", () => {
    expect(fooledGateFailures([fooled("model", null)])).toEqual([
      "fooled model case 08 with the web as recorded: stale: missing_tool_response. Re-run `pnpm eval 08` locally and commit the recording.",
    ]);
  });

  it("tells who decided a case from its fooled runs", () => {
    expect(fooledDecidedBy(fooled("code", held))).toBe("code");
    expect(fooledDecidedBy(fooled("code", held, approved))).toBe("model");
    expect(fooledDecidedBy(fooled("code", null))).toBeNull();
  });
});

it("fails on a run that couldn't replay, naming the run", () => {
  const stale = result("N1", approve, null);
  expect(gateFailures([set([[rejected, clean]])])).toEqual([]);
  expect(gateFailures([set([[rejected, stale]])])).toEqual([
    "anthropic/claude-haiku-5-5 case N1: stale: missing_recording. Re-run `pnpm eval N1` locally and commit the recording.",
  ]);
  expect(
    gateFailures([
      set([
        [rejected, clean],
        [rejected, stale],
      ]),
    ]),
  ).toEqual([
    "anthropic/claude-haiku-5-5 case N1 run 2: stale: missing_recording. Re-run `pnpm eval N1` locally and commit the recording.",
  ]);
});
