/**
 * Reviews one subject end to end: read its context from Satella, run the
 * deterministic and venue checks, run the loop, submit the recommendation. Satella's `409 STALE_SUBJECT` means the
 * subject changed during the review: re-review the new version, never retry
 * the old recommendation (CLAUDE.md §4).
 */
import { runEventChecks } from "../checks/event-checks.js";
import {
  benchmarkQuery,
  priceBenchmarkCheck,
} from "../checks/price-benchmark.js";
import { runOrganizerChecks } from "../checks/organizer-checks.js";
import type { SystemFinding } from "../checks/types.js";
import type { LlmProvider } from "../providers/types.js";
import type { AgentReview, SatellaClient } from "../satella-client/index.js";
import { SatellaApiError } from "../satella-client/index.js";
import type {
  EventReviewContext,
  OrganizerReviewContext,
  Subject,
} from "../satella-client/schemas.js";
import { maxTicketsOnSale } from "../venue/scoring.js";
import type { VenueChecks } from "../venue/venue-checks.js";
import { type RunLimits, type RunResult, runReview } from "./loop.js";
import type { AutonomySubject } from "./policy.js";
import type { Prompt } from "./prompt.js";
import { satellaTools } from "./satella-tools.js";
import type { AnyAgentTool } from "./tools.js";
import type { UntrustedFence } from "./untrusted.js";

export interface ReviewSubjectInput {
  subject: Subject;
  runId: string;
  satella: SatellaClient;
  provider: LlmProvider;
  limits: RunLimits;
  autoApproveThreshold: number;
  /** For events, before the model (ADR 0015 point 2). */
  venueChecks: VenueChecks;
  /** Tools beyond Satella's own (deterministic checks, web research). */
  extraTools?: readonly AnyAgentTool[];
  /** Re-reviews after a stale subject before giving up. */
  maxStaleRetries?: number;
  /** For checks relative to "now" when an event isn't published yet. */
  now?: () => Date;
  /** A fixed nonce makes the requests reproducible (evals); random otherwise. */
  fence?: UntrustedFence;
  prompt?: Prompt;
}

export interface ReviewSubjectResult {
  run: RunResult;
  review: AgentReview;
  /** False when Satella already had this recommendation (an idempotent retry). */
  created: boolean;
  attempts: number;
}

export async function reviewSubject(
  input: ReviewSubjectInput,
): Promise<ReviewSubjectResult> {
  const { subject, satella } = input;
  const tools = [...satellaTools(satella), ...(input.extraTools ?? [])];
  const maxAttempts = 1 + (input.maxStaleRetries ?? 1);

  for (let attempt = 1; ; attempt += 1) {
    const now = input.now?.() ?? new Date();
    const { context, systemFindings, autonomySubject } =
      subject.type === "event"
        ? await prepareEvent(input, subject.id, now)
        : await prepareOrganizer(input, subject.id);

    const run = await runReview({
      provider: input.provider,
      tools,
      limits: input.limits,
      autoApproveThreshold: input.autoApproveThreshold,
      task: `${subject.type} ${subject.id}`,
      subject: autonomySubject,
      context,
      systemFindings,
      ...(input.fence === undefined ? {} : { fence: input.fence }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    });

    try {
      const { review, created } = await satella.createReview(
        {
          subject: { ...subject, version: context.version },
          decision: run.recommendation.decision,
          autonomy: run.autonomy.autonomy,
          confidence: run.recommendation.confidence,
          rationale: run.recommendation.rationale,
          findings: run.recommendation.findings,
          infoRequest: run.recommendation.infoRequest ?? null,
          agentRunId: input.runId,
          promptVersion: run.promptVersion,
          provider: run.provider,
          model: run.model,
        },
        // One key per run and attempt: a network retry of this submission is
        // safe, and a re-review after a stale subject is a new submission.
        { idempotencyKey: `${input.runId}:${String(attempt)}` },
      );
      return { run, review, created, attempts: attempt };
    } catch (error) {
      const stale =
        error instanceof SatellaApiError && error.code === "STALE_SUBJECT";
      if (!stale || attempt >= maxAttempts) throw error;
    }
  }
}

interface Prepared {
  context: EventReviewContext | OrganizerReviewContext;
  systemFindings: SystemFinding[];
  autonomySubject: AutonomySubject;
}

async function prepareEvent(
  input: ReviewSubjectInput,
  id: string,
  now: Date,
): Promise<Prepared> {
  const context = await input.satella.getEventContext(id);
  const benchmark = await input.satella
    .getPriceBenchmark(benchmarkQuery(context))
    // Without a benchmark the check says so; the review goes on.
    .catch((error: unknown) => {
      if (error instanceof SatellaApiError) return null;
      throw error;
    });
  return {
    context,
    systemFindings: [
      ...runEventChecks(context, now),
      priceBenchmarkCheck(context, benchmark),
      ...(await input.venueChecks(context)),
    ],
    autonomySubject: {
      type: "event",
      maxTicketsOnSale: maxTicketsOnSale(context),
    },
  };
}

async function prepareOrganizer(
  input: ReviewSubjectInput,
  id: string,
): Promise<Prepared> {
  const context = await input.satella.getOrganizerContext(id);
  return {
    context,
    systemFindings: runOrganizerChecks(context),
    autonomySubject: { type: "organizer" },
  };
}
