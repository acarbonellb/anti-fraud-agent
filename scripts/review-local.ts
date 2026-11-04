/**
 * Runs one real review on this machine, at no cost: the configured
 * OpenAI-compatible model (LM Studio by default) against the in-process
 * Satella mock and its fictitious fixtures. Only the venue checks and web
 * search leave the machine: OpenStreetMap and Wikidata (free, keyless) and,
 * with TAVILY_API_KEY in .env, Tavily (free plan credits).
 *
 *   pnpm review:local            # the fixture event
 *   pnpm review:local organizer  # the fixture organizer
 */
import { randomUUID } from "node:crypto";

import { reviewSubject } from "../src/agent/review.js";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { createTavilySearch } from "../src/search/tavily.js";
import { webSearchTool } from "../src/search/web-search-tool.js";
import { createOpenAiCompatibleProvider } from "../src/providers/openai-compatible/adapter.js";
import { createSatellaClient } from "../src/satella-client/client.js";
import { fixtures } from "../src/satella-client/fixtures.js";
import { startMockSatella } from "../src/satella-client/mock-server.js";
import {
  createVenueChecks,
  createVenueThrottles,
} from "../src/venue/venue-checks.js";

loadLocalEnvFile();
const config = loadConfig(process.env);
const { tavilyApiKey } = config.webSearch;
// Without a key the review runs without web search, as production would.
const search =
  tavilyApiKey === undefined
    ? undefined
    : createTavilySearch({ apiKey: tavilyApiKey, fetch: globalThis.fetch });
const subject =
  process.argv[2] === "organizer"
    ? { type: "organizer" as const, id: fixtures.organizerContext.organizer.id }
    : { type: "event" as const, id: fixtures.eventContext.event.id };

const mock = await startMockSatella({
  fixtures: {
    feed: fixtures.feed,
    events: [fixtures.eventContext],
    organizers: [fixtures.organizerContext],
    similar: { [fixtures.eventContext.event.id]: fixtures.similarEvents },
  },
  tokens: { local: ["agent:read", "agent:recommend"] },
});

const runId = randomUUID();
const started = performance.now();
try {
  const result = await reviewSubject({
    subject,
    runId,
    satella: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve("local"),
      correlationId: runId,
    }),
    provider: createOpenAiCompatibleProvider({
      provider: config.llm.provider,
      baseUrl: config.llm.baseUrl,
      model: config.llm.model,
      ...(config.llm.apiKey === undefined ? {} : { apiKey: config.llm.apiKey }),
    }),
    limits: config.runLimits,
    autoApproveThreshold: config.autoApproveThreshold,
    venueChecks: createVenueChecks({
      fetch: globalThis.fetch,
      throttles: createVenueThrottles(),
      ...(search === undefined ? {} : { search }),
    }),
    extraTools: search === undefined ? [] : [webSearchTool(search)],
    ...(search === undefined ? {} : { webSearch: search }),
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
  await mock.close();
}
