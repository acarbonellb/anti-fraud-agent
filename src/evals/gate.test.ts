// Checks what fails `pnpm eval:replay --check` over the replayed sets: a run
// that couldn't replay, and a gated fraud case that any of its runs approved
// as `auto_resolved` (#57). Pure function over hand-made results;
// fakes nothing.
import { expect, it } from "vitest";

import { caseResult as result } from "./fake-results.js";
import { gateFailures } from "./gate.js";
import type { ReportSet } from "./report.js";
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
