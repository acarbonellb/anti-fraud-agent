import type { Autonomy } from "../agent/policy.js";
import type { SearchResult } from "../search/types.js";
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
  /**
   * Authored web pages, for cases whose organizers, artists or texts are
   * invented: every search in the case runs against them, not the real web.
   */
  web?: SearchResult[];
}

/** One brief §5 case: a fixture subject with its expected outcome. */
export interface EvalCase {
  /**
   * Numbers for problem cases (brief §5's `01`…`26`, then spec #71's),
   * `N1`…`N5` for legitimate ones.
   */
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
  /**
   * For the gated fraud cases: whether the code alone keeps the case from
   * resolving as an approval, whatever the model proposes (`code`), or that
   * rests on the model's judgement (`model`). Checked against the fooled-model
   * run, so it can't drift (#82). Absent on the cases the gate doesn't hold.
   */
  decidedBy?: "code" | "model";
  /** Fixtures are built from the clock, never from fixed dates. */
  build(clock: Date): CaseFixtures;
}

export interface CaseOutcome {
  decision: Decision;
  autonomy: Autonomy;
  /** Derived from the evidence tier (ADR 0019): what Satella would be sent. */
  confidence: number;
  /** The number the model proposed, to compare with `confidence`. */
  modelConfidence: number;
  /** The policy's reasons for the autonomy. */
  reasons: string[];
  /** Whether the case searched authored pages, not the real web. */
  authoredWeb: boolean;
  /** The venue checks' verdicts, for the report (ADR 0015). */
  venue: { check: string; verdict: Finding["verdict"] }[];
  endedBy: RunEnd;
  inputTokens: number;
  outputTokens: number;
  /** Sum of the model calls' latency, from the recording. */
  latencyMs: number;
  /**
   * The model calls' cost in micro-dollars, from the recorded usage at the
   * listed prices (#30). Null for a model with no price.
   */
  costMicros: number | null;
}

export interface CaseResult {
  caseId: string;
  slug: string;
  title: string;
  /** The numbered cases: the ones an approval would let fraud through. */
  problem: boolean;
  external: boolean;
  expected: EvalCase["expected"];
  /** Null when the case couldn't run: see `failure`. */
  outcome: CaseOutcome | null;
  /** e.g. `stale: request_changed`, `error: SATELLA_HTTP_ERROR`. */
  failure: string | null;
}

/** Problem cases are numbered (`01`…`26`, then spec #71's); legitimate ones `N1`…`N5`. */
export function isProblemCase(caseId: string): boolean {
  return !caseId.startsWith("N");
}

/** The brief's order: problem cases first, then the legitimate ones. */
export function caseOrder(caseId: string): number {
  return isProblemCase(caseId) ? Number(caseId) : 100 + Number(caseId.slice(1));
}
