// Checks the eval report's Markdown: deterministic (same results, same text,
// whatever order they arrive in), with the metrics per provider/model and a
// row per case with expected versus actual and the policy's reasons, and each
// set's history as a table and a chart. Pure function; fakes nothing.
import { describe, expect, it } from "vitest";

import type { HistoryEntry } from "./history.js";
import { computeMetrics } from "./metrics.js";
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
    authoredWeb: false,
    venue: [
      { check: "venue_exists", verdict: "pass" },
      { check: "venue_capacity", verdict: "unknown" },
    ],
    endedBy: "submitted",
    inputTokens: 12_345,
    outputTokens: 678,
    latencyMs: 4321,
    costMicros: 2150,
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
  expect(report).toContain("| Mean cost per review | $0.0022 | $0.0022 |");
});

it("lists each case with expected versus actual and the policy's reasons", () => {
  const report = renderReport([set]);
  expect(report).toContain(
    "| 03 | Madrid postal code with province Sevilla | ✅ request_info | ❌ auto_resolved → escalated | 0.80 | venue pass · capacity unknown | confidence 0.8 below 0.85; a \\| pipe |",
  );
  expect(report).toContain(
    "| 01 | Bar of 150 selling 2,000 tickets | — reject | — auto_resolved | — | — | stale: request_changed |",
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

describe("history", () => {
  const gated = computeMetrics([scored], { includeExternal: false });
  const entry = (
    id: string,
    note: string,
    moved: Partial<typeof gated>,
    model = "qwen/qwen3.5-9b",
  ): HistoryEntry => ({
    id,
    date: "2026-11-02",
    provider: "lmstudio",
    model,
    promptVersions: ["review-v2"],
    note,
    gated: { ...gated, ...moved },
    all: gated,
  });
  const history = [
    entry("E001", "Baseline | first.", {
      accuracy: 0.5909,
      approvedFraudRate: 0.3889,
      autoApprovedFraudRate: 0,
      brier: 0.3021,
    }),
    entry("E002", "Other model.", { accuracy: 0.1 }, "other"),
    entry("E003", "Threshold 0.9.", {
      accuracy: 0.6364,
      approvedFraudRate: 0.3333,
      autoApprovedFraudRate: null,
      brier: 0.25,
    }),
  ];

  it("lists the set's own entries in order, with the key gated metrics", () => {
    const report = renderReport([set], history);
    expect(report).toContain(
      [
        "### History",
        "",
        "| Entry | Date | Prompt | Note | Accuracy | Approved fraud | Auto-approved fraud | Brier |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| E001 | 2026-11-02 | `review-v2` | Baseline \\| first. | 59.1 % | 38.9 % | 0.0 % | 0.302 |",
        "| E003 | 2026-11-02 | `review-v2` | Threshold 0.9. | 63.6 % | 33.3 % | — | 0.250 |",
        "",
      ].join("\n"),
    );
    expect(report).not.toContain("| E002 |");
  });

  it("draws the gated rates over the entries as a Mermaid line chart", () => {
    const report = renderReport([set], history);
    expect(report).toContain(
      [
        "```mermaid",
        "xychart-beta",
        '  title "Gated cases over the history (%)"',
        "  x-axis [E001, E003]",
        '  y-axis "%" 0 --> 100',
        "  line [59.1, 63.6]",
        "  line [38.9, 33.3]",
        "  line [0, 0]",
        "```",
      ].join("\n"),
    );
    expect(report).toContain(
      "Lines, in order: accuracy, approved-fraud rate, auto-approved fraud rate.",
    );
  });

  it("renders the same history the same way, after the metrics and before the cases", () => {
    const report = renderReport([set], history);
    expect(renderReport([set], [...history])).toBe(report);
    expect(report.indexOf("### History")).toBeGreaterThan(
      report.indexOf("| Mean latency |"),
    );
    expect(report.indexOf("### History")).toBeLessThan(
      report.indexOf("### Gated cases"),
    );
  });

  it("says when a set has no entries yet", () => {
    expect(renderReport([set], [])).toContain(
      'No entries yet: run `pnpm eval:replay --note "<what changed>"`.',
    );
  });
});
