/**
 * Runs eval cases through the real agent: the Satella mock serves the case's
 * fixtures, then `reviewSubject` runs the deterministic checks, the loop and
 * the policy. Only the model changes between modes:
 *
 * - **record** (`pnpm eval`): a real model, wrapped to keep every response,
 *   and the venue providers over the network, wrapped the same way;
 * - **replay** (`pnpm eval:replay`, CI): the recorded responses, the model's
 *   in order and the providers' by request hash. No network.
 *
 * Every input to the model is reproducible: fixtures come from the
 * recording's clock, the fence nonce and the run id derive from the case id
 * and the run index, and the limits are the defaults, never this machine's
 * environment.
 */
import { createHash } from "node:crypto";

import { REVIEW_PROMPT, type Prompt } from "../agent/prompt.js";
import { reviewSubject } from "../agent/review.js";
import { createUntrustedFence } from "../agent/untrusted.js";
import { loadConfig } from "../config/config.js";
import { DomainError } from "../errors.js";
import type { Fetch } from "../fetch.js";
import { isVenueCheck } from "../venue/scoring.js";
import { noThrottle } from "../venue/throttle.js";
import {
  createVenueChecks,
  createVenueThrottles,
  type VenueThrottles,
} from "../venue/venue-checks.js";
import { costMicros } from "../providers/pricing.js";
import type { LlmProvider } from "../providers/types.js";
import { createSatellaClient } from "../satella-client/client.js";
import { startMockSatella } from "../satella-client/mock-server.js";
import {
  createRecordingProvider,
  createReplayProvider,
  type Recording,
  StaleRecordingError,
} from "./recording.js";
import type { ReportSet } from "./report.js";
import type { RecordingSet } from "./store.js";
import { createAuthoredSearch } from "../search/authored.js";
import type { WebSearch } from "../search/types.js";
import { webSearchTool } from "../agent/web-search-tool.js";
import {
  createRecordingSearch,
  createReplaySearch,
} from "./search-recording.js";
import {
  createRecordingFetch,
  createReplayFetch,
  type ToolRecording,
} from "./tool-recording.js";
import {
  type CaseOutcome,
  type CaseResult,
  type EvalCase,
  isProblemCase,
} from "./types.js";

// The production defaults: a recording made on one machine replays on any.
const { runLimits, autoApproveThreshold: defaultThreshold } = loadConfig({});
const TOKEN = "eval";

export interface RunOptions {
  /** Defaults to the active prompt. */
  prompt?: Prompt;
  /**
   * Defaults to the production one. Lets a test move the metrics with the
   * same recordings, as a policy change would (#21).
   */
  autoApproveThreshold?: number;
}

export interface Recorded {
  /** Null when the run failed: there is nothing worth replaying. */
  recording: Recording | null;
  /** The venue providers' responses; null with `recording`. */
  toolRecording: ToolRecording | null;
  result: CaseResult;
}

export interface RecordOptions extends RunOptions {
  /** The network for the venue providers. Required, so a test can't reach it by accident. */
  fetch: Fetch;
  /**
   * The real web search (Tavily), for cases without authored pages.
   * Required for the same reason.
   */
  search: WebSearch;
  /** Shared across cases: the providers' limits are per client. */
  throttles?: VenueThrottles;
  /** Which repeat of the case to record (#42); 1 by default. */
  run?: number;
}

export async function recordCase(
  evalCase: EvalCase,
  provider: LlmProvider,
  clock: Date,
  options: RecordOptions,
): Promise<Recorded> {
  const prompt = options.prompt ?? REVIEW_PROMPT;
  const recorder = createRecordingProvider(provider);
  const tools = createRecordingFetch(options.fetch);
  const searches = createRecordingSearch(options.search);
  const run = options.run ?? 1;
  try {
    const outcome = await review(
      evalCase,
      run,
      recorder,
      tools.fetch,
      searches.search,
      options.throttles ?? createVenueThrottles(),
      clock,
      prompt,
      options.autoApproveThreshold ?? defaultThreshold,
    );
    const recording: Recording = {
      caseId: evalCase.id,
      provider: provider.provider,
      model: provider.model,
      ...(run === 1 ? {} : { run }),
      promptVersion: prompt.version,
      clock: clock.toISOString(),
      calls: recorder.calls,
      searches: searches.calls(),
    };
    return {
      recording,
      toolRecording: { caseId: evalCase.id, calls: tools.calls() },
      result: resultOf(evalCase, fromCalls(outcome, recording)),
    };
  } catch (error) {
    return {
      recording: null,
      toolRecording: null,
      result: failed(evalCase, error),
    };
  }
}

export async function replayCase(
  evalCase: EvalCase,
  recording: Recording | null,
  toolRecording: ToolRecording | null,
  options: RunOptions = {},
): Promise<CaseResult> {
  const prompt = options.prompt ?? REVIEW_PROMPT;
  try {
    if (recording === null) {
      throw new StaleRecordingError("missing_recording");
    }
    if (recording.promptVersion !== prompt.version) {
      throw new StaleRecordingError("prompt_version");
    }
    const outcome = await review(
      evalCase,
      recording.run ?? 1,
      createReplayProvider(recording),
      createReplayFetch(toolRecording),
      createReplaySearch(recording.searches),
      REPLAY_THROTTLES,
      new Date(recording.clock),
      prompt,
      options.autoApproveThreshold ?? defaultThreshold,
    );
    return resultOf(evalCase, fromCalls(outcome, recording));
  } catch (error) {
    return failed(evalCase, error);
  }
}

/** Replay makes no request worth spacing out. */
const REPLAY_THROTTLES: VenueThrottles = {
  nominatim: noThrottle,
  wikidata: noThrottle,
};

/** Replays every case, run by run, against one provider/model's recordings. */
export async function replaySet(
  cases: readonly EvalCase[],
  set: RecordingSet,
  /** By case id; shared by every set and run. */
  toolRecordings: ReadonlyMap<string, ToolRecording>,
  options: RunOptions = {},
): Promise<ReportSet> {
  const runs: CaseResult[][] = [];
  for (const recordings of set.runs) {
    const results: CaseResult[] = [];
    // One at a time: each case starts its own Satella mock.
    for (const evalCase of cases) {
      results.push(
        await replayCase(
          evalCase,
          recordings.get(evalCase.id) ?? null,
          toolRecordings.get(evalCase.id) ?? null,
          options,
        ),
      );
    }
    runs.push(results);
  }
  const recordings = set.runs.flatMap((run) => [...run.values()]);
  return {
    provider: set.provider,
    model: set.model,
    promptVersions: distinct(recordings.map((r) => r.promptVersion)),
    recordedOn: distinct(recordings.map((r) => r.clock.slice(0, 10))),
    runs,
  };
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function review(
  evalCase: EvalCase,
  runIndex: number,
  provider: LlmProvider,
  fetch: Fetch,
  webSearch: WebSearch,
  throttles: VenueThrottles,
  clock: Date,
  prompt: Prompt,
  autoApproveThreshold: number,
): Promise<Omit<CaseOutcome, "latencyMs" | "costMicros">> {
  const fixtures = evalCase.build(clock);
  // Invented organizers, artists and texts have no real web: their pages are
  // authored, and searched in code in both modes (ADR 0015 point 9).
  const search =
    fixtures.web === undefined ? webSearch : createAuthoredSearch(fixtures.web);
  const mock = await startMockSatella({
    fixtures: {
      events: fixtures.event === undefined ? [] : [fixtures.event],
      organizers: [fixtures.organizer],
      similar:
        fixtures.event === undefined
          ? {}
          : { [fixtures.event.event.id]: fixtures.similar ?? [] },
      benchmarks: fixtures.benchmarks ?? [],
    },
    tokens: { [TOKEN]: ["agent:read", "agent:recommend"] },
    now: () => clock,
  });
  const runId =
    runIndex === 1
      ? `eval-${evalCase.id}`
      : `eval-${evalCase.id}-run-${String(runIndex)}`;
  try {
    const { run } = await reviewSubject({
      subject:
        evalCase.subject === "event"
          ? { type: "event", id: requireEvent(evalCase, fixtures.event) }
          : { type: "organizer", id: fixtures.organizer.organizer.id },
      runId,
      satella: createSatellaClient({
        baseUrl: mock.baseUrl,
        getAccessToken: () => Promise.resolve(TOKEN),
        correlationId: runId,
      }),
      provider,
      limits: runLimits,
      autoApproveThreshold,
      venueChecks: createVenueChecks({ fetch, throttles, search }),
      extraTools: [webSearchTool(search)],
      webSearch: search,
      now: () => clock,
      fence: createUntrustedFence(nonceFor(evalCase.id, runIndex)),
      prompt,
      // A stale subject can't happen against fixed fixtures.
      maxStaleRetries: 0,
    });
    return {
      decision: run.recommendation.decision,
      autonomy: run.autonomy.autonomy,
      confidence: run.recommendation.confidence,
      reasons: run.autonomy.reasons,
      authoredWeb: fixtures.web !== undefined,
      venue: run.recommendation.findings
        .filter((finding) => isVenueCheck(finding.check))
        .map((finding) => ({ check: finding.check, verdict: finding.verdict })),
      endedBy: run.endedBy,
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
    };
  } finally {
    await mock.close();
  }
}

/** A case definition that can't run: a bug in the case, not in the agent. */
export class EvalCaseError extends DomainError {
  readonly code = "EVAL_CASE_INVALID";

  constructor(readonly caseId: string) {
    super(`Eval case ${caseId} is an event case without an event`);
  }
}

/**
 * Not random, or no replay would send the request it recorded. Each run gets
 * its own, as each production review does (#42); run 1 keeps the nonce it
 * had before repeats existed, so its recordings stay valid.
 */
function nonceFor(caseId: string, run: number): string {
  const seed = run === 1 ? caseId : `${caseId}:run-${String(run)}`;
  return createHash("sha256")
    .update(`eval-fence:${seed}`)
    .digest("hex")
    .slice(0, 24);
}

function requireEvent(
  evalCase: EvalCase,
  event: { event: { id: string } } | undefined,
): string {
  if (event === undefined) {
    throw new EvalCaseError(evalCase.id);
  }
  return event.event.id;
}

/** What only the recorded calls know: how long they took and what they cost. */
function fromCalls(
  outcome: Omit<CaseOutcome, "latencyMs" | "costMicros">,
  recording: Pick<Recording, "provider" | "model" | "calls">,
): CaseOutcome {
  const { calls } = recording;
  return {
    ...outcome,
    latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
    costMicros: costMicros(
      recording.provider,
      recording.model,
      calls.map((call) => call.response.usage),
    ),
  };
}

function resultOf(
  evalCase: EvalCase,
  outcome: CaseOutcome | null,
  failure: string | null = null,
): CaseResult {
  return {
    caseId: evalCase.id,
    slug: evalCase.slug,
    title: evalCase.title,
    problem: isProblemCase(evalCase.id),
    external: evalCase.requires?.includes("external") ?? false,
    expected: evalCase.expected,
    outcome,
    failure,
  };
}

/** Stable codes only: an error's text may quote a model or Satella response. */
function failed(evalCase: EvalCase, error: unknown): CaseResult {
  const failure =
    error instanceof StaleRecordingError
      ? `stale: ${error.reason}`
      : error instanceof DomainError
        ? `error: ${error.code}`
        : "error: UNEXPECTED";
  return resultOf(evalCase, null, failure);
}
