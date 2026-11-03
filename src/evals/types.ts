import type { Autonomy } from "../agent/policy.js";
import type { RunEnd } from "../agent/loop.js";
import type {
  Decision,
  EventReviewContext,
  Finding,
  OrganizerReviewContext,
  PriceBenchmark,
  PriceBenchmarkQuery,
  SimilarEvent,
} from "../satella-client/schemas.js";

/** The mock answers a price benchmark only for its exact query. */
export interface BenchmarkFixture {
  query: PriceBenchmarkQuery;
  benchmark: PriceBenchmark;
}

/** What Satella serves for one case: built from the run's clock. */
export interface CaseFixtures {
  /** Present for event cases; its organizer comes in `organizer`. */
  event?: EventReviewContext;
  organizer: OrganizerReviewContext;
  similar?: SimilarEvent[];
  benchmarks?: BenchmarkFixture[];
}

/** One brief §5 case: a fixture subject with its expected outcome. */
export interface EvalCase {
  /** `01`…`26` for problem cases, `N1`…`N5` for legitimate ones. */
  id: string;
  /** Kebab-case, English: names the file and the recording. */
  slug: string;
  /** One line, English, for the report. Never reaches the agent. */
  title: string;
  subject: "event" | "organizer";
  /**
   * Cases that need external tools that don't exist yet (#7): they run and
   * record, but stay out of the gated metrics until those tools exist.
   */
  requires?: readonly "external"[];
  expected: {
    /** Any of these is correct: case 4 takes two, case 25 «never approve». */
    decisions: readonly Decision[];
    autonomy: Autonomy;
  };
  /** Fixtures are built from the clock, never from fixed dates. */
  build(clock: Date): CaseFixtures;
}

export interface CaseOutcome {
  decision: Decision;
  autonomy: Autonomy;
  confidence: number;
  /** The policy's reasons for the autonomy. */
  reasons: string[];
  /** The venue checks' verdicts, for the report (ADR 0015). */
  venue: { check: string; verdict: Finding["verdict"] }[];
  endedBy: RunEnd;
  inputTokens: number;
  outputTokens: number;
  /** Sum of the model calls' latency, from the recording. */
  latencyMs: number;
}

export interface CaseResult {
  caseId: string;
  slug: string;
  title: string;
  /** Brief §5 cases 1–26: the ones an approval would let fraud through. */
  problem: boolean;
  external: boolean;
  expected: EvalCase["expected"];
  /** Null when the case couldn't run: see `failure`. */
  outcome: CaseOutcome | null;
  /** e.g. `stale: request_changed`, `error: SATELLA_HTTP_ERROR`. */
  failure: string | null;
}

/** Brief §5 numbers problem cases `01`…`26` and legitimate ones `N1`…`N5`. */
export function isProblemCase(caseId: string): boolean {
  return !caseId.startsWith("N");
}

/** The brief's order: problem cases first, then the legitimate ones. */
export function caseOrder(caseId: string): number {
  return isProblemCase(caseId) ? Number(caseId) : 100 + Number(caseId.slice(1));
}
