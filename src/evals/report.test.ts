// Checks the eval report's Markdown: deterministic (same results, same text,
// whatever order they arrive in), with the metrics per provider/model and a
// row per case with expected versus actual and the policy's reasons. Pure
// function; fakes nothing.
import { expect, it } from "vitest";

import { renderReport, type ReportSet } from "./report.js";
import type { CaseResult } from "./types.js";

const scored: CaseResult = {
  caseId: "03",
  slug: "postal-code-other-province",
  title: "Madrid postal code with province Sevilla",
  problem: true,
  external: false,
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  outcome: {
    decision: "request_info",
    autonomy: "escalated",
    confidence: 0.8,
    reasons: ["confidence 0.8 below 0.85", "a | pipe"],
    endedBy: "submitted",
    inputTokens: 12_345,
    outputTokens: 678,
    latencyMs: 4321,
  },
  failure: null,
};

const stale: CaseResult = {
  caseId: "01",
  slug: "bar-sells-past-capacity",
  title: "Bar of 150 selling 2,000 tickets",
  problem: true,
  external: true,
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  outcome: null,
  failure: "stale: request_changed",
};

const set: ReportSet = {
  provider: "lmstudio",
  model: "qwen/qwen3.5-9b",
  promptVersions: ["review-v2"],
  recordedOn: ["2026-11-02"],
  results: [scored, stale],
};

it("renders the same Markdown for the same results, in any order", () => {
  const report = renderReport([set]);
  expect(renderReport([{ ...set, results: [stale, scored] }])).toBe(report);
  expect(report.endsWith("\n")).toBe(true);
});

it("shows the metrics of each provider and model", () => {
  const report = renderReport([set]);
  expect(report).toContain("## lmstudio / qwen/qwen3.5-9b");
  expect(report).toContain("Prompt `review-v2` · recorded 2026-11-02");
  expect(report).toContain("| Approved-fraud rate | 0.0 % | 0.0 % |");
  expect(report).toContain("| Cases scored | 1 / 1 | 1 / 2 |");
  expect(report).toContain("| Brier score | 0.040 | 0.040 |");
  expect(report).toContain("| Mean latency | 4.3 s | 4.3 s |");
});

it("lists each case with expected versus actual and the policy's reasons", () => {
  const report = renderReport([set]);
  expect(report).toContain(
    "| 03 | Madrid postal code with province Sevilla | ✅ request_info | ❌ auto_resolved → escalated | 0.80 | confidence 0.8 below 0.85; a \\| pipe |",
  );
  expect(report).toContain(
    "| 01 | Bar of 150 selling 2,000 tickets | — reject | — auto_resolved | — | stale: request_changed |",
  );
});

it("lists the cases that need the external tools apart, after the gated ones", () => {
  const report = renderReport([set]);
  const gated = report.indexOf("### Gated cases");
  const external = report.indexOf(
    "### Cases that need the external tools (#7)",
  );
  expect(gated).toBeGreaterThan(-1);
  expect(external).toBeGreaterThan(gated);
  expect(report.indexOf("| 03 |")).toBeGreaterThan(gated);
  expect(report.indexOf("| 03 |")).toBeLessThan(external);
  expect(report.indexOf("| 01 |")).toBeGreaterThan(external);
});

it("says when there are no recordings at all", () => {
  expect(renderReport([])).toContain("No recordings yet");
});
