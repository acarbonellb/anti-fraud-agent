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
 *   hard-signal check that is a `rule` system finding or carries a source
 *   (a model finding, or a venue finding backed by OSM or Wikidata).
 * - Everything else is escalated.
 *
 * External evidence (ADR 0015) tightens two of those:
 *
 * - an event's `approve` also needs venue evidence: the venue verified, and
 *   its capacity verified or, when no one publishes it, at most
 *   `EXPOSURE_CAP_TICKETS` on sale in any session;
 * - an organizer review never resolves on its own: no structured evidence
 *   backs a new organizer.
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

/**
 * Tickets on sale per session an approval may risk on a verified venue of
 * unknown capacity: the smallest `capacityBand` (ADR 0015 point 5).
 * Provisional until the evals tune it.
 */
export const EXPOSURE_CAP_TICKETS = 300;

export type Autonomy = "auto_resolved" | "escalated";

/** What the policy needs to know about the subject beyond the findings. */
export type AutonomySubject =
  | { type: "organizer" }
  | {
      type: "event";
      /** From the same function the capacity check reads. */
      maxTicketsOnSale: number;
    };

export interface AutonomyVerdict {
  autonomy: Autonomy;
  /** Why it was escalated or resolved: recorded with the run. */
  reasons: string[];
}

export interface AutonomyInput {
  subject: AutonomySubject;
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
  if (input.subject.type === "organizer") {
    return {
      autonomy: "escalated",
      reasons: ["organizer reviews always escalate (ADR 0015)"],
    };
  }
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
      ...venueGaps(input.systemFindings, input.subject.maxTicketsOnSale),
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
            // A heuristic counts only with a source anyone can open: today,
            // the capacity check backed by OSM or Wikidata (ADR 0015 point 4).
            (item.certainty === "rule" || item.finding.sources.length > 0) &&
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

/**
 * What an approval lacks in venue evidence. Negative venue findings are
 * already reasons as negatives; this adds the missing positives.
 */
function venueGaps(
  systemFindings: readonly SystemFinding[],
  maxTicketsOnSale: number,
): string[] {
  const verdictOf = (...names: string[]) =>
    systemFindings.find((item) => names.includes(item.finding.check))?.finding
      .verdict;
  const venue = verdictOf("venue_exists");
  const capacity = verdictOf("venue_capacity", "capacity_far_above_venue");
  return [
    ...(venue === "pass" || venue === "fail" || venue === "warn"
      ? []
      : [`venue not verified (${venue ?? "not checked"})`]),
    ...(capacity === undefined
      ? ["venue capacity not checked"]
      : capacity === "unknown" && maxTicketsOnSale > EXPOSURE_CAP_TICKETS
        ? [
            `capacity unknown with ${String(maxTicketsOnSale)} tickets on sale in one session, above the exposure cap of ${String(EXPOSURE_CAP_TICKETS)}`,
          ]
        : []),
  ];
}

function checks(findings: readonly Finding[]): string {
  return [...new Set(findings.map((finding) => finding.check))].join(", ");
}
