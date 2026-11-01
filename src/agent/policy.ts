/**
 * Graded autonomy (brief §4.2), computed from the findings and never taken
 * from the model's own claim. The model proposes; the policy decides how much
 * to trust it.
 *
 * - `approve` resolves on its own only with no `fail`, at most one minor
 *   `warn`, and confidence at or above the threshold.
 * - `reject` resolves on its own only on a hard signal: a `fail` from a
 *   hard-signal check, backed by at least one source.
 * - Everything else is escalated, including every `request_info`.
 *
 * The check lists are allowlists: a check the policy doesn't know is never
 * minor and never a hard signal, so a new check starts out conservative.
 */
import type { Decision, Finding } from "../satella-client/schemas.js";
import type { CheckId } from "./checks.js";

/** Warnings that say nothing about fraud (brief §4.2 «un warn leve»). */
export const MINOR_WARN_CHECKS: ReadonlySet<string> = new Set<CheckId>([
  "organizer_web_presence",
  "text_originality",
]);

/** Brief §4.2 hard signals; glossary «Hard signal». */
export const HARD_SIGNAL_CHECKS: ReadonlySet<string> = new Set<CheckId>([
  "off_platform_payment",
  "illegal_content",
  "exact_duplicate_other_organizer",
  "capacity_far_above_venue",
]);

export type Autonomy = "auto_resolved" | "escalated";

export interface AutonomyVerdict {
  autonomy: Autonomy;
  /** Why it was escalated or resolved: recorded with the run. */
  reasons: string[];
}

export function decideAutonomy(input: {
  decision: Decision;
  confidence: number;
  findings: readonly Finding[];
  autoApproveThreshold: number;
}): AutonomyVerdict {
  const { decision, confidence, findings, autoApproveThreshold } = input;

  if (decision === "approve") {
    const reasons: string[] = [];
    const fails = findings.filter((finding) => finding.verdict === "fail");
    const warns = findings.filter((finding) => finding.verdict === "warn");
    const majorWarns = warns.filter(
      (finding) => !MINOR_WARN_CHECKS.has(finding.check),
    );
    if (fails.length > 0) {
      reasons.push(`failed checks: ${checks(fails)}`);
    }
    if (majorWarns.length > 0) {
      reasons.push(`warnings that are not minor: ${checks(majorWarns)}`);
    }
    if (warns.length > 1) {
      reasons.push(`more than one warning (${String(warns.length)})`);
    }
    if (confidence < autoApproveThreshold) {
      reasons.push(
        `confidence ${String(confidence)} below ${String(autoApproveThreshold)}`,
      );
    }
    return reasons.length === 0
      ? { autonomy: "auto_resolved", reasons: ["clean approval"] }
      : { autonomy: "escalated", reasons };
  }

  if (decision === "reject") {
    const hardSignals = findings.filter(
      (finding) =>
        finding.verdict === "fail" &&
        HARD_SIGNAL_CHECKS.has(finding.check) &&
        finding.sources.length > 0,
    );
    return hardSignals.length > 0
      ? {
          autonomy: "auto_resolved",
          reasons: [`hard signals: ${checks(hardSignals)}`],
        }
      : {
          autonomy: "escalated",
          reasons: ["rejection without a sourced hard signal"],
        };
  }

  return {
    autonomy: "escalated",
    reasons: ["request_info always goes to a person"],
  };
}

function checks(findings: readonly Finding[]): string {
  return findings.map((finding) => finding.check).join(", ");
}
