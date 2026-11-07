/**
 * One scheduled pass over Satella's feed (#45, ADR 0017): the entry point the
 * Cloud Run Job runs every 10 minutes (#46). Configured from the environment
 * and wired by the composition root (#92): the store is Firestore with
 * FIRESTORE_PROJECT_ID set, in memory otherwise.
 *
 * With `--mock` it runs against the in-process mock and its fictitious feed.
 * Without it, it reviews Satella staging (#9) with the job's Google identity
 * token, so only from Cloud Run; with no Satella configured it exits before
 * reading anything. A paid provider (`anthropic`) runs only with `--paid`.
 *
 *   pnpm pass --mock            # the fixture feed, the local model
 *   pnpm pass --mock --paid     # with AGENT_LLM_PROVIDER=anthropic
 *   pnpm pass --paid            # Satella staging: what the job runs
 *
 * Writes one JSON line per log entry (ids and codes only) and exits 0 when
 * the pass ran, budget stop included; 1 when it failed; 2 when a paid
 * provider was refused for want of `--paid`.
 */
import { randomUUID } from "node:crypto";

import { type Config, ConfigError, loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { codeOf } from "../src/errors.js";
import {
  type LogEntry,
  logLine,
  type LogWriter,
} from "../src/pass/log-line.js";
import { runPass } from "../src/pass/pass.js";
import {
  buildReviewDependencies,
  PaidNotAllowedError,
  type ReviewDependencies,
} from "../src/wiring/review-dependencies.js";

loadLocalEnvFile();
const correlationId = randomUUID();
/** The sink: every line reaching it was checked where it was written. */
const write = (entry: LogEntry) => {
  console.log(logLine({ correlationId, ...entry }));
};
/** The script's own lines, checked like the pass's: only `subject` may hold one (#91). */
const line: LogWriter<{ level: LogEntry["level"]; event: string }> = (
  entry,
) => {
  write(entry);
};

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  // The variables' names and rules only: never their values.
  line({
    level: "error",
    event: "pass.refused",
    code: codeOf(error),
    ...(error instanceof ConfigError
      ? { variables: error.issues.map((issue) => issue.variable).join(",") }
      : {}),
  });
  process.exit(1);
}

let dependencies: ReviewDependencies;
try {
  dependencies = await buildReviewDependencies(config, {
    paid: process.argv.includes("--paid"),
    mock: process.argv.includes("--mock"),
    correlationId,
  });
} catch (error) {
  line({
    level: "error",
    event: "pass.refused",
    code: codeOf(error),
  });
  // 2, as every script that refuses to spend: the command was wrong, not the pass.
  process.exit(error instanceof PaidNotAllowedError ? 2 : 1);
}
const { provider, store, evidence, satella } = dependencies;

try {
  const report = await runPass({
    satella: satella.client,
    correlationId,
    provider,
    store,
    limits: config.runLimits,
    autoApproveThreshold: config.autoApproveThreshold,
    dailyBudgetMicros: config.dailyBudgetMicros,
    // Null for the providers that take none (the config picked it).
    effort: config.llm.effort,
    ...evidence,
    // Already checked by the pass's own writer.
    log: write,
  });
  line({
    level: "info",
    event: "pass.report",
    stoppedBy: report.stoppedBy,
    // Counts and ids only: each run's own lines already carry its subject.
    runs: report.runs.length,
    failedRuns: report.runs.filter((run) => run.outcome === "failed").length,
    cursor: report.cursor,
    resolutions: report.resolutions,
    skippedItems: report.skippedItems,
    retriesQueued: report.retriesQueued,
    searches: report.searches.total,
    searchesFailed: report.searches.failed,
  });
} catch (error) {
  // The code only: a message could carry more than ids.
  line({
    level: "error",
    event: "pass.failed",
    code: codeOf(error),
  });
  process.exitCode = 1;
} finally {
  await satella.close();
}
