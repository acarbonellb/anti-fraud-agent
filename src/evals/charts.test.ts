/**
 * The eval charts and the README summary (#102) are drawn from the history
 * alone, so CI can compare them byte for byte. Fakes nothing: history entries
 * are built inline.
 */
import { describe, expect, it } from "vitest";

import { renderCharts, seriesOf } from "./charts.js";
import type { HistoryEntry } from "./history.js";
import type { Metrics } from "./metrics.js";
import {
  renderSummary,
  SUMMARY_END,
  SUMMARY_START,
  withSummary,
} from "./readme-summary.js";

const metrics = (moved: Partial<Metrics> = {}): Metrics => ({
  cases: 30,
  scored: 30,
  failed: 0,
  accuracy: 0.7,
  approvedFraudRate: 0.1,
  autoApprovedFraudRate: 0,
  escalationRate: 0.6,
  autonomyAccuracy: 0.8,
  brier: 0.2,
  meanInputTokens: 1000,
  meanOutputTokens: 100,
  meanLatencyMs: 1000,
  ...moved,
});

const entry = (
  id: string,
  model: string,
  moved: Partial<Metrics> = {},
  spread?: [number, number],
): HistoryEntry => ({
  id,
  date: "2026-11-02",
  provider: model === "local" ? "lmstudio" : "anthropic",
  model,
  promptVersions: ["review-v2"],
  note: "A <change> & more",
  gated: metrics(moved),
  all: metrics(moved),
  ...(spread === undefined
    ? {}
    : {
        runs: 3,
        spread: {
          gated: {
            accuracy: spread,
            approvedFraudRate: [0, 0],
            autoApprovedFraudRate: [0, 0],
            autonomyAccuracy: [0.8, 0.8],
          },
          all: {
            accuracy: spread,
            approvedFraudRate: [0, 0],
            autoApprovedFraudRate: [0, 0],
            autonomyAccuracy: [0.8, 0.8],
          },
        },
      }),
});

const history = [
  entry("E001", "local", { accuracy: 0.59 }),
  entry(
    "E002",
    "hosted",
    { accuracy: 0.9, approvedFraudRate: 0 },
    [0.87, 0.93],
  ),
  entry("E003", "local", { accuracy: null }),
  entry(
    "E004",
    "hosted",
    { accuracy: 0.91, approvedFraudRate: 0 },
    [0.88, 0.94],
  ),
];

describe("charts", () => {
  it("draws two charts, each in a light and a dark file", () => {
    expect([...renderCharts(history).keys()]).toEqual([
      "accuracy-light.svg",
      "rates-light.svg",
      "accuracy-dark.svg",
      "rates-dark.svg",
    ]);
  });

  it("draws the same history the same way", () => {
    expect(renderCharts([...history])).toEqual(renderCharts(history));
  });

  it("keeps one series per recording set, in the order it first appears", () => {
    expect(seriesOf(history)).toEqual([
      { provider: "lmstudio", model: "local" },
      { provider: "anthropic", model: "hosted" },
    ]);
  });

  it("names each set in the legend and labels its latest accuracy", () => {
    const chart = renderCharts(history).get("accuracy-light.svg") ?? "";
    expect(chart).toContain(">lmstudio/local</text>");
    expect(chart).toContain(">anthropic/hosted</text>");
    expect(chart).toContain(">91.0 %</text>");
    expect(chart).toContain(">E004</text>");
  });

  it("shades the min–max of the repeated entries only", () => {
    const chart = renderCharts(history).get("accuracy-light.svg") ?? "";
    expect(chart.match(/fill-opacity="0.16"/g)).toHaveLength(1);
  });

  it("breaks a line where an entry measured nothing", () => {
    const chart = renderCharts(history).get("accuracy-light.svg") ?? "";
    const local = /<path d="([^"]*)" fill="none" stroke="#0969da"/.exec(chart);
    expect(local?.[1]?.match(/M/g)).toHaveLength(1);
    expect(local?.[1]).not.toContain("L");
  });

  it("changes only the colours between the themes", () => {
    const charts = renderCharts(history);
    const strip = (svg: string) => svg.replace(/#[0-9a-f]{6}/g, "#");
    expect(strip(charts.get("rates-dark.svg") ?? "")).toBe(
      strip(charts.get("rates-light.svg") ?? ""),
    );
    expect(charts.get("rates-dark.svg")).not.toBe(
      charts.get("rates-light.svg"),
    );
  });

  it("draws an empty history without failing", () => {
    expect(renderCharts([]).get("accuracy-light.svg")).toContain("</svg>");
  });
});

describe("README summary", () => {
  it("shows each set's latest gated metrics, with the range across runs", () => {
    expect(renderSummary(history)).toBe(
      [
        SUMMARY_START,
        "<!-- prettier-ignore-start -->",
        "| Model | Latest entry | Runs per case | Gated cases | Accuracy | Approved fraud | Auto-approved fraud | Escalated |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| `lmstudio/local` | E003 · 2026-11-02 | 1 | 30 | — | 10.0 % | 0.0 % | 60.0 % |",
        "| `anthropic/hosted` | E004 · 2026-11-02 | 3 | 30 | 91.0 % (88.0–94.0) | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) | 60.0 % |",
        "<!-- prettier-ignore-end -->",
        SUMMARY_END,
      ].join("\n"),
    );
  });

  it("replaces the block between the markers and nothing else", () => {
    const readme = `# Title\n\n${SUMMARY_START}\nold\n${SUMMARY_END}\n\nAfter.\n`;
    expect(withSummary(readme, "NEW")).toBe("# Title\n\nNEW\n\nAfter.\n");
  });

  it("says when the README has no block to replace", () => {
    expect(withSummary("# Title\n", "NEW")).toBeNull();
  });
});
