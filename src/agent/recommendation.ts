import { z } from "zod";

import {
  decisionSchema,
  findingSchema,
  infoRequestSchema,
  REVIEW_MAX_FINDINGS,
  REVIEW_TEXT_LIMITS,
} from "../satella-client/schemas.js";
import { CHECK_IDS, CHECKS } from "../checks/vocabulary.js";

/**
 * What the model submits to end a review, through the `submit_recommendation`
 * tool. It carries no autonomy: how much to trust the recommendation is the
 * policy's call, not the model's (CODING_STANDARDS "Autonomy is computed").
 */
export const proposalSchema = z.object({
  decision: decisionSchema,
  confidence: z.number().min(0).max(1),
  /** In Spanish, for a Spanish admin (CLAUDE.md §1). */
  rationale: z.string().min(1).max(REVIEW_TEXT_LIMITS.rationaleChars),
  findings: z
    .array(findingSchema.extend({ check: z.enum(CHECK_IDS) }))
    .max(REVIEW_MAX_FINDINGS),
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
