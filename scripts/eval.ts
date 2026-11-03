/**
 * The offline evals (brief §4.3 and §5, issue #6).
 *
 *   pnpm eval [case…] [--note "<what changed>"]
 *                              record with the configured model (AGENT_LLM_*;
 *                              LM Studio by default, free), the venue
 *                              providers (OSM, Wikidata: free) and Tavily
 *                              (TAVILY_API_KEY: free plan credits), then
 *                              replay all. Reads .env.
 *   pnpm eval:replay [--note "<what changed>"]
 *                              replay every recording, append to the history
 *                              and rewrite the report
 *   pnpm eval:replay --check   CI: no model, no network; fails on stale or
 *                              missing recordings, on auto-approved fraud among
 *                              the gated cases, on metrics the history doesn't
 *                              hold, on an entry with no experiment section, or
 *                              on a report that changed
 *
 * Both writing modes append one history entry per set whose metrics or prompt
 * versions moved, and then require `--note` (#21, ADR 0014).
 *
 * A paid provider records only with the author's go-ahead (CLAUDE.md §8).
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EVAL_CASES } from "../evals/cases/index.js";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { gateFailures } from "../src/evals/gate.js";
import {
  experimentIds,
  historyFailures,
  measureSet,
  parseHistory,
  planHistory,
  serializeHistory,
} from "../src/evals/history.js";
import { renderReport } from "../src/evals/report.js";
import { recordCase, replaySet } from "../src/evals/runner.js";
import {
  loadRecordingSets,
  loadToolRecordings,
  writeRecording,
  writeToolRecording,
} from "../src/evals/store.js";
import { createOpenAiCompatibleProvider } from "../src/providers/openai-compatible/adapter.js";
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
const EXPERIMENTS = fileURLToPath(
  new URL("../docs/experiments.md", import.meta.url),
);

const args = process.argv.slice(2);
const replayOnly = args.includes("--replay");
const check = args.includes("--check");
const noteAt = args.indexOf("--note");
const note = noteAt === -1 ? undefined : args[noteAt + 1];
if (noteAt !== -1 && (note === undefined || note.startsWith("--"))) {
  console.error('--note takes a value: --note "<what changed>".');
  process.exit(2);
}
const only = args.filter(
  (arg, index) =>
    !arg.startsWith("--") && (noteAt === -1 || index !== noteAt + 1),
);
const history = parseHistory(readOrEmpty(HISTORY));

if (!replayOnly) await record(only);

const sets = [];
const toolRecordings = loadToolRecordings(TOOL_RESPONSES);
for (const set of loadRecordingSets(RECORDINGS)) {
  sets.push(await replaySet(EVAL_CASES, set, toolRecordings));
}
const current = sets.map(measureSet);

if (check) {
  const report = renderReport(sets, history);
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
  if (failures.length > 0) process.exit(1);
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
  writeFileSync(REPORT, renderReport(sets, [...history, ...plan.append]));
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
  const provider = createOpenAiCompatibleProvider({
    provider: config.llm.provider,
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    ...(config.llm.apiKey === undefined ? {} : { apiKey: config.llm.apiKey }),
  });
  // One clock for the whole run, to the minute; each recording keeps it.
  const clock = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const cases = EVAL_CASES.filter(
    (c) => ids.length === 0 || ids.includes(c.id),
  );
  console.log(
    `Recording ${String(cases.length)} case(s) with ${provider.provider}/${provider.model}…`,
  );
  // The venue providers are free and keyless (OSM, Wikidata); one set of
  // throttles keeps Nominatim at 1 request per second across cases.
  const throttles = createVenueThrottles();
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
      },
    );
    if (recording !== null) writeRecording(RECORDINGS, evalCase, recording);
    if (toolRecording !== null) {
      writeToolRecording(TOOL_RESPONSES, evalCase, toolRecording);
    }
    const { outcome } = result;
    console.log(
      outcome === null
        ? `  ${evalCase.id} ✗ ${result.failure ?? "failed"} (recording kept as it was)`
        : `  ${evalCase.id} ${outcome.decision} · ${outcome.autonomy} · ${(outcome.latencyMs / 1000).toFixed(1)} s`,
    );
  }
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
