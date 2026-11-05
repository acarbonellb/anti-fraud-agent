/**
 * One scheduled pass over Satella's feed (#45, ADR 0017): read a page from
 * the stored cursor, record the admins' resolutions, review each subject that
 * changed once, store a run for each and advance the cursor. Every run
 * reserves its worst-case cost first, and the pass stops at the day's budget.
 * A review that fails is stored as failed and doesn't hold the feed back;
 * one that failed for a reason that can pass is queued and tried again on
 * later passes, a bounded number of times (#57).
 */
import { randomUUID } from "node:crypto";

import { type RunLimits } from "../agent/loop.js";
import { PROMPT_VERSION } from "../agent/prompt.js";
import { type ReviewSubjectResult, reviewSubject } from "../agent/review.js";
import type { AnyAgentTool } from "../agent/tools.js";
import { DomainError } from "../errors.js";
import { costMicros, worstCaseMicros } from "../providers/pricing.js";
import type { LlmProvider, TokenUsage } from "../providers/types.js";
import type {
  FeedItem,
  FeedItemType,
  FeedPage,
  SatellaClient,
  Subject,
} from "../satella-client/index.js";
import type { WebSearch } from "../search/types.js";
import {
  type FailedRunDocument,
  runIdSchema,
  toRunDocument,
} from "../store/run-document.js";
import type { PendingRetry } from "../store/retry-queue.js";
import type { AgentStore } from "../store/types.js";
import type { VenueChecks } from "../venue/venue-checks.js";
import {
  afterReview,
  isTransient,
  type ReviewOutcome,
  subjectKey,
} from "./retries.js";

/** At most this many feed items a pass, every 10 minutes (#45). */
export const PASS_PAGE_SIZE = 10;

/** `reviewSubject`'s re-reviews after `409 STALE_SUBJECT` (ADR 0017 point 3). */
const STALE_RETRIES = 1;

/**
 * The feed items that start a review (ADR 0017 point 1). Not
 * `event.minor_change`, a start time moved by up to 3 h the same day: no
 * fraud signal. `agent_review.resolved` records a resolution instead.
 */
const REVIEWABLE: ReadonlySet<FeedItemType> = new Set<FeedItemType>([
  "event.published",
  "event.content_updated",
  "event.ticket_type_capacity_set",
  "event.service_fee_set",
  "event.ticket_type_service_fee_set",
  "event.substantial_change",
  "organizer.registered",
  "organizer.profile_updated",
  "content_report.created",
]);

/** Ids and codes only, never Satella's data (CLAUDE.md §4, minimal logs). */
interface LogFields {
  level: "info" | "warn";
  event: string;
  runId?: string;
  subject?: Subject;
  code?: string;
  // Scalars only, so no Satella object can ride along (CLAUDE.md §4).
  [detail: string]: string | number | boolean | null | Subject | undefined;
}
export type PassLogLine = LogFields & { correlationId: string };
type Log = (line: LogFields) => void;

export interface PassOptions {
  satella: SatellaClient;
  /** Joins the pass's log lines and Satella's (`X-Correlation-Id`). */
  correlationId: string;
  provider: LlmProvider;
  store: AgentStore;
  limits: RunLimits;
  autoApproveThreshold: number;
  dailyBudgetMicros: number;
  /** Recorded with each run; null for providers that take none. */
  effort: string | null;
  venueChecks: VenueChecks;
  webSearch?: WebSearch;
  extraTools?: readonly AnyAgentTool[];
  pageSize?: number;
  now?: () => Date;
  newRunId?: () => string;
  log?: (line: PassLogLine) => void;
}

export interface PassRun {
  runId: string;
  subject: Subject;
  outcome: "completed" | "failed";
}

export interface PassReport {
  /** `budget`: the day's budget can't take another run; the feed waits. */
  stoppedBy: "end_of_page" | "budget";
  runs: PassRun[];
  resolutions: number;
  /** Items that start no review, and those of types the agent doesn't know. */
  skippedItems: number;
  /** Where the next pass starts. */
  cursor: string | null;
  /** Subjects left to try again on a later pass. */
  retriesQueued: number;
}

export class PassError extends DomainError {
  constructor(readonly code: "PASS_UNPRICED_MODEL") {
    super(`pass refused: ${code}`);
  }
}

export async function runPass(options: PassOptions): Promise<PassReport> {
  const { store, satella, provider, correlationId } = options;
  const now = options.now ?? (() => new Date());
  const newRunId = options.newRunId ?? randomUUID;
  const log: Log = (line) => {
    options.log?.({ ...line, correlationId });
  };

  // A model with no price would make the budget meaningless (an unknown cost
  // is never free): refuse before anything is read or spent.
  const perAttempt = worstCaseMicros(
    provider.provider,
    provider.model,
    options.limits.maxTokens,
  );
  if (perAttempt === null) throw new PassError("PASS_UNPRICED_MODEL");
  // A stale subject is reviewed again within the same run, at full cost.
  const worstCase = perAttempt * (1 + STALE_RETRIES);

  const from = await store.readFeedCursor();
  const queued = await store.readRetryQueue();
  let queue = queued;
  // Written before the cursor moves: if the write fails, the page is read
  // again and its failures are queued then.
  const saveQueue = async () => {
    if (JSON.stringify(queue) !== JSON.stringify(queued)) {
      await store.replaceRetryQueue(queue);
    }
  };
  const stopped = async (
    runs: PassRun[],
    resolutions: number,
    page: FeedPage | null,
  ): Promise<PassReport> => {
    await saveQueue();
    return {
      stoppedBy: "budget",
      runs,
      resolutions,
      skippedItems: page === null ? 0 : skippedItems(page),
      cursor: from,
      retriesQueued: queue.length,
    };
  };

  // Ask the feed for no more items than the day can review: then the cursor
  // the page returns never skips an item left unreviewed for lack of budget.
  const spend = await store.daySpend();
  const left =
    options.dailyBudgetMicros - spend.settledMicros - spend.heldMicros;
  const affordable = worstCase === 0 ? Infinity : Math.floor(left / worstCase);
  const room = Math.min(options.pageSize ?? PASS_PAGE_SIZE, affordable);
  if (room < 1) {
    log({
      level: "warn",
      event: "pass.budget_reached",
      code: "BUDGET_REACHED",
      ...spend,
    });
    return await stopped([], 0, null);
  }

  // Retries take at most half the pass, so the feed always moves and a pass
  // still reviews no more than a page (ADR 0018's timeout).
  const retrying = queued.slice(0, Math.floor(room / 2));
  const page = await satella.getFeed({
    ...(from === null ? {} : { cursor: from }),
    limit: room - retrying.length,
  });
  log({ level: "info", event: "pass.page_read", items: page.items.length });

  let resolutions = 0;
  for (const item of page.items) {
    if (item.type !== "agent_review.resolved") continue;
    if (await recordResolution(options, item, log)) resolutions += 1;
  }

  const runs: PassRun[] = [];
  for (const subject of subjectsToReview(retrying, page.items)) {
    const runId = newRunId();
    const reservation = await store.reserveSpend({
      runId,
      micros: worstCase,
      budgetMicros: options.dailyBudgetMicros,
    });
    if (!reservation.ok) {
      // Only another run spending meanwhile gets here (the page was sized to
      // the budget). The cursor stays: this page is read again tomorrow.
      log({
        level: "warn",
        event: "pass.budget_reached",
        code: "BUDGET_REACHED",
        runId,
        subject,
        ...reservation.spend,
      });
      return await stopped(runs, resolutions, page);
    }

    const failures =
      queued.find((retry) => subjectKey(retry.subject) === subjectKey(subject))
        ?.failures ?? 0;
    const outcome = await reviewAndStore(
      options,
      subject,
      runId,
      failures,
      now,
      log,
    );
    await store.settleSpend(reservation.hold, outcome.costMicros);
    runs.push({ runId, subject, outcome: outcome.review.outcome });
    const next = afterReview(queue, subject, outcome.review);
    queue = next.queue;
    if (next.abandoned !== null) logAbandoned(next.abandoned, runId, log);
  }

  await saveQueue();

  // An empty page returns the cursor it was sent: nothing to move.
  const to = page.nextCursor;
  if (to !== null && to !== from) await store.advanceFeedCursor(from, to);
  log({ level: "info", event: "pass.done", runs: runs.length, resolutions });
  return {
    stoppedBy: "end_of_page",
    runs,
    resolutions,
    skippedItems: skippedItems(page),
    cursor: to ?? from,
    retriesQueued: queue.length,
  };
}

/**
 * The only trace of a subject the agent gave up on: its last run is stored
 * as failed, and this line is what an alert can match (#57).
 */
function logAbandoned(retry: PendingRetry, runId: string, log: Log): void {
  log({
    level: "warn",
    event: "run.abandoned",
    runId,
    subject: retry.subject,
    code: retry.code,
    failures: retry.failures,
  });
}

/** Items that start no review, and those of types the agent doesn't know. */
function skippedItems(page: FeedPage): number {
  return (
    page.skippedTypes.length +
    page.items.filter(
      (item) =>
        !REVIEWABLE.has(item.type) && item.type !== "agent_review.resolved",
    ).length
  );
}

/**
 * Each subject once, the queued retries first, then in the order it first
 * appears (ADR 0017 point 2): the review context is always current, so a
 * second review would see the same.
 */
function subjectsToReview(
  retrying: readonly PendingRetry[],
  items: readonly FeedItem[],
): Subject[] {
  const seen = new Map<string, Subject>();
  for (const { subject } of retrying) seen.set(subjectKey(subject), subject);
  for (const item of items) {
    if (!REVIEWABLE.has(item.type)) continue;
    const key = subjectKey(item.subject);
    if (!seen.has(key)) {
      seen.set(key, { type: item.subject.type, id: item.subject.id });
    }
  }
  return [...seen.values()];
}

async function reviewAndStore(
  options: PassOptions,
  subject: Subject,
  runId: string,
  /** How many times this subject's review already failed for a passing reason. */
  previousFailures: number,
  now: () => Date,
  log: Log,
): Promise<{ review: ReviewOutcome; costMicros: number }> {
  const { provider, store } = options;
  // Every call's usage, kept even when the run fails half-way, so what it
  // spent is settled either way.
  const calls: TokenUsage[] = [];
  const metered: LlmProvider = {
    provider: provider.provider,
    model: provider.model,
    async complete(request) {
      const response = await provider.complete(request);
      calls.push(response.usage);
      return response;
    },
  };
  // Priced: the pass refused an unpriced model before it started.
  const spent = () => costMicros(provider.provider, provider.model, calls) ?? 0;

  const startedAt = now();
  log({
    level: "info",
    event: "run.started",
    runId,
    subject,
    ...(previousFailures === 0 ? {} : { previousFailures }),
  });
  let result: ReviewSubjectResult;
  try {
    result = await reviewSubject({
      subject,
      runId,
      satella: options.satella,
      provider: metered,
      limits: options.limits,
      autoApproveThreshold: options.autoApproveThreshold,
      venueChecks: options.venueChecks,
      maxStaleRetries: STALE_RETRIES,
      now,
      ...(options.webSearch === undefined
        ? {}
        : { webSearch: options.webSearch }),
      ...(options.extraTools === undefined
        ? {}
        : { extraTools: options.extraTools }),
    });
  } catch (error) {
    // Any failure, typed or not: one bad subject must not stall the feed. A
    // transient one is tried again on a later pass. Only the stable code is
    // kept (ADR 0017 point 3 and amendment).
    const code = error instanceof DomainError ? error.code : "UNEXPECTED";
    const finishedAt = now();
    const usage = calls.reduce<FailedRunDocument["usage"]>(
      (total, call) => ({
        inputTokens: total.inputTokens + call.inputTokens,
        outputTokens: total.outputTokens + call.outputTokens,
        cacheReadInputTokens:
          total.cacheReadInputTokens + (call.cacheReadInputTokens ?? 0),
        cacheWriteInputTokens:
          total.cacheWriteInputTokens + (call.cacheWriteInputTokens ?? 0),
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    );
    await store.saveRun({
      runId,
      outcome: "failed",
      trigger: "scheduled",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      latencyMs: finishedAt.getTime() - startedAt.getTime(),
      subject,
      provider: provider.provider,
      model: provider.model,
      effort: options.effort,
      promptVersion: PROMPT_VERSION,
      error: { code },
      usage,
      costMicros: spent(),
    });
    const transient = isTransient(error);
    log({
      level: "warn",
      event: "run.failed",
      runId,
      subject,
      code,
      transient,
    });
    return {
      review: { outcome: "failed", code, transient },
      costMicros: spent(),
    };
  }

  // Outside the try: Satella has the recommendation, so a store that can't
  // save it fails the pass instead of recording the run as failed.
  const document = toRunDocument(result, {
    runId,
    trigger: "scheduled",
    effort: options.effort,
    startedAt,
    finishedAt: now(),
    costMicros: spent(),
  });
  await store.saveRun(document);
  log({
    level: "info",
    event: "run.completed",
    runId,
    subject,
    version: document.subject.version,
    decision: document.decision,
    autonomy: document.autonomy,
    attempts: result.attempts,
  });
  return { review: { outcome: "completed" }, costMicros: spent() };
}

/**
 * Reads the resolved recommendation and stores its outcome next to the run
 * that made it (ADR 0017 point 4). A recommendation from no run of this store
 * (a local review, another deployment) is left out; a failed read is logged
 * and doesn't hold the feed back.
 */
async function recordResolution(
  options: PassOptions,
  item: FeedItem,
  log: Log,
): Promise<boolean> {
  const { reviewId } = item;
  if (reviewId === undefined) return false;
  let review;
  try {
    review = await options.satella.getReview(reviewId);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    log({
      level: "warn",
      event: "resolution.unread",
      reviewId,
      code: error.code,
    });
    return false;
  }
  const runId = review.agentRunId;
  if (
    review.resolution === null ||
    !runIdSchema.safeParse(runId).success ||
    (await options.store.getRun(runId)) === null
  ) {
    log({ level: "info", event: "resolution.skipped", reviewId });
    return false;
  }
  await options.store.saveResolution({
    runId,
    reviewId,
    outcome: review.resolution.outcome,
    resolvedAt: review.resolution.resolvedAt,
  });
  log({
    level: "info",
    event: "resolution.recorded",
    runId,
    reviewId,
    outcome: review.resolution.outcome,
  });
  return true;
}
