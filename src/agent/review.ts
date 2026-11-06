/**
 * Reviews one subject end to end: read its context from Satella, run the
 * deterministic, venue and copied-text checks, run the loop, submit the
 * recommendation. Satella's `409 STALE_SUBJECT` means the
 * subject changed during the review: re-review the new version, never retry
 * the old recommendation (CLAUDE.md §4).
 */
import { runEventChecks } from "../checks/event-checks.js";
import {
  benchmarkQuery,
  priceBenchmarkCheck,
} from "../checks/price-benchmark.js";
import { copiedTextCheck } from "../checks/copied-text.js";
import { exactCloneCheck } from "../checks/exact-clone.js";
import {
  organizerHistoryChecks,
  runOrganizerChecks,
} from "../checks/organizer-checks.js";
import type { SystemFinding } from "../checks/types.js";
import type { LlmProvider } from "../providers/types.js";
import { countSearches } from "../search/counting.js";
import type { WebSearch } from "../search/types.js";
import type { AgentReview, SatellaClient } from "../satella-client/index.js";
import { SatellaApiError } from "../satella-client/index.js";
import type {
  EventReviewContext,
  OrganizerReviewContext,
  Subject,
} from "../satella-client/schemas.js";
import {
  maxTicketsOnSale,
  moneyOnSaleCents,
} from "../checks/tickets-on-sale.js";
import type { VenueChecks } from "../venue/venue-checks.js";
import { type RunLimits, type RunResult, runReview } from "./loop.js";
import type { AutonomySubject } from "./policy.js";
import type { Prompt } from "./prompt.js";
import { satellaTools } from "./satella-tools.js";
import type { AnyAgentTool } from "./tools.js";
import type { UntrustedFence } from "./untrusted.js";
import { webSearchTool } from "./web-search-tool.js";

export interface ReviewSubjectInput {
  subject: Subject;
  runId: string;
  satella: SatellaClient;
  provider: LlmProvider;
  limits: RunLimits;
  autoApproveThreshold: number;
  /** For events, before the model (ADR 0015 point 2). */
  venueChecks: VenueChecks;
  /**
   * The review's web search: the copied-text check, the capacity fallback and
   * the model's `web_search` tool, all counted as one (#82). Without it, the
   * review runs without web search.
   */
  webSearch?: WebSearch;
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
  const maxAttempts = 1 + (input.maxStaleRetries ?? 1);

  for (let attempt = 1; ; attempt += 1) {
    const now = input.now?.() ?? new Date();
    // Counted per attempt: each one is a review of its own version, and its
    // policy weighs the searches it ran.
    const counted =
      input.webSearch === undefined
        ? undefined
        : countSearches(input.webSearch);
    const tools = [
      ...satellaTools(satella),
      ...(counted === undefined ? [] : [webSearchTool(counted.search)]),
      ...(input.extraTools ?? []),
    ];
    const { context, systemFindings, autonomySubject } =
      subject.type === "event"
        ? await prepareEvent(input, subject.id, now, counted?.search)
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
      ...(counted === undefined ? {} : { searchCounts: counted.counts }),
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
  webSearch: WebSearch | undefined,
): Promise<Prepared> {
  const context = await input.satella.getEventContext(id);
  const [benchmark, similar, organizer, copiedText, venue] = await Promise.all([
    // Without a benchmark the check says so; the review goes on.
    orIfSatellaFails(
      input.satella.getPriceBenchmark(benchmarkQuery(context)),
      null,
    ),
    // Without them there is no clone finding; the model still has the tool.
    orIfSatellaFails(input.satella.findSimilarEvents(id), []),
    // Without it there is no history finding; the review goes on.
    orIfSatellaFails(
      input.satella.getOrganizerContext(context.organizerId),
      null,
    ),
    webSearch === undefined ? [] : copiedTextCheck(context, webSearch),
    input.venueChecks(context, webSearch),
  ]);
  return {
    context,
    systemFindings: [
      ...runEventChecks(context, now),
      priceBenchmarkCheck(context, benchmark),
      ...exactCloneCheck(context, similar),
      ...(organizer === null ? [] : organizerHistoryChecks(organizer)),
      ...copiedText,
      ...venue,
    ],
    autonomySubject: {
      type: "event",
      maxTicketsOnSale: maxTicketsOnSale(context),
      moneyOnSaleCents: moneyOnSaleCents(context),
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

/** What a check gets when Satella can't answer: the review goes on without it. */
function orIfSatellaFails<T, F>(
  request: Promise<T>,
  fallback: F,
): Promise<T | F> {
  return request.catch((error: unknown) => {
    if (error instanceof SatellaApiError) return fallback;
    throw error;
  });
}
