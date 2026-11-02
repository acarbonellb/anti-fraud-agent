/**
 * The offline evals (brief §4.3 and §5, issue #6).
 *
 *   pnpm eval [case…]          record with the configured model (AGENT_LLM_*;
 *                              LM Studio by default, free), then replay all
 *   pnpm eval:replay           replay every recording, rewrite the report
 *   pnpm eval:replay --check   CI: no model, no network; fails on stale or
 *                              missing recordings, on auto-approved fraud among
 *                              the gated cases, or on a report that changed
 *
 * A paid provider records only with the author's go-ahead (CLAUDE.md §8).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EVAL_CASES } from "../evals/cases/index.js";
import { loadConfig } from "../src/config/config.js";
import { gateFailures } from "../src/evals/gate.js";
import { renderReport } from "../src/evals/report.js";
import { recordCase, replaySet } from "../src/evals/runner.js";
import { loadRecordingSets, writeRecording } from "../src/evals/store.js";
import { createOpenAiCompatibleProvider } from "../src/providers/openai-compatible/adapter.js";

const RECORDINGS = fileURLToPath(
  new URL("../evals/recordings", import.meta.url),
);
const REPORT = fileURLToPath(new URL("../evals/report.md", import.meta.url));

const args = process.argv.slice(2);
const replayOnly = args.includes("--replay");
const check = args.includes("--check");
const only = args.filter((arg) => !arg.startsWith("--"));

if (!replayOnly) await record(only);

const sets = [];
for (const set of loadRecordingSets(RECORDINGS)) {
  sets.push(await replaySet(EVAL_CASES, set));
}
const report = renderReport(sets);

if (check) {
  const failures = gateFailures(sets);
  if (sets.length === 0) {
    failures.push("No recordings in evals/recordings/. Run `pnpm eval`.");
  }
  if (committedReport() !== report) {
    failures.push(
      "evals/report.md differs from the replayed one. Run `pnpm eval:replay` and commit it.",
    );
  }
  for (const failure of failures) console.error(`✗ ${failure}`);
  if (failures.length > 0) process.exit(1);
  console.log(`✓ ${String(sets.length)} recording set(s) replay cleanly.`);
} else {
  writeFileSync(REPORT, report);
  console.log(`Report written to evals/report.md.`);
}

async function record(ids: readonly string[]): Promise<void> {
  const unknown = ids.filter((id) => !EVAL_CASES.some((c) => c.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown case(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
  const config = loadConfig(process.env);
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
  for (const evalCase of cases) {
    const { recording, result } = await recordCase(evalCase, provider, clock);
    if (recording !== null) writeRecording(RECORDINGS, evalCase, recording);
    const { outcome } = result;
    console.log(
      outcome === null
        ? `  ${evalCase.id} ✗ ${result.failure ?? "failed"} (recording kept as it was)`
        : `  ${evalCase.id} ${outcome.decision} · ${outcome.autonomy} · ${(outcome.latencyMs / 1000).toFixed(1)} s`,
    );
  }
}

function committedReport(): string | null {
  try {
    return readFileSync(REPORT, "utf8");
  } catch {
    return null;
  }
}
