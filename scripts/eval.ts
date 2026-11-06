/**
 * The offline evals (brief §4.3 and §5, issue #6).
 *
 *   pnpm eval [case…] [--runs N | --runs A-B] [--note "<what changed>"] [--paid]
 *                              record with the configured model (AGENT_LLM_*;
 *                              LM Studio by default, free; a paid provider
 *                              only with --paid), the venue
 *                              providers (OSM, Wikidata: free) and Tavily
 *                              (TAVILY_API_KEY: free plan credits), then
 *                              replay all. Reads .env. Records runs 1…N of
 *                              each case, or A…B (#42); N defaults to the
 *                              runs the set already has, 3 for a new set.
 *   pnpm eval:replay [--note "<what changed>"]
 *                              replay every recording, append to the history
 *                              and rewrite the report
 *   pnpm eval:replay --check   CI: no model, no network; fails on stale or
 *                              missing recordings, on auto-approved fraud among
 *                              the gated cases, on a code-decided case the
 *                              fooled model got approved (#82), on metrics the
 *                              history doesn't hold, on an entry with no
 *                              experiment section, or on a report that changed
 *
 * Both writing modes append one history entry per set whose metrics or prompt
 * versions moved, and then require `--note` (#21, ADR 0014).
 *
 * A paid provider records only with the author's go-ahead (CLAUDE.md §8):
 * `--paid` makes that go-ahead explicit, so a `.env` left on `anthropic`
 * never spends by accident.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EVAL_CASES } from "../evals/cases/index.js";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { fooledGateFailures, gateFailures } from "../src/evals/gate.js";
import {
  experimentIds,
  historyFailures,
  measureSet,
  parseHistory,
  planHistory,
  sameSet,
  serializeHistory,
} from "../src/evals/history.js";
import { renderReport } from "../src/evals/report.js";
import { addNewToolCalls } from "../src/evals/tool-recording.js";
import { fooledSet, recordCase, replaySet } from "../src/evals/runner.js";
import {
  loadRecordingSets,
  loadToolRecordings,
  writeRecording,
  writeToolRecording,
} from "../src/evals/store.js";
import { createConfiguredProvider } from "../src/providers/from-config.js";
import { isPaidProvider } from "../src/providers/pricing.js";
import { createTavilySearch } from "../src/search/tavily.js";
import { createVenueThrottles } from "../src/venue/venue-checks.js";

const RECORDINGS = fileURLToPath(
  new URL("../evals/recordings", import.meta.url),
);
const TOOL_RESPONSES = fileURLToPath(
  new URL("../evals/tool-responses", import.meta.url),
);
const REPORT = fileURLToPath(new URL("../evals/report.md", import.meta.url));
const HISTORY = fileURLToPath(
  new URL("../evals/history.jsonl", import.meta.url),
);
const DEFAULT_RUNS = 3;
const EXPERIMENTS = fileURLToPath(
  new URL("../docs/experiments.md", import.meta.url),
);

const args = process.argv.slice(2);
const replayOnly = args.includes("--replay");
const check = args.includes("--check");
const paid = args.includes("--paid");
const noteAt = args.indexOf("--note");
const note = noteAt === -1 ? undefined : args[noteAt + 1];
if (noteAt !== -1 && (note === undefined || note.startsWith("--"))) {
  console.error('--note takes a value: --note "<what changed>".');
  process.exit(2);
}
const runsAt = args.indexOf("--runs");
const runsArg = runsAt === -1 ? undefined : args[runsAt + 1];
const runsMatch =
  runsArg === undefined ? null : /^(\d+)(?:-(\d+))?$/.exec(runsArg);
if (runsAt !== -1 && runsMatch === null) {
  console.error("--runs takes N (runs 1…N) or A-B (runs A…B): --runs 3.");
  process.exit(2);
}
const valueAt = new Set([noteAt + 1, runsAt + 1].filter((at) => at > 0));
const only = args.filter(
  (arg, index) => !arg.startsWith("--") && !valueAt.has(index),
);
const history = parseHistory(readOrEmpty(HISTORY));

if (!replayOnly) await record(only);

const sets = [];
const toolRecordings = loadToolRecordings(TOOL_RESPONSES);
const recordingSets = loadRecordingSets(RECORDINGS);
for (const set of recordingSets) {
  sets.push(await replaySet(EVAL_CASES, set, toolRecordings));
}
const current = sets.map(measureSet);
// No model recording takes part: it reads only the venue responses and the
// code's own searches, so it holds even while the model's recordings are stale.
const fooled = await fooledSet(EVAL_CASES, recordingSets, toolRecordings);

if (check) {
  const report = renderReport(sets, history, fooled);
  const fooledFailures = fooledGateFailures(fooled);
  // Its own block, first: readable whatever else fails below it.
  console.log("Fooled-model gate:");
  for (const failure of fooledFailures) console.error(`  ✗ ${failure}`);
  const byModel = fooled.filter((result) => result.decidedBy === "model");
  if (fooledFailures.length === 0) {
    console.log(
      `  ✓ ${String(fooled.length - byModel.length)} code-decided case(s) held back.`,
    );
  }
  for (const result of byModel) {
    const runs = result.runs
      .map(
        (run) =>
          `${run.web}: ${run.outcome === null ? (run.failure ?? "—") : `${run.outcome.decision} · ${run.outcome.autonomy}`}`,
      )
      .join(", ");
    console.log(`  · model-decided case ${result.caseId}: ${runs}`);
  }
  const failures = [
    ...gateFailures(sets),
    ...historyFailures({
      history,
      current,
      experimentIds: experimentIds(readOrEmpty(EXPERIMENTS)),
    }),
  ];
  if (sets.length === 0) {
    failures.push("No recordings in evals/recordings/. Run `pnpm eval`.");
  }
  if (readOrEmpty(REPORT) !== report) {
    failures.push(
      "evals/report.md differs from the replayed one. Run `pnpm eval:replay` and commit it.",
    );
  }
  for (const failure of failures) console.error(`✗ ${failure}`);
  if (failures.length + fooledFailures.length > 0) process.exit(1);
  console.log(`✓ ${String(sets.length)} recording set(s) replay cleanly.`);
} else {
  const plan = planHistory({
    history,
    current,
    ...(note === undefined ? {} : { note }),
    date: new Date().toISOString().slice(0, 10),
  });
  if ("noteMissing" in plan) {
    console.error(
      `✗ The metrics of ${plan.noteMissing.join(", ")} moved: say what changed. ` +
        `Run \`pnpm eval:replay --note "<what changed>"\`` +
        (replayOnly ? "." : " (the new recordings are kept)."),
    );
    process.exit(1);
  }
  appendFileSync(HISTORY, serializeHistory(plan.append));
  writeFileSync(
    REPORT,
    renderReport(sets, [...history, ...plan.append], fooled),
  );
  for (const entry of plan.append) {
    console.log(
      `History: ${entry.id} appended for ${entry.provider}/${entry.model}. Write its \`## ${entry.id}\` section in docs/experiments.md.`,
    );
  }
  console.log(`Report written to evals/report.md.`);
}

async function record(ids: readonly string[]): Promise<void> {
  const unknown = ids.filter((id) => !EVAL_CASES.some((c) => c.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown case(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
  loadLocalEnvFile();
  const config = loadConfig(process.env);
  const { tavilyApiKey } = config.webSearch;
  if (tavilyApiKey === undefined) {
    console.error(
      "✗ Recording needs TAVILY_API_KEY (in .env): the cases search the web.",
    );
    process.exit(2);
  }
  if (isPaidProvider(config.llm.provider) && !paid) {
    console.error(
      `✗ ${config.llm.provider} bills per token: pass --paid to record (CLAUDE.md §8).`,
    );
    process.exit(2);
  }
  const provider = createConfiguredProvider(config.llm);
  const runs = runsToRecord(provider);
  if (runs.length === 0) {
    console.error(
      "✗ --runs records nothing: A must be 1 or more, and at most B.",
    );
    process.exit(2);
  }
  // One clock for the whole run, to the minute; each recording keeps it.
  const clock = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const cases = EVAL_CASES.filter(
    (c) => ids.length === 0 || ids.includes(c.id),
  );
  console.log(
    `Recording ${String(cases.length)} case(s) × run(s) ${runs.join(", ")} with ${provider.provider}/${provider.model}` +
      // Only anthropic takes an effort.
      (provider.provider === "anthropic"
        ? ` (effort ${config.llm.effort})…`
        : "…"),
  );
  // The venue providers are free and keyless (OSM, Wikidata); one set of
  // throttles keeps Nominatim at 1 request per second across cases.
  const throttles = createVenueThrottles();
  for (const run of runs)
    for (const evalCase of cases) {
      const { recording, toolRecording, result } = await recordCase(
        evalCase,
        provider,
        clock,
        {
          fetch: globalThis.fetch,
          search: createTavilySearch({
            apiKey: tavilyApiKey,
            fetch: globalThis.fetch,
          }),
          throttles,
          run,
        },
      );
      if (recording !== null) writeRecording(RECORDINGS, evalCase, recording);
      if (toolRecording !== null) {
        // Run 1 re-measures the venue; a repeat must not change what the
        // runs before it replay against.
        const kept =
          run === 1
            ? toolRecording
            : addNewToolCalls(
                loadToolRecordings(TOOL_RESPONSES).get(evalCase.id) ?? null,
                toolRecording,
              );
        writeToolRecording(TOOL_RESPONSES, evalCase, kept);
      }
      const { outcome } = result;
      console.log(
        outcome === null
          ? `  ${evalCase.id} run ${String(run)} ✗ ${result.failure ?? "failed"} (recording kept as it was)`
          : `  ${evalCase.id} run ${String(run)} ${outcome.decision} · ${outcome.autonomy} · ${(outcome.latencyMs / 1000).toFixed(1)} s`,
      );
    }
}

/**
 * Runs 1…N, or A…B. Without `--runs`, as many as the set already has, so
 * re-recording one case keeps the set whole; a new set gets 3 (#42).
 */
function runsToRecord(provider: { provider: string; model: string }): number[] {
  const [first, last] =
    runsMatch === null
      ? [
          1,
          loadRecordingSets(RECORDINGS).find((set) => sameSet(set, provider))
            ?.runs.length ?? DEFAULT_RUNS,
        ]
      : runsMatch[2] === undefined
        ? [1, Number(runsMatch[1])]
        : [Number(runsMatch[1]), Number(runsMatch[2])];
  return first < 1
    ? []
    : Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
