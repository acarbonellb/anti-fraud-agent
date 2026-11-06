/**
 * The store in this process's memory, for local runs and tests (ADR 0016).
 * Nothing survives the process. It keeps the Firestore store's promises,
 * conflicts included, so code tested against it behaves the same deployed.
 */
import {
  type RunDocument,
  type RunResolution,
  validResolution,
  validRun,
} from "./run-document.js";
import { type PendingRetry, validRetryQueue } from "./retry-queue.js";
import {
  chargeExpired,
  type DayEntries,
  reserve,
  settle,
  totalOf,
} from "./spend.js";
import {
  checkPageLimit,
  decodeRunCursor,
  encodeRunCursor,
  newestFirst,
} from "./run-cursor.js";
import { type AgentStore, StoreError, utcDay } from "./types.js";

export function createMemoryStore(
  options: { now?: () => Date } = {},
): AgentStore {
  const now = options.now ?? (() => new Date());
  const runs = new Map<string, RunDocument>();
  const resolutions = new Map<string, RunResolution>();
  const spend = new Map<string, DayEntries>();
  let feedCursor: string | null = null;
  let retryQueue: PendingRetry[] = [];
  let retryQueueVersion: string | null = null;
  let retryQueueWrites = 0;

  return {
    saveRun(run) {
      return asPromise(() => {
        const parsed = validRun(run);
        if (runs.has(parsed.runId)) throw new StoreError("STORE_CONFLICT");
        runs.set(parsed.runId, structuredClone(parsed));
      });
    },

    getRun(runId) {
      const run = runs.get(runId);
      return Promise.resolve(run === undefined ? null : structuredClone(run));
    },

    listRuns({ limit, cursor }) {
      return asPromise(() => {
        checkPageLimit(limit);
        const after = cursor === undefined ? null : decodeRunCursor(cursor);
        const sorted = [...runs.values()].sort(newestFirst);
        const start =
          after === null
            ? 0
            : sorted.findIndex((run) => newestFirst(run, after) > 0);
        const rest = start === -1 ? [] : sorted.slice(start);
        const page = rest.slice(0, limit);
        const last = page.at(-1);
        return {
          runs: page.map((run) => structuredClone(run)),
          nextCursor:
            rest.length > limit && last !== undefined
              ? encodeRunCursor(last)
              : null,
        };
      });
    },

    saveResolution(resolution) {
      return asPromise(() => {
        const parsed = validResolution(resolution);
        resolutions.set(parsed.runId, structuredClone(parsed));
      });
    },

    getResolution(runId) {
      const resolution = resolutions.get(runId);
      return Promise.resolve(
        resolution === undefined ? null : structuredClone(resolution),
      );
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

    readRetryQueue() {
      return Promise.resolve({
        retries: structuredClone(retryQueue),
        version: retryQueueVersion,
      });
    },

    replaceRetryQueue(version, retries) {
      return asPromise(() => {
        const valid = validRetryQueue(retries);
        if (version !== retryQueueVersion) {
          throw new StoreError("STORE_CONFLICT");
        }
        retryQueue = structuredClone(valid);
        retryQueueWrites += 1;
        retryQueueVersion = String(retryQueueWrites);
      });
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
      const charged = chargeExpired(spend.get(day) ?? {}, at);
      if (charged !== null) spend.set(day, charged);
      return Promise.resolve(totalOf(day, spend.get(day) ?? {}, at));
    },
  };
}

/** A throw inside becomes a rejection, as an `async` store's would. */
function asPromise<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}
