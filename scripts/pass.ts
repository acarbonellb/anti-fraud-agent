/**
 * One scheduled pass over Satella's feed (#45, ADR 0017): the entry point the
 * Cloud Run Job runs every 10 minutes (#46). Configured from the environment;
 * the store is Firestore with FIRESTORE_PROJECT_ID set, in memory otherwise.
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
 * the pass ran, budget stop included; 1 when it failed.
 */
import { randomUUID } from "node:crypto";

import { type Config, ConfigError, loadConfig } from "../src/config/config.js";
import { loadLocalEnvFile } from "../src/config/env-file.js";
import { DomainError } from "../src/errors.js";
import { logLine } from "../src/pass/log-line.js";
import { runPass } from "../src/pass/pass.js";
import {
  createConfiguredProvider,
  PAID_PROVIDERS,
} from "../src/providers/from-config.js";
import {
  createSatellaClient,
  type SatellaClient,
} from "../src/satella-client/client.js";
import { fixtures } from "../src/satella-client/fixtures.js";
import { createIdentityTokenSource } from "../src/satella-client/identity-token.js";
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
const correlationId = randomUUID();
const line = (entry: Parameters<typeof logLine>[0]) => {
  console.log(logLine({ correlationId, ...entry }));
};

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  // The variables' names and rules only: never their values.
  line({
    level: "error",
    event: "pass.refused",
    code: error instanceof ConfigError ? error.code : "UNEXPECTED",
    ...(error instanceof ConfigError
      ? { variables: error.issues.map((issue) => issue.variable).join(",") }
      : {}),
  });
  process.exit(1);
}

const target = process.argv.includes("--mock") ? "mock" : config.satella;
if (target === undefined) {
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
  // It bills per token: spending needs `--paid` (CLAUDE.md §8).
  line({ level: "error", event: "pass.refused", code: "PAID_NOT_ALLOWED" });
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

/**
 * The Satella the pass reviews: the in-process mock and its fictitious feed,
 * or staging with the job's Google identity token.
 */
async function connectSatella(
  to: NonNullable<typeof target>,
): Promise<{ client: SatellaClient; close: () => Promise<void> }> {
  if (to !== "mock") {
    return {
      client: createSatellaClient({
        baseUrl: to.baseUrl,
        getAccessToken: createIdentityTokenSource({ audience: to.audience }),
        correlationId,
      }),
      close: () => Promise.resolve(),
    };
  }
  const mock = await startMockSatella({
    fixtures: {
      feed: fixtures.feed,
      events: [fixtures.eventContext],
      organizers: [fixtures.organizerContext],
      similar: { [fixtures.eventContext.event.id]: fixtures.similarEvents },
    },
    tokens: { local: ["agent:read", "agent:recommend"] },
  });
  return {
    client: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve("local"),
      correlationId,
    }),
    close: () => mock.close(),
  };
}
const satella = await connectSatella(target);

try {
  const report = await runPass({
    satella: satella.client,
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
  await satella.close();
}
