/**
 * The agent's own store (ADR 0016): what Satella doesn't keep. Each run, the
 * feed cursor and the day's spend (brief §2, «Reparto de responsabilidades»).
 * Two implementations behind one interface: in memory for local runs and
 * tests, Firestore in Cloud Run; one contract suite runs against both.
 */
import { DomainError } from "../errors.js";
import type { RunDocument } from "./run-document.js";

export interface RunPage {
  /** Newest first. */
  runs: RunDocument[];
  /** Opaque; null on the last page. */
  nextCursor: string | null;
}

export interface SpendHold {
  runId: string;
  /** The UTC day the hold counts against: `YYYY-MM-DD`. */
  day: string;
  micros: number;
  /** UTC ISO; past it the hold no longer counts. */
  expiresAt: string;
}

export type Reservation =
  | { ok: true; hold: SpendHold }
  | {
      ok: false;
      /** What the day had already taken when the reservation was refused. */
      spend: DaySpend;
    };

export interface DaySpend {
  day: string;
  /** What finished runs cost. */
  settledMicros: number;
  /** What open, unexpired holds keep back. */
  heldMicros: number;
}

export interface ReserveSpendInput {
  runId: string;
  /** The run's worst-case cost. */
  micros: number;
  /** The day's budget (`AGENT_DAILY_BUDGET_MICROS`). */
  budgetMicros: number;
}

export interface AgentStore {
  /** Runs are appended, never edited: saving a `runId` twice is a conflict. */
  saveRun(run: RunDocument): Promise<void>;
  getRun(runId: string): Promise<RunDocument | null>;
  listRuns(page: { limit: number; cursor?: string }): Promise<RunPage>;

  /** Null until a pass first advances it: the feed's beginning. */
  readFeedCursor(): Promise<string | null>;
  /**
   * Compare-and-set: moves the cursor to `to` only if it still holds `from`,
   * so two overlapping passes can't both advance it. A stale `from` throws a
   * `STORE_CONFLICT`.
   */
  advanceFeedCursor(from: string | null, to: string): Promise<void>;

  /**
   * Reserves a run's worst-case cost against the current UTC day. Refused
   * when the day's settled cost plus its open holds plus this one would
   * pass the budget.
   */
  reserveSpend(input: ReserveSpendInput): Promise<Reservation>;
  /**
   * Replaces the hold with the run's actual cost. Settling twice writes the
   * same cost; settling an expired hold still records what was spent.
   */
  settleSpend(hold: SpendHold, actualMicros: number): Promise<void>;
  /** The current UTC day's spend. */
  daySpend(): Promise<DaySpend>;
}

/** How long a hold counts: a crashed run can't keep budget forever. */
export const SPEND_HOLD_TTL_MS = 15 * 60_000;

export type StoreErrorCode =
  | "STORE_CONFLICT"
  | "STORE_BAD_CURSOR"
  | "STORE_FORBIDDEN"
  | "STORE_UNAVAILABLE"
  | "STORE_HTTP_ERROR"
  | "STORE_BAD_RESPONSE";

/** A failed store call. Never carries a request or response body. */
export class StoreError extends DomainError {
  constructor(
    readonly code: StoreErrorCode,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(
      `store call failed: ${code}` +
        (status === null ? "" : ` (${String(status)})`),
      options,
    );
  }
}

/** The UTC day of an instant, `YYYY-MM-DD` (CLAUDE.md §5). */
export function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
