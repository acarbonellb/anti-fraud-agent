/**
 * Runs one real review on this machine: the configured model (LM Studio by
 * default, at no cost) against the in-process Satella mock and its fictitious
 * fixtures. A paid provider (`anthropic`) runs only with `--paid`. Only the venue checks and web
 * search leave the machine: OpenStreetMap and Wikidata (free, keyless) and,
 * with TAVILY_API_KEY in .env, Tavily (free plan credits).
 *
 *   pnpm review:local            # the fixture event
 *   pnpm review:local organizer  # the fixture organizer
 *   pnpm review:local --paid     # with AGENT_LLM_PROVIDER=anthropic
 */
import { randomUUID } from "node:crypto";

import { reviewSubject } from "../src/agent/review.js";
import { reviewEvidence } from "../src/agent/review-evidence.js";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { createConfiguredProvider } from "../src/providers/from-config.js";
import { isPaidProvider } from "../src/providers/pricing.js";
import { fixtures } from "../src/satella-client/fixtures.js";
import { createConfiguredSearch } from "../src/search/from-config.js";
import { createVenueThrottles } from "../src/venue/venue-checks.js";
import { startLocalSatella } from "./local-satella.js";

loadLocalEnvFile();
const config = loadConfig(process.env);
if (isPaidProvider(config.llm.provider) && !process.argv.includes("--paid")) {
  console.error(
    `✗ ${config.llm.provider} bills per token: pass --paid to spend (CLAUDE.md §8).`,
  );
  process.exit(2);
}
const subject = process.argv.includes("organizer")
  ? { type: "organizer" as const, id: fixtures.organizerContext.organizer.id }
  : { type: "event" as const, id: fixtures.eventContext.event.id };

const runId = randomUUID();
const satella = await startLocalSatella(runId);
const started = performance.now();
try {
  const result = await reviewSubject({
    subject,
    runId,
    satella: satella.client,
    provider: createConfiguredProvider(config.llm),
    limits: config.runLimits,
    autoApproveThreshold: config.autoApproveThreshold,
    ...reviewEvidence({
      fetch: globalThis.fetch,
      throttles: createVenueThrottles(),
      search: createConfiguredSearch(config.webSearch),
    }),
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
