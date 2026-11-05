/**
 * The store in this process's memory, for local runs and tests (ADR 0016).
 * Nothing survives the process. It keeps the Firestore store's promises,
 * conflicts included, so code tested against it behaves the same deployed.
 */
import { type RunDocument, runDocumentSchema } from "./run-document.js";
import { type DayEntries, reserve, settle, totalOf } from "./spend.js";
import { decodeRunCursor, encodeRunCursor, newestFirst } from "./run-cursor.js";
import { type AgentStore, StoreError, utcDay } from "./types.js";

export function createMemoryStore(
  options: { now?: () => Date } = {},
): AgentStore {
  const now = options.now ?? (() => new Date());
  const runs = new Map<string, RunDocument>();
  const spend = new Map<string, DayEntries>();
  let feedCursor: string | null = null;

  return {
    saveRun(run) {
      const parsed = runDocumentSchema.parse(run);
      if (runs.has(parsed.runId)) {
        return Promise.reject(new StoreError("STORE_CONFLICT"));
      }
      runs.set(parsed.runId, structuredClone(parsed));
      return Promise.resolve();
    },

    getRun(runId) {
      const run = runs.get(runId);
      return Promise.resolve(run === undefined ? null : structuredClone(run));
    },

    listRuns({ limit, cursor }) {
      const after = cursor === undefined ? null : decodeRunCursor(cursor);
      const sorted = [...runs.values()].sort(newestFirst);
      const start =
        after === null
          ? 0
          : sorted.findIndex((run) => newestFirst(run, after) > 0);
      const rest = start === -1 ? [] : sorted.slice(start);
      const page = rest.slice(0, limit);
      const last = page.at(-1);
      return Promise.resolve({
        runs: page.map((run) => structuredClone(run)),
        nextCursor:
          rest.length > limit && last !== undefined
            ? encodeRunCursor(last)
            : null,
      });
    },

    readFeedCursor() {
      return Promise.resolve(feedCursor);
    },

    advanceFeedCursor(from, to) {
      if (feedCursor !== from) {
        return Promise.reject(new StoreError("STORE_CONFLICT"));
      }
      feedCursor = to;
      return Promise.resolve();
    },

    reserveSpend(input) {
      const at = now();
      const day = utcDay(at);
      const result = reserve(day, spend.get(day) ?? {}, input, at);
      if (result.entries !== null) spend.set(day, result.entries);
      return Promise.resolve(result.reservation);
    },

    settleSpend(hold, actualMicros) {
      spend.set(
        hold.day,
        settle(spend.get(hold.day) ?? {}, hold, actualMicros, now()),
      );
      return Promise.resolve();
    },

    daySpend() {
      const at = now();
      const day = utcDay(at);
      return Promise.resolve(totalOf(day, spend.get(day) ?? {}, at));
    },
  };
}
