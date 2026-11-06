/**
 * One run as the store keeps it (ADR 0016 point 3): what the dashboard shows
 * (brief §6.1) and nothing more. The trace is the summary the loop keeps,
 * never a tool response; of Satella's review only its id stays (CLAUDE.md §4,
 * minimal logs; Firestore's 1 MiB document limit). Dates are UTC ISO strings,
 * cost integer micro-dollars.
 */
import { z } from "zod";

import type { ReviewSubjectResult } from "../agent/review.js";
import { StoreError } from "./types.js";
import {
  decisionSchema,
  findingSchema,
  infoRequestSchema,
  isoDate,
  subjectTypeSchema,
} from "../satella-client/schemas.js";

const count = z.number().int().nonnegative();

/**
 * Also a document id in Firestore: no `/`, and starting with a letter or
 * digit, so never `.`, `..` or the reserved `__…__`. Wide enough for
 * `randomUUID` and the evals' ids.
 */
export const runIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);

export const runTriggerSchema = z.enum(["scheduled", "on_demand"]);
export type RunTrigger = z.infer<typeof runTriggerSchema>;

const usageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadInputTokens: count,
  cacheWriteInputTokens: count,
});

/** What every run records, whether it finished or failed. */
const runBase = {
  runId: runIdSchema,
  trigger: runTriggerSchema,
  startedAt: isoDate,
  finishedAt: isoDate,
  latencyMs: count,
  provider: z.string().min(1),
  model: z.string().min(1),
  /** Null for providers that take none (only `anthropic` does). */
  effort: z.string().min(1).nullable(),
  promptVersion: z.string().min(1),
  /** Summed over the calls the run made, finished or not. */
  usage: usageSchema,
  /** Null for a model with no price: an unknown cost is never free. */
  costMicros: count.nullable(),
};

export const completedRunSchema = z.object({
  ...runBase,
  outcome: z.literal("completed"),
  subject: z.object({
    type: subjectTypeSchema,
    id: z.string().min(1),
    /** The `version` of the context that was reviewed. */
    version: z.string().min(1),
  }),
  decision: decisionSchema,
  autonomy: z.enum(["auto_resolved", "escalated"]),
  autonomyReasons: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  findings: z.array(findingSchema),
  rationale: z.string(),
  infoRequest: infoRequestSchema.nullable(),
  endedBy: z.enum([
    "submitted",
    "max_tool_calls",
    "max_tokens",
    "no_submission",
  ]),
  toolCalls: count,
  webSearches: count,
  trace: z.array(
    z.object({
      tool: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  review: z.object({
    id: z.string().min(1),
    /** False when Satella already had it (an idempotent retry). */
    created: z.boolean(),
    attempts: count,
  }),
});
export type CompletedRunDocument = z.infer<typeof completedRunSchema>;

/**
 * A run that ended without a recommendation in Satella: the model, a tool or
 * Satella failed (ADR 0017 point 3). Only the error's stable code is kept, and
 * the subject's version stays unknown: the failure can come before its
 * context is read.
 */
export const failedRunSchema = z.object({
  ...runBase,
  outcome: z.literal("failed"),
  subject: z.object({ type: subjectTypeSchema, id: z.string().min(1) }),
  error: z.object({ code: z.string().min(1).max(64) }),
});
export type FailedRunDocument = z.infer<typeof failedRunSchema>;

export const runDocumentSchema = z.discriminatedUnion("outcome", [
  completedRunSchema,
  failedRunSchema,
]);
export type RunDocument = z.infer<typeof runDocumentSchema>;

/**
 * The admin's resolution of a run's recommendation, read from Satella when
 * the feed says it was resolved (ADR 0017 point 4). Kept apart from the run,
 * which is never edited; the admin agreement rate (brief §4.3) joins them.
 */
export const runResolutionSchema = z.object({
  runId: runIdSchema,
  reviewId: z.string().min(1),
  outcome: z.enum(["accepted", "dismissed"]),
  resolvedAt: isoDate,
});
export type RunResolution = z.infer<typeof runResolutionSchema>;

export function validResolution(resolution: RunResolution): RunResolution {
  const parsed = runResolutionSchema.safeParse(resolution);
  if (!parsed.success) throw new StoreError("STORE_INVALID_INPUT");
  return parsed.data;
}

/**
 * A run the store can keep, or a typed error. The Zod error stays out: it can
 * quote the run's values.
 */
export function validRun(run: RunDocument): RunDocument {
  const parsed = runDocumentSchema.safeParse(run);
  if (!parsed.success) throw new StoreError("STORE_INVALID_INPUT");
  return parsed.data;
}

/** What the pass knows about a run that the review result doesn't. */
export interface RunMetadata {
  runId: string;
  trigger: RunTrigger;
  effort: string | null;
  startedAt: Date;
  finishedAt: Date;
  /** From the run's calls (`costMicros`); null when the model has no price. */
  costMicros: number | null;
}

export function toRunDocument(
  result: ReviewSubjectResult,
  metadata: RunMetadata,
): CompletedRunDocument {
  const { run, review } = result;
  const { recommendation, usage } = run;
  // Every field picked by name: whatever a result may carry beyond them stays
  // out of the store.
  return {
    runId: metadata.runId,
    outcome: "completed",
    trigger: metadata.trigger,
    startedAt: metadata.startedAt.toISOString(),
    finishedAt: metadata.finishedAt.toISOString(),
    latencyMs: metadata.finishedAt.getTime() - metadata.startedAt.getTime(),
    subject: {
      type: review.subject.type,
      id: review.subject.id,
      version: review.subject.version,
    },
    provider: run.provider,
    model: run.model,
    effort: metadata.effort,
    promptVersion: run.promptVersion,
    decision: recommendation.decision,
    autonomy: run.autonomy.autonomy,
    autonomyReasons: [...run.autonomy.reasons],
    confidence: recommendation.confidence,
    findings: recommendation.findings.map((finding) => ({
      check: finding.check,
      verdict: finding.verdict,
      detail: finding.detail,
      confidence: finding.confidence,
      sources: finding.sources.map(({ url, title }) => ({ url, title })),
    })),
    rationale: recommendation.rationale,
    infoRequest:
      recommendation.infoRequest === undefined
        ? null
        : {
            questions: [...recommendation.infoRequest.questions],
            draft: recommendation.infoRequest.draft,
          },
    endedBy: run.endedBy,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
      cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
    },
    costMicros: metadata.costMicros,
    toolCalls: run.toolCalls,
    webSearches: run.webSearches,
    // Undefined fields stay out: Firestore stores no `undefined`.
    trace: run.trace.map(({ tool, ok, error, note }) => ({
      tool,
      ok,
      ...(error === undefined ? {} : { error }),
      ...(note === undefined ? {} : { note }),
    })),
    review: {
      id: review.id,
      created: result.created,
      attempts: result.attempts,
    },
  };
}
