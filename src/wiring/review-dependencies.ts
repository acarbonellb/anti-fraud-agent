/**
 * The composition root of a review (#92): what every entry point (the pass,
 * a local review, the evals) builds a review with, from the config and the
 * command's flags. The paid gate lives here once, so the three refuse the
 * same way; a new flag or evidence source is one edit here, not one per
 * script. The scripts keep argument parsing and output.
 */
import { reviewEvidence } from "../agent/review-evidence.js";
import type { ReviewSubjectInput } from "../agent/review.js";
import type { Config } from "../config/config.js";
import { DomainError } from "../errors.js";
import type { Fetch } from "../fetch.js";
import { createConfiguredProvider } from "../providers/from-config.js";
import { isPaidProvider } from "../providers/pricing.js";
import type { LlmProvider } from "../providers/types.js";
import { createSatellaClient } from "../satella-client/client.js";
import { createIdentityTokenSource } from "../satella-client/identity-token.js";
import {
  type SatellaConnection,
  startLocalSatella,
} from "../satella-client/local-satella.js";
import { createConfiguredSearch } from "../search/from-config.js";
import type { WebSearch } from "../search/types.js";
import { createFirestoreStore } from "../store/firestore-store.js";
import { createMemoryStore } from "../store/memory-store.js";
import type { AgentStore } from "../store/types.js";
import {
  createVenueThrottles,
  type VenueThrottles,
} from "../venue/venue-checks.js";

/** A paid provider configured, and the command wasn't told it may spend. */
export class PaidNotAllowedError extends DomainError {
  readonly code = "PAID_NOT_ALLOWED";

  constructor(readonly provider: string) {
    // CLAUDE.md §8: spending on a model needs the author's explicit go-ahead.
    super(`${provider} bills per token: pass --paid to spend (CLAUDE.md §8).`);
  }
}

/** `--mock` not given, and no Satella staging configured to review. */
export class SatellaNotConfiguredError extends DomainError {
  readonly code = "SATELLA_NOT_CONFIGURED";

  constructor() {
    super("no Satella configured: set SATELLA_STAGING_BASE_URL or use --mock");
  }
}

export interface ReviewerOptions {
  /** `--paid`: a provider that bills per token may run. */
  paid: boolean;
  /** Every request the evidence and the store send. Defaults to `fetch`. */
  fetch?: Fetch;
}

/** What reviews a subject, whatever Satella it reads. */
export interface Reviewer {
  provider: LlmProvider;
  // `search` and `throttles` stay exposed raw, next to the `evidence` built
  // from them, for the evals alone: `pnpm eval` wraps the search and the
  // venue fetch to record every call (`recordCase`), so it can't take the
  // evidence ready-made. The pass and a local review use `evidence`.
  /** Undefined without a Tavily key: reviews run without web search. */
  search: WebSearch | undefined;
  /** Shared across a command's runs: the providers' limits are per client. */
  throttles: VenueThrottles;
  /** The venue checks and web search a review takes, from `throttles` and `search`. */
  evidence: Pick<
    ReviewSubjectInput,
    "venueChecks" | "extraTools" | "webSearch"
  >;
}

/**
 * The model and the evidence, behind the paid gate. The evals stop here
 * (each case reviews against its own fixtures, with no store or Satella), and
 * so does a local review, which stores nothing and starts the mock itself.
 */
export function buildReviewer(
  config: Config,
  options: ReviewerOptions,
): Reviewer {
  if (isPaidProvider(config.llm.provider) && !options.paid) {
    // Before anything is built: a refused command constructs no client.
    throw new PaidNotAllowedError(config.llm.provider);
  }
  const fetch = options.fetch ?? globalThis.fetch;
  const search = createConfiguredSearch(config.webSearch);
  const throttles = createVenueThrottles();
  return {
    provider: createConfiguredProvider(config.llm),
    search,
    throttles,
    evidence: reviewEvidence({ fetch, throttles, search }),
  };
}

export interface ReviewDependenciesOptions extends ReviewerOptions {
  /** `--mock`: the in-process Satella and its fictitious feed. */
  mock: boolean;
  /** Sent to Satella as `X-Correlation-Id`. */
  correlationId: string;
}

export interface ReviewDependencies extends Reviewer {
  /** Firestore when its project is configured, in memory otherwise. */
  store: AgentStore;
  /** Closed by the caller when it's done. */
  satella: SatellaConnection;
}

/** A reviewer plus where its runs go and the Satella it reviews. */
export async function buildReviewDependencies(
  config: Config,
  options: ReviewDependenciesOptions,
): Promise<ReviewDependencies> {
  // Both refusals before the mock server starts: nothing to close on failure.
  const reviewer = buildReviewer(config, options);
  const staging = config.satella;
  if (!options.mock && staging === undefined) {
    throw new SatellaNotConfiguredError();
  }
  const store = buildStore(config.store, options.fetch);
  const satella =
    staging === undefined || options.mock
      ? await startLocalSatella(options.correlationId)
      : {
          // Staging with the job's Google identity token: only from Cloud Run.
          client: createSatellaClient({
            baseUrl: staging.baseUrl,
            getAccessToken: createIdentityTokenSource({
              audience: staging.audience,
            }),
            correlationId: options.correlationId,
          }),
          close: () => Promise.resolve(),
        };
  return { ...reviewer, store, satella };
}

function buildStore(
  config: Config["store"],
  fetch: Fetch | undefined,
): AgentStore {
  const { firestoreProjectId, firestoreEmulatorHost } = config;
  if (firestoreProjectId === undefined) return createMemoryStore();
  return createFirestoreStore({
    projectId: firestoreProjectId,
    ...(firestoreEmulatorHost === undefined
      ? {}
      : { emulatorHost: firestoreEmulatorHost }),
    ...(fetch === undefined ? {} : { fetch }),
  });
}
