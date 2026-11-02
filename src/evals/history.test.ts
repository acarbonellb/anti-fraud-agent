// Checks the metrics history (#21): which entries a run appends, and when
// `--check` fails over the history and the experiment log. Pure functions over
// hand-made metrics; fakes nothing.
import { describe, expect, it } from "vitest";

import {
  type CurrentSet,
  experimentIds,
  historyFailures,
  type HistoryEntry,
  parseHistory,
  planHistory,
  serializeHistory,
} from "./history.js";
import type { Metrics } from "./metrics.js";

const metrics: Metrics = {
  cases: 22,
  scored: 22,
  failed: 0,
  accuracy: 0.5909,
  approvedFraudRate: 0.3889,
  autoApprovedFraudRate: 0,
  escalationRate: 0.5909,
  autonomyAccuracy: 0.8182,
  brier: 0.3021,
  meanInputTokens: 10670.4545,
  meanOutputTokens: 1413.2273,
  meanLatencyMs: 38912.3333,
};

const qwen: CurrentSet = {
  provider: "lmstudio",
  model: "qwen/qwen3.5-9b",
  promptVersions: ["review-v2"],
  gated: metrics,
  all: metrics,
};

const baseline: HistoryEntry = {
  id: "E001",
  date: "2026-11-02",
  provider: "lmstudio",
  model: "qwen/qwen3.5-9b",
  promptVersions: ["review-v2"],
  note: "Baseline.",
  gated: metrics,
  all: metrics,
};

const DATE = "2026-11-03";

describe("planHistory", () => {
  it("appends nothing for an unchanged set, with or without a note", () => {
    expect(
      planHistory({ history: [baseline], current: [qwen], date: DATE }),
    ).toEqual({ append: [] });
    expect(
      planHistory({
        history: [baseline],
        current: [qwen],
        note: "Nothing.",
        date: DATE,
      }),
    ).toEqual({ append: [] });
  });

  it("appends an entry, rounded to 4 decimals, when the metrics moved", () => {
    const moved = {
      ...qwen,
      gated: { ...metrics, accuracy: 0.636_363_6, brier: 0.250_04 },
    };
    expect(
      planHistory({
        history: [baseline],
        current: [moved],
        note: "Threshold 0.9.",
        date: DATE,
      }),
    ).toEqual({
      append: [
        {
          ...baseline,
          id: "E002",
          date: DATE,
          note: "Threshold 0.9.",
          gated: { ...metrics, accuracy: 0.6364, brier: 0.25 },
        },
      ],
    });
  });

  it("ignores a move smaller than the 4 decimals the entry keeps", () => {
    const noise = { ...qwen, all: { ...metrics, brier: 0.302_100_01 } };
    expect(
      planHistory({ history: [baseline], current: [noise], date: DATE }),
    ).toEqual({ append: [] });
  });

  it("appends an entry when only the prompt version changed", () => {
    const plan = planHistory({
      history: [baseline],
      current: [{ ...qwen, promptVersions: ["review-v3"] }],
      note: "Prompt v3.",
      date: DATE,
    });
    expect(plan).toMatchObject({
      append: [{ id: "E002", promptVersions: ["review-v3"] }],
    });
  });

  it("compares each set with its own latest entry, and numbers new sets in name order", () => {
    const later = { ...baseline, id: "E002", note: "Second." };
    const claude = { ...qwen, provider: "anthropic", model: "claude" };
    const grok = { ...qwen, provider: "xai", model: "grok" };
    const plan = planHistory({
      history: [baseline, later],
      current: [grok, qwen, claude],
      note: "Two new models.",
      date: DATE,
    });
    expect(plan).toMatchObject({
      append: [
        { id: "E003", provider: "anthropic" },
        { id: "E004", provider: "xai" },
      ],
    });
  });

  it("asks for a note naming the sets it would append, before appending anything", () => {
    const moved = { ...qwen, gated: { ...metrics, accuracy: 0.7 } };
    for (const note of [undefined, "", "   "]) {
      expect(
        planHistory({
          history: [baseline],
          current: [moved],
          ...(note === undefined ? {} : { note }),
          date: DATE,
        }),
      ).toEqual({ noteMissing: ["lmstudio/qwen/qwen3.5-9b"] });
    }
  });
});

describe("historyFailures", () => {
  it("passes when every set matches its latest entry and every entry has its section", () => {
    expect(
      historyFailures({
        history: [baseline],
        current: [qwen],
        experimentIds: ["E001"],
      }),
    ).toEqual([]);
  });

  it("fails on a set with no entry", () => {
    expect(
      historyFailures({ history: [], current: [qwen], experimentIds: [] }),
    ).toEqual([
      'lmstudio/qwen/qwen3.5-9b has no entry in evals/history.jsonl. Run `pnpm eval:replay --note "<what changed>"` and write its section in docs/experiments.md.',
    ]);
  });

  it("fails on a set whose metrics moved since its latest entry", () => {
    const older = { ...baseline, gated: { ...metrics, accuracy: 0.5 } };
    expect(
      historyFailures({
        history: [older],
        current: [qwen],
        experimentIds: ["E001"],
      }),
    ).toEqual([
      'lmstudio/qwen/qwen3.5-9b differs from its latest entry, E001. Run `pnpm eval:replay --note "<what changed>"` and write its section in docs/experiments.md.',
    ]);
  });

  it("fails on an entry without its section in the experiment log", () => {
    const later = { ...baseline, id: "E002" };
    expect(
      historyFailures({
        history: [baseline, later],
        current: [qwen],
        experimentIds: ["E001"],
      }),
    ).toEqual(["docs/experiments.md has no `## E002` section."]);
  });
});

describe("the history file", () => {
  it("round-trips entries, one JSON object per line", () => {
    const later = { ...baseline, id: "E002", note: "Second." };
    const text = serializeHistory([baseline, later]);
    expect(text.split("\n")).toHaveLength(3);
    expect(text.endsWith("\n")).toBe(true);
    expect(parseHistory(text)).toEqual([baseline, later]);
    expect(parseHistory("")).toEqual([]);
  });

  it("rejects an entry that doesn't parse or ids out of sequence", () => {
    expect(() => parseHistory('{"id":"E001"}\n')).toThrow(/line 1/);
    const skipped = { ...baseline, id: "E003" };
    expect(() => parseHistory(serializeHistory([baseline, skipped]))).toThrow(
      /E003.*expected E002/,
    );
  });

  it("reads the experiment ids from the log's `## E00N` headings", () => {
    const log = [
      "# Experiments",
      "## E001 — Baseline",
      "text mentioning E009",
      "## E002 — Prompt v3",
      "### E003 is not a section",
    ].join("\n");
    expect(experimentIds(log)).toEqual(["E001", "E002"]);
  });
});
