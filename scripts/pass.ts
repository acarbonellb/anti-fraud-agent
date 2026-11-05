/**
 * One scheduled pass over Satella's feed (#45, ADR 0017): the entry point the
 * Cloud Run Job runs every 10 minutes (#46). Configured from the environment;
 * the store is Firestore with FIRESTORE_PROJECT_ID set, in memory otherwise.
 *
 * Satella staging isn't wired yet (#9): without `--mock` the pass exits with
 * an error before reading anything. With `--mock` it runs against the
 * in-process mock and its fictitious feed. A paid provider (`anthropic`)
 * runs only with `--paid`.
 *
 *   pnpm pass --mock            # the fixture feed, the local model
 *   pnpm pass --mock --paid     # with AGENT_LLM_PROVIDER=anthropic
 *
 * Writes one JSON line per log entry (ids and codes only) and exits 0 when
 * the pass ran, budget stop included; 1 when it failed.
 */
import { randomUUID } from "node:crypto";

import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { DomainError } from "../src/errors.js";
import { runPass } from "../src/pass/pass.js";
import {
  createConfiguredProvider,
  PAID_PROVIDERS,
} from "../src/providers/from-config.js";
import { createSatellaClient } from "../src/satella-client/client.js";
import { fixtures } from "../src/satella-client/fixtures.js";
import { startMockSatella } from "../src/satella-client/mock-server.js";
import { createTavilySearch } from "../src/search/tavily.js";
import { webSearchTool } from "../src/search/web-search-tool.js";
import { createFirestoreStore } from "../src/store/firestore-store.js";
import { createMemoryStore } from "../src/store/memory-store.js";
import {
  createVenueChecks,
  createVenueThrottles,
} from "../src/venue/venue-checks.js";

loadLocalEnvFile();
const config = loadConfig(process.env);
const correlationId = randomUUID();
const line = (entry: Record<string, unknown>) => {
  console.log(JSON.stringify({ correlationId, ...entry }));
};

if (!process.argv.includes("--mock")) {
  line({
    level: "error",
    event: "pass.refused",
    code: "SATELLA_NOT_CONFIGURED",
  });
  process.exit(1);
}
if (
  PAID_PROVIDERS.has(config.llm.provider) &&
  !process.argv.includes("--paid")
) {
  console.error(
    `✗ ${config.llm.provider} bills per token: pass --paid to spend (CLAUDE.md §8).`,
  );
  process.exit(2);
}

const { firestoreProjectId, firestoreEmulatorHost } = config.store;
const store =
  firestoreProjectId === undefined
    ? createMemoryStore()
    : createFirestoreStore({
        projectId: firestoreProjectId,
        ...(firestoreEmulatorHost === undefined
          ? {}
          : { emulatorHost: firestoreEmulatorHost }),
      });
const { tavilyApiKey } = config.webSearch;
// Without a key the pass reviews without web search, as production would.
const search =
  tavilyApiKey === undefined
    ? undefined
    : createTavilySearch({ apiKey: tavilyApiKey, fetch: globalThis.fetch });

const mock = await startMockSatella({
  fixtures: {
    feed: fixtures.feed,
    events: [fixtures.eventContext],
    organizers: [fixtures.organizerContext],
    similar: { [fixtures.eventContext.event.id]: fixtures.similarEvents },
  },
  tokens: { local: ["agent:read", "agent:recommend"] },
});

try {
  const report = await runPass({
    satella: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve("local"),
      correlationId,
    }),
    correlationId,
    provider: createConfiguredProvider(config.llm),
    store,
    limits: config.runLimits,
    autoApproveThreshold: config.autoApproveThreshold,
    dailyBudgetMicros: config.dailyBudgetMicros,
    // Only `anthropic` takes an effort: record it only where it was sent.
    effort: config.llm.provider === "anthropic" ? config.llm.effort : null,
    venueChecks: createVenueChecks({
      fetch: globalThis.fetch,
      throttles: createVenueThrottles(),
      ...(search === undefined ? {} : { search }),
    }),
    extraTools: search === undefined ? [] : [webSearchTool(search)],
    ...(search === undefined ? {} : { webSearch: search }),
    log: (entry) => {
      line(entry);
    },
  });
  line({
    level: "info",
    event: "pass.report",
    stoppedBy: report.stoppedBy,
    runs: report.runs,
    resolutions: report.resolutions,
    skippedItems: report.skippedItems,
  });
} catch (error) {
  // The code only: a message could carry more than ids.
  line({
    level: "error",
    event: "pass.failed",
    code: error instanceof DomainError ? error.code : "UNEXPECTED",
  });
  process.exitCode = 1;
} finally {
  await mock.close();
}
