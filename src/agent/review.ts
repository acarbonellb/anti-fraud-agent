/**
 * Reviews one subject end to end: read its context from Satella, run the
 * loop, submit the recommendation. Satella's `409 STALE_SUBJECT` means the
 * subject changed during the review: re-review the new version, never retry
 * the old recommendation (CLAUDE.md §4).
 */
import type { LlmProvider } from "../providers/types.js";
import type { AgentReview, SatellaClient } from "../satella-client/index.js";
import { SatellaApiError } from "../satella-client/index.js";
import type { Subject } from "../satella-client/schemas.js";
import { type RunLimits, type RunResult, runReview } from "./loop.js";
import { satellaTools } from "./satella-tools.js";
import type { AnyAgentTool } from "./tools.js";

export interface ReviewSubjectInput {
  subject: Subject;
  runId: string;
  satella: SatellaClient;
  provider: LlmProvider;
  limits: RunLimits;
  autoApproveThreshold: number;
  /** Tools beyond Satella's own (deterministic checks, web research). */
  extraTools?: readonly AnyAgentTool[];
  /** Re-reviews after a stale subject before giving up. */
  maxStaleRetries?: number;
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
    const context =
      subject.type === "event"
        ? await satella.getEventContext(subject.id)
        : await satella.getOrganizerContext(subject.id);

    const run = await runReview({
      provider: input.provider,
      tools,
      limits: input.limits,
      autoApproveThreshold: input.autoApproveThreshold,
      task: `${subject.type} ${subject.id}`,
      context,
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
