// Checks the eval report's Markdown: deterministic (same results, same text,
// whatever order they arrive in), with the metrics per provider/model and a
// row per case with expected versus actual and the policy's reasons, and each
// set's history as a table and a chart; with repeated runs (#42), the mean
// and range of each metric and each case's agreement across runs. Pure
// function; fakes nothing.
import { describe, expect, it } from "vitest";

import { caseResult } from "../test-support/fake-results.js";
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
    modelConfidence: 0.8,
    reasons: ["needs judgement: service_fee", "a | pipe"],
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
  runs: [[scored, stale]],
};

it("renders the same Markdown for the same results, in any order", () => {
  const report = renderReport([set]);
  expect(renderReport([{ ...set, runs: [[stale, scored]] }])).toBe(report);
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
    "| 03 | Madrid postal code with province Sevilla | ✅ request_info | ❌ auto_resolved → escalated | 0.80 | venue pass · capacity unknown | needs judgement: service_fee; a \\| pipe |",
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
        "| Entry | Date | Prompt | Runs | Note | Accuracy | Approved fraud | Auto-approved fraud | Brier |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| E001 | 2026-11-02 | `review-v2` | 1 | Baseline \\| first. | 59.1 % | 38.9 % | 0.0 % | 0.302 |",
        "| E003 | 2026-11-02 | `review-v2` | 1 | Threshold 0.9. | 63.6 % | 33.3 % | — | 0.250 |",
        "",
      ].join("\n"),
    );
    expect(report).not.toContain("| E002 |");
  });

  it("embeds the history charts once, light and dark, before the sets", () => {
    const report = renderReport([set], history);
    expect(report).toContain(
      [
        "<picture>",
        '  <source media="(prefers-color-scheme: dark)" srcset="charts/accuracy-dark.svg">',
        '  <img alt="Gated accuracy per history entry, one line per recording set" src="charts/accuracy-light.svg">',
        "</picture>",
      ].join("\n"),
    );
    expect(report).toContain('srcset="charts/rates-dark.svg"');
    expect(report.split("charts/accuracy-light.svg")).toHaveLength(2);
    expect(report).not.toContain("```mermaid");
    expect(report.indexOf("## History")).toBeLessThan(
      report.indexOf("## lmstudio"),
    );
  });

  it("draws no charts before there is any history", () => {
    expect(renderReport([set], [])).not.toContain("<picture>");
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

describe("repeated runs", () => {
  const reject = { decisions: ["reject"], autonomy: "auto_resolved" } as const;
  const approve = {
    decisions: ["approve"],
    autonomy: "auto_resolved",
  } as const;
  // 10 rejected twice and approved once; N1 approved, approved, asked.
  const repeated: ReportSet = {
    ...set,
    provider: "anthropic",
    model: "claude-haiku-5-5",
    runs: [
      [
        caseResult("10", reject, { decision: "reject", confidence: 0.9 }),
        caseResult("N1", approve, { confidence: 0.9 }),
      ],
      [
        caseResult("10", reject, {
          decision: "reject",
          autonomy: "escalated",
          confidence: 0.7,
          reasons: ["needs judgement: service_fee"],
        }),
        caseResult("N1", approve, { confidence: 0.9 }),
      ],
      [
        caseResult("10", reject, { confidence: 0.8 }),
        caseResult("N1", approve, {
          decision: "request_info",
          autonomy: "escalated",
          confidence: 0.6,
        }),
      ],
    ],
  };

  it("says how many runs the metrics average, and shows each decisive one's range", () => {
    const report = renderReport([repeated]);
    expect(report).toContain(
      "Prompt `review-v2` · recorded 2026-11-02 · 3 runs per case: means, with the min–max across runs",
    );
    expect(report).toContain(
      "| Accuracy | 66.7 % (0.0–100.0) | 66.7 % (0.0–100.0) |",
    );
    expect(report).toContain(
      "| Autonomy accuracy | 66.7 % (50.0–100.0) | 66.7 % (50.0–100.0) |",
    );
    // Not a decisive metric: the mean alone.
    expect(report).toContain("| Escalation rate | 33.3 % | 33.3 % |");
  });

  it("shows how many runs agree on each case, right only by majority", () => {
    const report = renderReport([repeated]);
    expect(report).toContain(
      "| 10 | 10 | ✅ reject 2/3 · approve 1/3 | ✅ auto_resolved 2/3 · escalated 1/3 | 0.70–0.90 | — |  |",
    );
    expect(report).toContain(
      "| N1 | N1 | ✅ approve 2/3 · request_info 1/3 | ✅ auto_resolved 2/3 · escalated 1/3 | 0.60–0.90 | — |  |",
    );
  });

  it("marks a tie as wrong, and names a run that couldn't replay", () => {
    const tie: ReportSet = {
      ...repeated,
      runs: [
        [caseResult("10", reject, { decision: "reject", confidence: 0.9 })],
        [caseResult("10", reject, { confidence: 0.9 })],
        [caseResult("10", reject, null)],
      ],
    };
    expect(renderReport([tie])).toContain(
      "| 10 | 10 | ❌ reject → approve 1/3 · reject 1/3 | ✅ auto_resolved 2/3 | 0.90 | — | run 3: stale: missing_recording |",
    );
  });

  it("marks the history's single-run entries apart from the means over runs", () => {
    const gated = computeMetrics([scored], { includeExternal: false });
    const range = (min: number, max: number): [number, number] => [min, max];
    const spread = {
      accuracy: range(0.5667, 0.6333),
      approvedFraudRate: range(0, 0.04),
      autoApprovedFraudRate: range(0, 0),
      autonomyAccuracy: range(0.8, 0.85),
    };
    const base = {
      date: "2026-11-04",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      promptVersions: ["review-v2"],
      all: gated,
    };
    const report = renderReport(
      [repeated],
      [
        { ...base, id: "E001", note: "One run.", gated },
        {
          ...base,
          id: "E002",
          note: "Three runs.",
          runs: 3,
          gated: { ...gated, accuracy: 0.6, approvedFraudRate: 0.0133 },
          spread: { gated: spread, all: spread },
        },
      ],
    );
    expect(report).toContain(
      "| E001 | 2026-11-04 | `review-v2` | 1 | One run. | 100.0 % | 0.0 % | 0.0 % | 0.040 |",
    );
    expect(report).toContain(
      "| E002 | 2026-11-04 | `review-v2` | 3 | Three runs. | 60.0 % (56.7–63.3) | 1.3 % (0.0–4.0) | 0.0 % (0.0–0.0) | 0.040 |",
    );
  });
});
