import { z } from "zod";

import type { SystemFinding } from "../checks/types.js";
import {
  decisionSchema,
  findingSchema,
  infoRequestSchema,
} from "../satella-client/schemas.js";
import { CHECK_IDS, CHECKS } from "./checks.js";

/**
 * What the model submits to end a review, through the `submit_recommendation`
 * tool. It carries no autonomy: how much to trust the recommendation is the
 * policy's call, not the model's (CODING_STANDARDS "Autonomy is computed").
 */
export const proposalSchema = z.object({
  decision: decisionSchema,
  confidence: z.number().min(0).max(1),
  /** In Spanish, for a Spanish admin (CLAUDE.md §1). */
  rationale: z.string().min(1).max(4000),
  findings: z.array(findingSchema.extend({ check: z.enum(CHECK_IDS) })).max(30),
  /** Required when the decision is `request_info`. */
  infoRequest: infoRequestSchema.optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const SUBMIT_TOOL = {
  name: "submit_recommendation",
  description:
    "End the review with your recommendation. Call it exactly once, after " +
    "checking what you need. `rationale`, finding `detail`s and `infoRequest` " +
    "are written in Spanish for the admin. Each finding's `check` is one of:\n" +
    Object.entries(CHECKS)
      .map(([id, meaning]) => `- ${id}: ${meaning}`)
      .join("\n"),
  input: proposalSchema.refine(
    (proposal) =>
      proposal.decision !== "request_info" ||
      proposal.infoRequest !== undefined,
    {
      message: "infoRequest is required when decision is request_info",
      path: ["infoRequest"],
    },
  ),
} as const;

/**
 * An approval never contradicts the code (#33): when a deterministic or venue
 * check flagged something, the model's `approve` becomes a `request_info`
 * that asks about each flag. The policy then weighs it like any request
 * (ADR 0012). Only system findings count: a model finding is a claim.
 */
export function holdBackApproval(
  proposal: Proposal,
  systemFindings: readonly SystemFinding[],
): Proposal {
  if (proposal.decision !== "approve") return proposal;
  const flagged = systemFindings
    .map((item) => item.finding)
    .filter(
      (finding) => finding.verdict === "warn" || finding.verdict === "fail",
    );
  if (flagged.length === 0) return proposal;
  const questions = flagged
    .slice(0, MAX_QUESTIONS)
    .map((finding) =>
      `Aclara este punto antes de publicar: ${finding.detail}`.slice(
        0,
        MAX_QUESTION_CHARS,
      ),
    );
  return {
    ...proposal,
    decision: "request_info",
    rationale:
      `El análisis proponía aprobar, pero las comprobaciones automáticas detectaron algo que hay que aclarar antes. Propuesta original: ${proposal.rationale}`.slice(
        0,
        MAX_RATIONALE_CHARS,
      ),
    infoRequest: {
      questions,
      draft:
        `Hola. Antes de publicar el evento necesitamos que revises lo siguiente:\n${questions.map((question) => `- ${question}`).join("\n")}`.slice(
          0,
          MAX_DRAFT_CHARS,
        ),
    },
  };
}

// Satella's limits on a recommendation (`infoRequestSchema`, `proposalSchema`).
const MAX_QUESTIONS = 10;
const MAX_QUESTION_CHARS = 300;
const MAX_DRAFT_CHARS = 2000;
const MAX_RATIONALE_CHARS = 4000;
