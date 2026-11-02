/**
 * Runs eval cases through the real agent: the Satella mock serves the case's
 * fixtures, then `reviewSubject` runs the deterministic checks, the loop and
 * the policy. Only the model changes between modes:
 *
 * - **record** (`pnpm eval`): a real model, wrapped to keep every response;
 * - **replay** (`pnpm eval:replay`, CI): the recorded responses, in order.
 *
 * Every input to the model is reproducible: fixtures come from the
 * recording's clock, the fence nonce and the run id derive from the case id,
 * and the limits are the defaults, never this machine's environment.
 */
import { createHash } from "node:crypto";

import { REVIEW_PROMPT, type Prompt } from "../agent/prompt.js";
import { reviewSubject } from "../agent/review.js";
import { createUntrustedFence } from "../agent/untrusted.js";
import { loadConfig } from "../config/config.js";
import { DomainError } from "../errors.js";
import type { LlmProvider } from "../providers/types.js";
import { createSatellaClient } from "../satella-client/client.js";
import { startMockSatella } from "../satella-client/mock-server.js";
import {
  createRecordingProvider,
  createReplayProvider,
  type RecordedCall,
  type Recording,
  StaleRecordingError,
} from "./recording.js";
import type { ReportSet } from "./report.js";
import type { RecordingSet } from "./store.js";
import {
  type CaseOutcome,
  type CaseResult,
  type EvalCase,
  isProblemCase,
} from "./types.js";

// The production defaults: a recording made on one machine replays on any.
const { runLimits, autoApproveThreshold } = loadConfig({});
const TOKEN = "eval";

export interface RunOptions {
  /** Defaults to the active prompt. */
  prompt?: Prompt;
}

export interface Recorded {
  /** Null when the run failed: there is nothing worth replaying. */
  recording: Recording | null;
  result: CaseResult;
}

export async function recordCase(
  evalCase: EvalCase,
  provider: LlmProvider,
  clock: Date,
  options: RunOptions = {},
): Promise<Recorded> {
  const prompt = options.prompt ?? REVIEW_PROMPT;
  const recorder = createRecordingProvider(provider);
  try {
    const outcome = await review(evalCase, recorder, clock, prompt);
    const recording: Recording = {
      caseId: evalCase.id,
      provider: provider.provider,
      model: provider.model,
      promptVersion: prompt.version,
      clock: clock.toISOString(),
      calls: recorder.calls,
    };
    return {
      recording,
      result: resultOf(evalCase, withLatency(outcome, recorder.calls)),
    };
  } catch (error) {
    return { recording: null, result: failed(evalCase, error) };
  }
}

export async function replayCase(
  evalCase: EvalCase,
  recording: Recording | null,
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
      createReplayProvider(recording),
      new Date(recording.clock),
      prompt,
    );
    return resultOf(evalCase, withLatency(outcome, recording.calls));
  } catch (error) {
    return failed(evalCase, error);
  }
}

/** Replays every case against one provider/model's recordings. */
export async function replaySet(
  cases: readonly EvalCase[],
  set: RecordingSet,
  options: RunOptions = {},
): Promise<ReportSet> {
  const results: CaseResult[] = [];
  // One at a time: each case starts its own Satella mock.
  for (const evalCase of cases) {
    results.push(
      await replayCase(
        evalCase,
        set.recordings.get(evalCase.id) ?? null,
        options,
      ),
    );
  }
  const recordings = [...set.recordings.values()];
  return {
    provider: set.provider,
    model: set.model,
    promptVersions: distinct(recordings.map((r) => r.promptVersion)),
    recordedOn: distinct(recordings.map((r) => r.clock.slice(0, 10))),
    results,
  };
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function review(
  evalCase: EvalCase,
  provider: LlmProvider,
  clock: Date,
  prompt: Prompt,
): Promise<Omit<CaseOutcome, "latencyMs">> {
  const fixtures = evalCase.build(clock);
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
  const runId = `eval-${evalCase.id}`;
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
      now: () => clock,
      fence: createUntrustedFence(nonceFor(evalCase.id)),
      prompt,
      // A stale subject can't happen against fixed fixtures.
      maxStaleRetries: 0,
    });
    return {
      decision: run.recommendation.decision,
      autonomy: run.autonomy.autonomy,
      confidence: run.recommendation.confidence,
      reasons: run.autonomy.reasons,
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

/** Not random, or no two runs would send the same request. */
function nonceFor(caseId: string): string {
  return createHash("sha256")
    .update(`eval-fence:${caseId}`)
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

function withLatency(
  outcome: Omit<CaseOutcome, "latencyMs">,
  calls: readonly RecordedCall[],
): CaseOutcome {
  return {
    ...outcome,
    latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
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
