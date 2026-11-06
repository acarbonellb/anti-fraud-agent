/**
 * The behaviour every `AgentStore` promises, as one suite each implementation
 * runs (ADR 0016): runs, completed or failed, saved and read back and listed
 * newest first across pages; an admin's resolution kept next to its run; the
 * feed cursor advanced only from the value read and the retry queue replaced
 * only from the version read; the day's spend reserved, settled, and charged
 * when a hold expires unsettled, against an injected clock.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type {
  CompletedRunDocument,
  FailedRunDocument,
} from "../store/run-document.js";
import {
  type AgentStore,
  SPEND_HOLD_TTL_MS,
  StoreError,
} from "../store/types.js";

export interface StoreUnderTest {
  store: AgentStore;
}

/** Builds a fresh, empty store that reads "now" from `now`. */
export type MakeStore = (now: () => Date) => StoreUnderTest;

export function failedRunDocument(
  runId: string,
  startedAt: string,
  overrides: Partial<FailedRunDocument> = {},
): FailedRunDocument {
  return {
    runId,
    outcome: "failed",
    trigger: "scheduled",
    startedAt,
    finishedAt: startedAt,
    latencyMs: 0,
    subject: { type: "organizer", id: "org_1" },
    provider: "anthropic",
    model: "claude-haiku-5-5",
    effort: "medium",
    promptVersion: "review-v7",
    error: { code: "LLM_UNAVAILABLE" },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
    costMicros: 0,
    ...overrides,
  };
}

export function runDocument(
  runId: string,
  startedAt: string,
  overrides: Partial<CompletedRunDocument> = {},
): CompletedRunDocument {
  return {
    runId,
    outcome: "completed",
    trigger: "scheduled",
    startedAt,
    finishedAt: startedAt,
    latencyMs: 0,
    subject: { type: "event", id: "evt_1", version: "v1" },
    provider: "anthropic",
    model: "claude-haiku-5-5",
    effort: "medium",
    promptVersion: "review-v7",
    decision: "approve",
    autonomy: "auto_resolved",
    autonomyReasons: ["clean approval"],
    confidence: 0.92,
    findings: [
      {
        check: "venue_exists",
        verdict: "pass",
        detail: "Recinto verificado.",
        confidence: 1,
        sources: [
          { url: "https://www.openstreetmap.org/node/1", title: "OSM" },
        ],
      },
    ],
    rationale: "Todo en orden.",
    infoRequest: null,
    endedBy: "submitted",
    usage: {
      inputTokens: 12_000,
      outputTokens: 800,
      cacheReadInputTokens: 9_000,
      cacheWriteInputTokens: 0,
    },
    costMicros: 1_590,
    toolCalls: 2,
    webSearches: 0,
    trace: [
      { tool: "get_event_context", ok: true },
      { tool: "web_search", ok: false, error: "BUDGET_SPENT" },
    ],
    review: { id: "rev_1", created: true, attempts: 1 },
    ...overrides,
  };
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
}

export function describeAgentStore(name: string, make: MakeStore): void {
  describe(`${name}: the AgentStore contract`, () => {
    let clock: Date;
    let store: AgentStore;

    beforeEach(() => {
      clock = new Date("2026-11-05T10:00:00.000Z");
      store = make(() => clock).store;
    });

    const advanceClock = (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    };

    describe("runs", () => {
      it("reads back the run it saved", async () => {
        const run = runDocument("run_1", "2026-11-05T09:00:00.000Z", {
          infoRequest: { questions: ["¿Aforo?"], draft: "Hola." },
          costMicros: null,
        });

        await store.saveRun(run);

        expect(await store.getRun("run_1")).toEqual(run);
      });

      it("has no run for an unknown id", async () => {
        expect(await store.getRun("run_missing")).toBeNull();
      });

      it("never overwrites a saved run", async () => {
        await store.saveRun(runDocument("run_1", "2026-11-05T09:00:00.000Z"));

        const code = await errorCodeOf(
          store.saveRun(
            runDocument("run_1", "2026-11-05T09:00:00.000Z", {
              decision: "reject",
            }),
          ),
        );

        expect(code).toBe("STORE_CONFLICT");
        expect(await store.getRun("run_1")).toMatchObject({
          decision: "approve",
        });
      });

      it("refuses a run it could not store, as a typed error", async () => {
        const invalid = [
          runDocument("..", "2026-11-05T09:00:00.000Z"),
          runDocument("__run__", "2026-11-05T09:00:00.000Z"),
          runDocument("run_1", "2026-11-05T09:00:00.000Z", { costMicros: 1.5 }),
        ];
        for (const run of invalid) {
          expect(await errorCodeOf(store.saveRun(run))).toBe(
            "STORE_INVALID_INPUT",
          );
        }
      });

      it("reads back a failed run with its error code", async () => {
        const run = failedRunDocument("run_failed", "2026-11-05T09:00:00.000Z");

        await store.saveRun(run);

        expect(await store.getRun("run_failed")).toEqual(run);
        const page = await store.listRuns({ limit: 5 });
        expect(page.runs.map((listed) => listed.runId)).toEqual(["run_failed"]);
      });

      it("refuses a page size that isn't a positive integer", async () => {
        for (const limit of [0, -1, 2.5]) {
          expect(await errorCodeOf(store.listRuns({ limit }))).toBe(
            "STORE_INVALID_INPUT",
          );
        }
      });

      it("lists runs newest first across pages", async () => {
        const starts = [
          ["run_a", "2026-11-05T08:00:00.000Z"],
          ["run_c", "2026-11-05T09:30:00.000Z"],
          ["run_b", "2026-11-05T09:00:00.000Z"],
          // Same instant as run_c: the order still is total and stable.
          ["run_d", "2026-11-05T09:30:00.000Z"],
          ["run_e", "2026-11-04T23:59:00.000Z"],
        ] as const;
        for (const [runId, startedAt] of starts) {
          await store.saveRun(runDocument(runId, startedAt));
        }

        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        for (;;) {
          const page = await store.listRuns({
            limit: 2,
            ...(cursor === undefined ? {} : { cursor }),
          });
          pages += 1;
          seen.push(...page.runs.map((run) => run.runId));
          if (page.nextCursor === null) break;
          cursor = page.nextCursor;
        }

        expect(seen).toEqual(["run_d", "run_c", "run_b", "run_a", "run_e"]);
        expect(pages).toBe(3);
      });

      it("ends on a full last page without an empty one after it", async () => {
        await store.saveRun(runDocument("run_a", "2026-11-05T08:00:00.000Z"));
        await store.saveRun(runDocument("run_b", "2026-11-05T09:00:00.000Z"));

        const page = await store.listRuns({ limit: 2 });

        expect(page.runs).toHaveLength(2);
        expect(page.nextCursor).toBeNull();
      });
    });

    describe("the admin's resolution", () => {
      const resolution = {
        runId: "run_1",
        reviewId: "rev_1",
        outcome: "accepted",
        resolvedAt: "2026-11-05T11:00:00.000Z",
      } as const;

      it("has none until one is recorded", async () => {
        expect(await store.getResolution("run_1")).toBeNull();
      });

      it("keeps it next to the run, which stays as saved", async () => {
        const run = runDocument("run_1", "2026-11-05T09:00:00.000Z");
        await store.saveRun(run);

        await store.saveResolution(resolution);
        // The feed can deliver the same resolution twice.
        await store.saveResolution(resolution);

        expect(await store.getResolution("run_1")).toEqual(resolution);
        expect(await store.getRun("run_1")).toEqual(run);
      });

      it("refuses a resolution it could not store, as a typed error", async () => {
        const code = await errorCodeOf(
          store.saveResolution({ ...resolution, runId: ".." }),
        );

        expect(code).toBe("STORE_INVALID_INPUT");
      });
    });

    describe("feed cursor", () => {
      it("starts at the feed's beginning", async () => {
        expect(await store.readFeedCursor()).toBeNull();
      });

      it("advances from the value read", async () => {
        await store.advanceFeedCursor(null, "cur_1");
        await store.advanceFeedCursor("cur_1", "cur_2");

        expect(await store.readFeedCursor()).toBe("cur_2");
      });

      it("refuses an advance from a stale value", async () => {
        // Two overlapping passes read the same cursor; only one may move it.
        const read = await store.readFeedCursor();
        await store.advanceFeedCursor(read, "cur_first");

        const code = await errorCodeOf(
          store.advanceFeedCursor(read, "cur_second"),
        );

        expect(code).toBe("STORE_CONFLICT");
        expect(await store.readFeedCursor()).toBe("cur_first");
      });
    });

    describe("retry queue", () => {
      const retry = {
        subject: { type: "event" as const, id: "evt_1" },
        failures: 1,
        code: "LLM_UNAVAILABLE",
      };
      const second = {
        subject: { type: "organizer" as const, id: "org_1" },
        failures: 2,
        code: "SATELLA_UNAVAILABLE",
      };

      it("starts empty", async () => {
        expect((await store.readRetryQueue()).retries).toEqual([]);
      });

      it("reads back the queue it was given, in order", async () => {
        const { version } = await store.readRetryQueue();
        await store.replaceRetryQueue(version, [retry, second]);

        expect((await store.readRetryQueue()).retries).toEqual([retry, second]);
      });

      it("replaces the whole queue, down to empty", async () => {
        await store.replaceRetryQueue((await store.readRetryQueue()).version, [
          retry,
        ]);
        await store.replaceRetryQueue(
          (await store.readRetryQueue()).version,
          [],
        );

        expect((await store.readRetryQueue()).retries).toEqual([]);
      });

      it("refuses a replace from a stale version", async () => {
        // Two overlapping passes read the same queue; only one may replace it.
        const { version } = await store.readRetryQueue();
        await store.replaceRetryQueue(version, [retry]);

        const code = await errorCodeOf(
          store.replaceRetryQueue(version, [second]),
        );

        expect(code).toBe("STORE_CONFLICT");
        expect((await store.readRetryQueue()).retries).toEqual([retry]);
      });

      it("refuses a stale version even when the queue reads the same", async () => {
        // The version, not the contents, tells a write since the read.
        const { version } = await store.readRetryQueue();
        await store.replaceRetryQueue(version, [retry]);
        await store.replaceRetryQueue(
          (await store.readRetryQueue()).version,
          [],
        );

        const code = await errorCodeOf(store.replaceRetryQueue(version, []));

        expect(code).toBe("STORE_CONFLICT");
      });

      it("refuses a queue it could not store, as a typed error", async () => {
        const { version } = await store.readRetryQueue();
        const code = await errorCodeOf(
          store.replaceRetryQueue(version, [{ ...retry, failures: 0 }]),
        );

        expect(code).toBe("STORE_INVALID_INPUT");
      });
    });

    describe("the day's spend", () => {
      const BUDGET = 10_000;

      it("reserves a hold that counts against the day", async () => {
        const reservation = await store.reserveSpend({
          runId: "run_1",
          micros: 4_000,
          budgetMicros: BUDGET,
        });

        expect(reservation).toEqual({
          ok: true,
          hold: {
            runId: "run_1",
            day: "2026-11-05",
            micros: 4_000,
            expiresAt: new Date(
              clock.getTime() + SPEND_HOLD_TTL_MS,
            ).toISOString(),
          },
        });
        expect(await store.daySpend()).toEqual({
          day: "2026-11-05",
          settledMicros: 0,
          heldMicros: 4_000,
        });
      });

      it("refuses a reservation past the budget", async () => {
        await store.reserveSpend({
          runId: "run_1",
          micros: 6_000,
          budgetMicros: BUDGET,
        });

        const refused = await store.reserveSpend({
          runId: "run_2",
          micros: 4_001,
          budgetMicros: BUDGET,
        });
        const fits = await store.reserveSpend({
          runId: "run_3",
          micros: 4_000,
          budgetMicros: BUDGET,
        });

        expect(refused).toEqual({
          ok: false,
          spend: { day: "2026-11-05", settledMicros: 0, heldMicros: 6_000 },
        });
        expect(fits.ok).toBe(true);
      });

      it("counts a retried reservation of the same run once", async () => {
        await store.reserveSpend({
          runId: "run_1",
          micros: 6_000,
          budgetMicros: BUDGET,
        });

        const retried = await store.reserveSpend({
          runId: "run_1",
          micros: 6_000,
          budgetMicros: BUDGET,
        });

        expect(retried.ok).toBe(true);
        expect((await store.daySpend()).heldMicros).toBe(6_000);
      });

      it("replaces the hold with the actual cost when settled", async () => {
        const reservation = await store.reserveSpend({
          runId: "run_1",
          micros: 8_000,
          budgetMicros: BUDGET,
        });
        if (!reservation.ok) throw new Error("reservation refused");

        await store.settleSpend(reservation.hold, 1_500);
        // A retried settle writes the same cost, not twice.
        await store.settleSpend(reservation.hold, 1_500);

        expect(await store.daySpend()).toEqual({
          day: "2026-11-05",
          settledMicros: 1_500,
          heldMicros: 0,
        });
        const next = await store.reserveSpend({
          runId: "run_2",
          micros: 8_500,
          budgetMicros: BUDGET,
        });
        expect(next.ok).toBe(true);
      });

      it("charges an expired, unsettled hold at its reserved amount, once", async () => {
        // A run killed mid-pass never settles: its hold must not just vanish.
        await store.reserveSpend({
          runId: "run_crashed",
          micros: 4_000,
          budgetMicros: BUDGET,
        });

        advanceClock(SPEND_HOLD_TTL_MS);

        expect(await store.daySpend()).toEqual({
          day: "2026-11-05",
          settledMicros: 4_000,
          heldMicros: 0,
        });
        // Read again and written over by other runs: still charged once.
        expect((await store.daySpend()).settledMicros).toBe(4_000);
        const fits = await store.reserveSpend({
          runId: "run_2",
          micros: 6_000,
          budgetMicros: BUDGET,
        });
        expect(fits.ok).toBe(true);
        advanceClock(SPEND_HOLD_TTL_MS);
        expect(await store.daySpend()).toEqual({
          day: "2026-11-05",
          settledMicros: 10_000,
          heldMicros: 0,
        });
        const refused = await store.reserveSpend({
          runId: "run_3",
          micros: 1,
          budgetMicros: BUDGET,
        });
        expect(refused.ok).toBe(false);
      });

      it("leaves an unexpired hold held", async () => {
        await store.reserveSpend({
          runId: "run_live",
          micros: 4_000,
          budgetMicros: BUDGET,
        });

        advanceClock(SPEND_HOLD_TTL_MS - 1);

        expect(await store.daySpend()).toEqual({
          day: "2026-11-05",
          settledMicros: 0,
          heldMicros: 4_000,
        });
      });

      it("still records the cost of a run settled after its hold expired", async () => {
        const reservation = await store.reserveSpend({
          runId: "run_slow",
          micros: 3_000,
          budgetMicros: BUDGET,
        });
        if (!reservation.ok) throw new Error("reservation refused");
        advanceClock(SPEND_HOLD_TTL_MS + 1);

        await store.settleSpend(reservation.hold, 2_000);

        expect(await store.daySpend()).toEqual({
          day: "2026-11-05",
          settledMicros: 2_000,
          heldMicros: 0,
        });
      });

      it("counts each UTC day apart", async () => {
        clock = new Date("2026-11-05T23:50:00.000Z");
        const reservation = await store.reserveSpend({
          runId: "run_late",
          micros: 5_000,
          budgetMicros: BUDGET,
        });
        if (!reservation.ok) throw new Error("reservation refused");

        // Settled after midnight: it still counts against the day it held.
        advanceClock(20 * 60_000);
        await store.settleSpend(reservation.hold, 5_000);

        expect(await store.daySpend()).toEqual({
          day: "2026-11-06",
          settledMicros: 0,
          heldMicros: 0,
        });
      });
    });
  });
}
