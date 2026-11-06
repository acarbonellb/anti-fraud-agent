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
 *   model `fail` and at most one minor model `warn`.
 * - `request_info` resolves on its own only when every negative finding is a
 *   `rule` system finding: the request is mechanical, anyone can verify it
 *   with the rule.
 * - `reject` resolves on its own only on a hard signal: a `fail` from a
 *   hard-signal check that is a `rule` system finding or carries a source.
 *   A venue finding's source is OSM or Wikidata: a capacity from the web
 *   never fails (ADR 0015, amendment of #57). A model finding's source
 *   counts only if a tool retrieved that URL in this run (`web_search`):
 *   one the model wrote itself is a claim.
 * - Everything else is escalated.
 *
 * External evidence (ADR 0015) tightens two of those:
 *
 * - an event's `approve` also needs venue evidence: the venue verified, and
 *   its capacity verified or, when no one publishes it, at most the
 *   exposure cap on sale in any session: `OPEN_SPACE_EXPOSURE_CAP_TICKETS`
 *   for an open space, `EXPOSURE_CAP_TICKETS` for any other or unknown type,
 *   and at most the money cap on sale over all sessions
 *   (`OPEN_SPACE_MONEY_CAP_CENTS`, `MONEY_CAP_CENTS`, #82);
 * - an organizer `approve` or `reject` never resolves on its own: no
 *   structured evidence backs a new organizer. A mechanical organizer
 *   `request_info` still does (amendment of #79).
 *
 * The review's confidence is the evidence tier of what resolved it, not the
 * model's number (ADR 0019): the threshold compares the tier, and the
 * model's number can only hold back, below `MODEL_CONFIDENCE_FLOOR`.
 *
 * In Satella only an auto-resolved approval skips the admin; the autonomy of
 * the rest is recorded and shown, which is what lets the policy be measured
 * against the admin's decisions (ADR 0012).
 */
import { euros } from "../checks/event-checks.js";
import type { SystemFinding } from "../checks/types.js";
import {
  type Decision,
  type Finding,
  REVIEW_TEXT_LIMITS,
} from "../satella-client/schemas.js";
import type { CheckId } from "../checks/vocabulary.js";
import type { Proposal } from "./recommendation.js";

/**
 * Model warnings that say nothing about fraud (brief §4.2 «un warn leve»).
 * A copied description does (case 23), so `text_originality` isn't one (#82).
 */
export const MINOR_WARN_CHECKS: ReadonlySet<string> = new Set<CheckId>([
  "organizer_web_presence",
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

/**
 * OSM `category=type` of the open spaces: a park or a square publishes no
 * capacity, yet a festival there sells thousands per session (case N2). A
 * short list that grows when a real case needs it (a beach, a fairground).
 */
export const OPEN_SPACE_TYPES: ReadonlySet<string> = new Set([
  "leisure=park",
  "leisure=recreation_ground",
  "place=square",
]);

/**
 * The exposure cap of an open space (ADR 0015, amendment of #78). A starting
 * value from one case: N2 sells 6,000 in one session, so 5,000 would leave it
 * escalating; with no cap, any "park" with 50,000 tickets would resolve on its
 * own. To be revised with real festivals from the feed.
 */
export const OPEN_SPACE_EXPOSURE_CAP_TICKETS = 10_000;

/**
 * Money on sale, over all sessions, an approval may risk on a verified venue
 * of unknown capacity (#82): the ticket cap alone lets ten sessions of 300,
 * or 300 tickets at 950 €, resolve as readily as one session at 8 €. 15.000 €
 * is the exposure cap at 50 € a ticket. Provisional, from the cases: the
 * legitimate ones of unknown capacity outside an open space put at most
 * 3.720 € on sale (N6), case 13 puts 266.000 € and case 06 16.800 €.
 */
export const MONEY_CAP_CENTS = 1_500_000;

/**
 * The money cap of an open space. A three-day festival in a park puts
 * 590.000 € on sale (case N2); 1.000.000 € leaves it the same margin the
 * open-space ticket cap leaves its 6,000 tickets. Provisional, like that one.
 */
export const OPEN_SPACE_MONEY_CAP_CENTS = 100_000_000;

const isOpenSpace = (venueType: string | undefined) =>
  venueType !== undefined && OPEN_SPACE_TYPES.has(venueType);

/** An unknown type keeps the prudent caps. */
function exposureCaps(venueType: string | undefined): {
  tickets: number;
  cents: number;
} {
  return isOpenSpace(venueType)
    ? {
        tickets: OPEN_SPACE_EXPOSURE_CAP_TICKETS,
        cents: OPEN_SPACE_MONEY_CAP_CENTS,
      }
    : { tickets: EXPOSURE_CAP_TICKETS, cents: MONEY_CAP_CENTS };
}

/**
 * The review's confidence by the evidence that resolved it (ADR 0019). Each
 * value is a rank, not a probability fitted to the evals: what anyone can
 * re-check ranks above what needs a lookup, which ranks above what rests on a
 * cap. `AGENT_AUTO_APPROVE_THRESHOLD` (0.85) is the lowest tier that
 * resolves on its own.
 */
export const EVIDENCE_TIERS = {
  /** A request backed only by rules, or a rejection on a hard signal. */
  ruleOrHardSignal: 0.95,
  /** A clean approval with the venue and its capacity verified. */
  verifiedCapacity: 0.9,
  /** A clean approval of an unknown capacity, under the exposure cap. */
  underExposureCap: 0.85,
} as const;

/**
 * What an escalated review shows at most: below the lowest tier, so it never
 * reads as confident enough to have resolved.
 */
export const ESCALATED_CONFIDENCE_CAP = 0.84;

/**
 * Below this, the model doubts its own decision more than it trusts it, and
 * an auto-resolution escalates whatever the evidence (ADR 0019). A safety
 * net set at even odds, not a threshold fitted to any case.
 */
export const MODEL_CONFIDENCE_FLOOR = 0.5;

export type Autonomy = "auto_resolved" | "escalated";

/** What the policy needs to know about the subject beyond the findings. */
export type AutonomySubject =
  | { type: "organizer" }
  | {
      type: "event";
      /** From the same function the capacity check reads. */
      maxTicketsOnSale: number;
      /** Over all scheduled sessions, from `moneyOnSaleCents`. */
      moneyOnSaleCents: number;
    };

type EventSubject = Extract<AutonomySubject, { type: "event" }>;

export interface AutonomyVerdict {
  autonomy: Autonomy;
  /** Why it was escalated or resolved: recorded with the run. */
  reasons: string[];
  /**
   * The review's confidence: its evidence tier when it resolved, the model's
   * number capped at `ESCALATED_CONFIDENCE_CAP` when it escalated.
   */
  confidence: number;
}

export interface AutonomyInput {
  subject: AutonomySubject;
  decision: Decision;
  /** The model's own number: kept for comparison, it can only hold back. */
  modelConfidence: number;
  systemFindings: readonly SystemFinding[];
  modelFindings: readonly Finding[];
  /** URLs the run's tools retrieved; see `sourced`. */
  retrievedUrls: ReadonlySet<string>;
  autoApproveThreshold: number;
  /**
   * The model asked for a search past the run's budget: it wanted more
   * evidence than it got (ADR 0015 amendment, #31).
   */
  searchBudgetSpent: boolean;
}

const isNegative = (finding: Finding) =>
  finding.verdict === "fail" || finding.verdict === "warn";

/** What the evidence alone says, before the threshold and the holds. */
type EvidenceVerdict =
  | { autonomy: "auto_resolved"; reasons: string[]; tier: number }
  | { autonomy: "escalated"; reasons: string[] };

export function decideAutonomy(input: AutonomyInput): AutonomyVerdict {
  const { modelConfidence, autoApproveThreshold } = input;
  const evidence = decideOnEvidence(input);
  const belowThreshold =
    evidence.autonomy === "auto_resolved" &&
    evidence.tier < autoApproveThreshold
      ? [
          `evidence tier ${String(evidence.tier)} below ${String(autoApproveThreshold)}`,
        ]
      : [];
  // An approval can't rest on evidence the model didn't get to read. A
  // rejection or a request doesn't depend on it: the evidence decides alone.
  const budget =
    input.searchBudgetSpent && input.decision === "approve"
      ? ["web search budget spent"]
      : [];
  const otherwiseResolves =
    evidence.autonomy === "auto_resolved" &&
    belowThreshold.length + budget.length === 0;
  // The floor holds back a resolution; on a review that escalates anyway, it
  // would only add noise to the reasons (#77).
  const floor =
    otherwiseResolves && modelConfidence < MODEL_CONFIDENCE_FLOOR
      ? [
          `model confidence ${String(modelConfidence)} below ${String(MODEL_CONFIDENCE_FLOOR)}`,
        ]
      : [];
  if (otherwiseResolves && floor.length === 0) {
    return {
      autonomy: "auto_resolved",
      reasons: evidence.reasons,
      confidence: evidence.tier,
    };
  }
  return escalated(
    [
      ...budget,
      ...(evidence.autonomy === "escalated" ? evidence.reasons : []),
      ...belowThreshold,
      ...floor,
    ],
    modelConfidence,
  );
}

/**
 * An escalated verdict: the model's number, capped so it never reads as
 * confident enough to have resolved. Also for a run that ended before the
 * policy could weigh it.
 */
export function escalated(
  reasons: string[],
  modelConfidence: number,
): AutonomyVerdict {
  return {
    autonomy: "escalated",
    reasons,
    confidence: Math.min(modelConfidence, ESCALATED_CONFIDENCE_CAP),
  };
}

function decideOnEvidence(input: AutonomyInput): EvidenceVerdict {
  const { decision } = input;
  // A mechanical request needs no evidence about who the organizer is: the
  // rule itself is the evidence (ADR 0015 amendment, #79). An approval or a
  // rejection would, and none backs a new organizer.
  if (input.subject.type === "organizer" && decision !== "request_info") {
    return {
      autonomy: "escalated",
      reasons: [
        "organizer approvals and rejections always escalate (ADR 0015)",
      ],
    };
  }
  const systemNegatives = input.systemFindings.filter((item) =>
    isNegative(item.finding),
  );
  const modelNegatives = input.modelFindings.filter(isNegative);

  if (decision === "approve" && input.subject.type === "event") {
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
      ...venueGaps(input.systemFindings, input.subject),
    ];
    return reasons.length === 0
      ? {
          autonomy: "auto_resolved",
          reasons: ["clean approval"],
          tier: approvalTier(input.systemFindings),
        }
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
          sourced(finding, input.retrievedUrls),
      ),
    ];
    return hardSignals.length > 0
      ? {
          autonomy: "auto_resolved",
          reasons: [`hard signals: ${checks(hardSignals)}`],
          tier: EVIDENCE_TIERS.ruleOrHardSignal,
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
  ];
  return reasons.length === 0
    ? {
        autonomy: "auto_resolved",
        reasons: [
          `mechanical request: ${checks(ruleNegatives.map((item) => item.finding))}`,
        ],
        tier: EVIDENCE_TIERS.ruleOrHardSignal,
      }
    : { autonomy: "escalated", reasons };
}

/**
 * A clean approval's tier: only reached once `venueGaps` found nothing, so
 * the capacity is either verified or unknown under the exposure cap.
 */
function approvalTier(systemFindings: readonly SystemFinding[]): number {
  const capacity = systemFindings.find(
    (item) => item.finding.check === "venue_capacity",
  )?.finding.verdict;
  return capacity === "pass"
    ? EVIDENCE_TIERS.verifiedCapacity
    : EVIDENCE_TIERS.underExposureCap;
}

/**
 * What an approval lacks in venue evidence. Negative venue findings are
 * already reasons as negatives; this adds the missing positives.
 */
function venueGaps(
  systemFindings: readonly SystemFinding[],
  { maxTicketsOnSale, moneyOnSaleCents }: EventSubject,
): string[] {
  const findingOf = (...names: string[]) =>
    systemFindings.find((item) => names.includes(item.finding.check));
  const venue = findingOf("venue_exists")?.finding.verdict;
  const capacityFinding = findingOf(
    "venue_capacity",
    "capacity_far_above_venue",
  );
  const capacity = capacityFinding?.finding.verdict;
  const cap = exposureCaps(capacityFinding?.venueType);
  const unknown = capacity === "unknown";
  return [
    ...(venue === "pass" || venue === "fail" || venue === "warn"
      ? []
      : [`venue not verified (${venue ?? "not checked"})`]),
    ...(capacity === undefined ? ["venue capacity not checked"] : []),
    ...(unknown && maxTicketsOnSale > cap.tickets
      ? [
          `capacity unknown with ${String(maxTicketsOnSale)} tickets on sale in one session, above the exposure cap of ${String(cap.tickets)}`,
        ]
      : []),
    // A free event puts no money on sale: the ticket cap alone judges it.
    ...(unknown && moneyOnSaleCents > cap.cents
      ? [
          `capacity unknown with ${euros(moneyOnSaleCents)} on sale, above the money cap of ${euros(cap.cents)}`,
        ]
      : []),
  ];
}

/** A model finding backed by a page a tool actually retrieved in this run. */
function sourced(
  finding: Finding,
  retrievedUrls: ReadonlySet<string>,
): boolean {
  return finding.sources.some((source) => retrievedUrls.has(source.url));
}

function checks(findings: readonly Finding[]): string {
  return [...new Set(findings.map((finding) => finding.check))].join(", ");
}

/**
 * An approval never contradicts the code (#33, ADR 0012): when a
 * deterministic or venue check flagged something, the model's `approve`
 * becomes a `request_info` that asks about each flag, and `decideAutonomy`
 * then weighs it like any request. Only system findings count: a model
 * finding is a claim.
 */
export function holdBackApproval(
  proposal: Proposal,
  systemFindings: readonly SystemFinding[],
): Proposal {
  if (proposal.decision !== "approve") return proposal;
  const flagged = systemFindings.map((item) => item.finding).filter(isNegative);
  if (flagged.length === 0) return proposal;

  const { questions: maxQuestions, questionChars } = REVIEW_TEXT_LIMITS;
  // Past the limit, the last question points to the findings, so none is
  // dropped silently.
  const asked =
    flagged.length <= maxQuestions
      ? flagged
      : flagged.slice(0, maxQuestions - 1);
  const questions = [
    ...asked.map((finding) =>
      clip(
        `Aclara este punto antes de publicar: ${finding.detail}`,
        questionChars,
      ),
    ),
    ...(asked.length < flagged.length
      ? [
          `Revisa también los otros ${String(flagged.length - asked.length)} puntos señalados en los hallazgos.`,
        ]
      : []),
  ];
  const why = flagged
    .map((finding) => `${finding.check}: ${finding.detail}`)
    .join(" · ");
  return {
    ...proposal,
    decision: "request_info",
    rationale: clip(
      `El análisis proponía aprobar, pero las comprobaciones automáticas señalaron algo que hay que aclarar antes (${why}). Propuesta original: ${proposal.rationale}`,
      REVIEW_TEXT_LIMITS.rationaleChars,
    ),
    infoRequest: {
      questions,
      draft: clip(
        `Hola. Antes de publicar el evento necesitamos que revises lo siguiente:\n${questions.map((question) => `- ${question}`).join("\n")}`,
        REVIEW_TEXT_LIMITS.draftChars,
      ),
    },
  };
}

/**
 * Cuts a text to a limit and marks the cut. Satella's limits count UTF-16
 * units, like `length`; a cut never splits a surrogate pair.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${whole}…`;
}
