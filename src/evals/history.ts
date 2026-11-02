/**
 * The metrics history (#21, ADR 0014): `evals/history.jsonl`, one entry per
 * line, appended by `pnpm eval` and `pnpm eval:replay` and never edited. The
 * numbers are machine-written so nobody types a metric by hand; the narrative
 * lives in `docs/experiments.md`, one `## E00N` section per entry.
 */
import { z } from "zod";

import { DomainError } from "../errors.js";
import { computeMetrics, type Metrics } from "./metrics.js";
import type { ReportSet } from "./report.js";

const rate = z.number().nullable();

const metricsSchema = z.strictObject({
  cases: z.number().int().nonnegative(),
  scored: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  accuracy: rate,
  approvedFraudRate: rate,
  autoApprovedFraudRate: rate,
  escalationRate: rate,
  autonomyAccuracy: rate,
  brier: rate,
  meanInputTokens: rate,
  meanOutputTokens: rate,
  meanLatencyMs: rate,
}) satisfies z.ZodType<Metrics>;

export const historyEntrySchema = z.strictObject({
  id: z.string().regex(/^E\d{3,}$/),
  /** UTC, when the entry was appended. */
  date: z.iso.date(),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersions: z.array(z.string()),
  /** One line: what changed since the set's previous entry. */
  note: z.string().min(1),
  gated: metricsSchema,
  all: metricsSchema,
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** A recording set as the latest replay measured it. */
export interface CurrentSet {
  provider: string;
  model: string;
  promptVersions: string[];
  gated: Metrics;
  all: Metrics;
}

export function measureSet(set: ReportSet): CurrentSet {
  return {
    provider: set.provider,
    model: set.model,
    promptVersions: set.promptVersions,
    gated: computeMetrics(set.results, { includeExternal: false }),
    all: computeMetrics(set.results, { includeExternal: true }),
  };
}

export type HistoryPlan =
  | { append: HistoryEntry[] }
  /** Something would be appended, but nobody said what changed. */
  | { noteMissing: string[] };

/**
 * The entries a run appends: one per set whose metrics or prompt versions
 * differ from that set's latest entry, or that has none. A code-only change
 * counts too: a policy threshold moves the metrics without re-recording.
 */
export function planHistory(input: {
  history: readonly HistoryEntry[];
  current: readonly CurrentSet[];
  note?: string;
  /** `YYYY-MM-DD`, UTC. */
  date: string;
}): HistoryPlan {
  const changed = sortSets(input.current).filter((set) =>
    isStale(set, latestEntry(input.history, set)),
  );
  if (changed.length === 0) return { append: [] };
  // One line: it is a table cell in the report.
  const note = input.note?.replace(/\s+/g, " ").trim() ?? "";
  if (note === "") return { noteMissing: changed.map(setName) };
  return {
    append: changed.map((set, index) => ({
      id: entryId(input.history.length + index + 1),
      date: input.date,
      provider: set.provider,
      model: set.model,
      promptVersions: [...set.promptVersions],
      note,
      gated: roundMetrics(set.gated),
      all: roundMetrics(set.all),
    })),
  };
}

export function setName(set: Pick<CurrentSet, "provider" | "model">): string {
  return `${set.provider}/${set.model}`;
}

export function latestEntry(
  history: readonly HistoryEntry[],
  set: Pick<CurrentSet, "provider" | "model">,
): HistoryEntry | undefined {
  return history.findLast(
    (entry) => entry.provider === set.provider && entry.model === set.model,
  );
}

const HOW_TO_APPEND =
  'Run `pnpm eval:replay --note "<what changed>"` and write its section in docs/experiments.md.';

/**
 * What makes `pnpm eval:replay --check` fail over the history: a set with no
 * entry or whose metrics moved since its latest one, and an entry without its
 * experiment section. A metric change can't reach `main` unexplained.
 */
export function historyFailures(input: {
  history: readonly HistoryEntry[];
  current: readonly CurrentSet[];
  experimentIds: readonly string[];
}): string[] {
  const failures: string[] = [];
  for (const set of sortSets(input.current)) {
    const latest = latestEntry(input.history, set);
    if (latest === undefined) {
      failures.push(
        `${setName(set)} has no entry in evals/history.jsonl. ${HOW_TO_APPEND}`,
      );
    } else if (isStale(set, latest)) {
      failures.push(
        `${setName(set)} differs from its latest entry, ${latest.id}. ${HOW_TO_APPEND}`,
      );
    }
  }
  const documented = new Set(input.experimentIds);
  for (const entry of input.history) {
    if (!documented.has(entry.id)) {
      failures.push(`docs/experiments.md has no \`## ${entry.id}\` section.`);
    }
  }
  return failures;
}

/** The ids of the experiment log's `## E00N — title` sections. */
export function experimentIds(markdown: string): string[] {
  return [...markdown.matchAll(/^## (E\d{3,})\b/gm)].map(
    (match) => match[1] ?? "",
  );
}

/** A history file that doesn't parse: fixed by hand, never by appending. */
export class InvalidHistoryError extends DomainError {
  readonly code = "EVAL_HISTORY_INVALID";
}

/**
 * Validates every line, and that ids run `E001`, `E002`… with no gap: the
 * next id is the count plus one, and a gap means an entry was deleted.
 */
export function parseHistory(text: string): HistoryEntry[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, index) => {
    let entry: HistoryEntry;
    try {
      entry = historyEntrySchema.parse(JSON.parse(line));
    } catch (error) {
      throw new InvalidHistoryError(
        `evals/history.jsonl line ${String(index + 1)} is not a valid entry`,
        { cause: error },
      );
    }
    const expected = entryId(index + 1);
    if (entry.id !== expected) {
      throw new InvalidHistoryError(
        `evals/history.jsonl line ${String(index + 1)} is ${entry.id}, expected ${expected}`,
      );
    }
    return entry;
  });
}

export function serializeHistory(entries: readonly HistoryEntry[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

/** Compared after rounding: the entry keeps 4 decimals. */
function isStale(set: CurrentSet, entry: HistoryEntry | undefined): boolean {
  if (entry === undefined) return true;
  return (
    JSON.stringify(set.promptVersions) !==
      JSON.stringify(entry.promptVersions) ||
    JSON.stringify(roundMetrics(set.gated)) !== JSON.stringify(entry.gated) ||
    JSON.stringify(roundMetrics(set.all)) !== JSON.stringify(entry.all)
  );
}

/** Same order as the report, so ids are assigned the same way every run. */
function sortSets(sets: readonly CurrentSet[]): CurrentSet[] {
  return [...sets].sort((a, b) => {
    const [x, y] = [setName(a), setName(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function entryId(n: number): string {
  return `E${String(n).padStart(3, "0")}`;
}

export function roundMetrics(metrics: Metrics): Metrics {
  const round = (value: number | null) =>
    value === null ? null : Math.round(value * 10_000) / 10_000;
  return {
    cases: metrics.cases,
    scored: metrics.scored,
    failed: metrics.failed,
    accuracy: round(metrics.accuracy),
    approvedFraudRate: round(metrics.approvedFraudRate),
    autoApprovedFraudRate: round(metrics.autoApprovedFraudRate),
    escalationRate: round(metrics.escalationRate),
    autonomyAccuracy: round(metrics.autonomyAccuracy),
    brier: round(metrics.brier),
    meanInputTokens: round(metrics.meanInputTokens),
    meanOutputTokens: round(metrics.meanOutputTokens),
    meanLatencyMs: round(metrics.meanLatencyMs),
  };
}
