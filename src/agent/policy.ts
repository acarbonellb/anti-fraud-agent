/**
 * Graded autonomy (brief §4.2, refined by ADR 0012), computed from the
 * findings and never taken from the model's own claim. The model proposes;
 * the policy decides how much to trust it.
 *
 * Evidence comes in two kinds. System findings are computed in code by the
 * deterministic checks: a `rule` one is a certain inconsistency, a `heuristic`
 * one crossed a threshold that needs judgement. Model findings are the
 * model's own observations; a model `pass` proves nothing and counts for
 * nothing.
 *
 * - `approve` resolves on its own only with no negative system finding, no
 *   model `fail`, at most one minor model `warn`, and confidence at the
 *   threshold.
 * - `request_info` resolves on its own only when every negative finding is a
 *   `rule` system finding, and confidence is at the threshold: the request is
 *   mechanical, anyone can verify it with the rule.
 * - `reject` resolves on its own only on a hard signal: a `fail` from a
 *   hard-signal check that is a `rule` system finding or carries a source.
 * - Everything else is escalated.
 *
 * In Satella only an auto-resolved approval skips the admin; the autonomy of
 * the rest is recorded and shown, which is what lets the policy be measured
 * against the admin's decisions (ADR 0012).
 */
import type { SystemFinding } from "../checks/types.js";
import type { Decision, Finding } from "../satella-client/schemas.js";
import type { CheckId } from "./checks.js";

/** Model warnings that say nothing about fraud (brief §4.2 «un warn leve»). */
export const MINOR_WARN_CHECKS: ReadonlySet<string> = new Set<CheckId>([
  "organizer_web_presence",
  "text_originality",
]);

/** Brief §4.2 hard signals; glossary «Hard signal». */
export const HARD_SIGNAL_CHECKS: ReadonlySet<string> = new Set<CheckId>([
  "off_platform_payment",
  "illegal_content",
  "minors_alcohol",
  "exact_duplicate_other_organizer",
  "capacity_far_above_venue",
]);

export type Autonomy = "auto_resolved" | "escalated";

export interface AutonomyVerdict {
  autonomy: Autonomy;
  /** Why it was escalated or resolved: recorded with the run. */
  reasons: string[];
}

export interface AutonomyInput {
  decision: Decision;
  confidence: number;
  systemFindings: readonly SystemFinding[];
  modelFindings: readonly Finding[];
  autoApproveThreshold: number;
}

const isNegative = (finding: Finding) =>
  finding.verdict === "fail" || finding.verdict === "warn";

export function decideAutonomy(input: AutonomyInput): AutonomyVerdict {
  const { decision, confidence, autoApproveThreshold } = input;
  const systemNegatives = input.systemFindings.filter((item) =>
    isNegative(item.finding),
  );
  const modelNegatives = input.modelFindings.filter(isNegative);
  const lowConfidence =
    confidence < autoApproveThreshold
      ? [
          `confidence ${String(confidence)} below ${String(autoApproveThreshold)}`,
        ]
      : [];

  if (decision === "approve") {
    const modelFails = modelNegatives.filter((f) => f.verdict === "fail");
    const modelWarns = modelNegatives.filter((f) => f.verdict === "warn");
    const majorWarns = modelWarns.filter(
      (f) => !MINOR_WARN_CHECKS.has(f.check),
    );
    const reasons = [
      ...(systemNegatives.length > 0
        ? [
            `deterministic checks flagged: ${checks(systemNegatives.map((item) => item.finding))}`,
          ]
        : []),
      ...(modelFails.length > 0
        ? [`failed checks: ${checks(modelFails)}`]
        : []),
      ...(majorWarns.length > 0
        ? [`warnings that are not minor: ${checks(majorWarns)}`]
        : []),
      ...(modelWarns.length > 1
        ? [`more than one warning (${String(modelWarns.length)})`]
        : []),
      ...lowConfidence,
    ];
    return reasons.length === 0
      ? { autonomy: "auto_resolved", reasons: ["clean approval"] }
      : { autonomy: "escalated", reasons };
  }

  if (decision === "reject") {
    const hardSignals = [
      ...systemNegatives
        .filter(
          (item) =>
            item.certainty === "rule" &&
            item.finding.verdict === "fail" &&
            HARD_SIGNAL_CHECKS.has(item.finding.check),
        )
        .map((item) => item.finding),
      ...modelNegatives.filter(
        (finding) =>
          finding.verdict === "fail" &&
          HARD_SIGNAL_CHECKS.has(finding.check) &&
          finding.sources.length > 0,
      ),
    ];
    return hardSignals.length > 0
      ? {
          autonomy: "auto_resolved",
          reasons: [`hard signals: ${checks(hardSignals)}`],
        }
      : {
          autonomy: "escalated",
          reasons: ["rejection without a rule-based or sourced hard signal"],
        };
  }

  const ruleNegatives = systemNegatives.filter(
    (item) => item.certainty === "rule",
  );
  const heuristicNegatives = systemNegatives.filter(
    (item) => item.certainty === "heuristic",
  );
  const reasons = [
    ...(ruleNegatives.length === 0
      ? ["no rule-based finding to ask about"]
      : []),
    ...(heuristicNegatives.length > 0
      ? [
          `needs judgement: ${checks(heuristicNegatives.map((item) => item.finding))}`,
        ]
      : []),
    ...(modelNegatives.length > 0
      ? [`model findings need judgement: ${checks(modelNegatives)}`]
      : []),
    ...lowConfidence,
  ];
  return reasons.length === 0
    ? {
        autonomy: "auto_resolved",
        reasons: [
          `mechanical request: ${checks(ruleNegatives.map((item) => item.finding))}`,
        ],
      }
    : { autonomy: "escalated", reasons };
}

function checks(findings: readonly Finding[]): string {
  return [...new Set(findings.map((finding) => finding.check))].join(", ");
}
