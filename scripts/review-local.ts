/**
 * Runs one real review on this machine: the configured model (LM Studio by
 * default, at no cost) against the in-process Satella mock and its fictitious
 * fixtures, wired by the composition root (#92). A paid provider
 * (`anthropic`) runs only with `--paid`. Only the venue checks and web
 * search leave the machine: OpenStreetMap and Wikidata (free, keyless) and,
 * with TAVILY_API_KEY in .env, Tavily (free plan credits).
 *
 *   pnpm review:local            # the fixture event
 *   pnpm review:local organizer  # the fixture organizer
 *   pnpm review:local --paid     # with AGENT_LLM_PROVIDER=anthropic
 */
import { randomUUID } from "node:crypto";

import { reviewSubject } from "../src/agent/review.js";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { fixtures } from "../src/satella-client/fixtures.js";
import { startLocalSatella } from "../src/satella-client/local-satella.js";
import {
  buildReviewer,
  PaidNotAllowedError,
  type Reviewer,
} from "../src/wiring/review-dependencies.js";

loadLocalEnvFile();
const config = loadConfig(process.env);
const subject = process.argv.includes("organizer")
  ? { type: "organizer" as const, id: fixtures.organizerContext.organizer.id }
  : { type: "event" as const, id: fixtures.eventContext.event.id };

const runId = randomUUID();
let reviewer: Reviewer;
try {
  // The reviewer alone: one review stores no run, so no store is built.
  reviewer = buildReviewer(config, { paid: process.argv.includes("--paid") });
} catch (error) {
  if (!(error instanceof PaidNotAllowedError)) throw error;
  console.error(`✗ ${error.message}`);
  process.exit(2);
}
const { provider, evidence } = reviewer;
// Always the mock: this script reviews the fixtures, never staging.
const satella = await startLocalSatella(runId);
const started = performance.now();
try {
  const result = await reviewSubject({
    subject,
    runId,
    satella: satella.client,
    provider,
    limits: config.runLimits,
    autoApproveThreshold: config.autoApproveThreshold,
    ...evidence,
  });

  const { run, review } = result;
  console.log(
    JSON.stringify(
      {
        runId,
        subject,
        model: `${run.provider}/${run.model}`,
        promptVersion: run.promptVersion,
        endedBy: run.endedBy,
        decision: review.decision,
        confidence: review.confidence,
        autonomy: run.autonomy,
        satellaStatus: review.status,
        rationale: review.rationale,
        findings: review.findings.map(
          (finding) => `${finding.verdict} ${finding.check}: ${finding.detail}`,
        ),
        infoRequest: review.infoRequest,
        toolTrace: run.trace,
        usage: run.usage,
        seconds: Math.round((performance.now() - started) / 100) / 10,
      },
      null,
      2,
    ),
  );
} finally {
  await satella.close();
}
