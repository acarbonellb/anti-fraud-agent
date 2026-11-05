/**
 * The store on Firestore, over its REST API with `fetch` (ADR 0016 point 2):
 * no SDK and no gRPC, tested like the venue providers with a fake `fetch`.
 * In Cloud Run the token comes from the metadata server; against the
 * emulator no token is sent. Application default credentials are never read.
 *
 * Every update carries a precondition: `exists=false` for a document it
 * found missing, or the `updateTime` it read. That is the compare-and-set
 * behind the feed cursor and the day's spend, with no transaction API.
 *
 * Documents: `runs/{runId}`, `resolutions/{runId}`, `agentState/feedCursor`,
 * `agentState/retryQueue`, `spend/{YYYY-MM-DD}`.
 */
import { z } from "zod";

import { DomainError } from "../errors.js";
import type { Fetch } from "../fetch.js";
import {
  decodeFields,
  encodeFields,
  encodeValue,
  type FirestoreFields,
} from "./firestore-values.js";
import {
  checkPageLimit,
  decodeRunCursor,
  encodeRunCursor,
} from "./run-cursor.js";
import {
  type RunDocument,
  runDocumentSchema,
  runResolutionSchema,
  validResolution,
  validRun,
} from "./run-document.js";
import { retryQueueSchema, validRetryQueue } from "./retry-queue.js";
import { type DayEntries, reserve, settle, totalOf } from "./spend.js";
import {
  type AgentStore,
  type DaySpend,
  StoreError,
  type StoreErrorCode,
  utcDay,
} from "./types.js";

export interface FirestoreStoreOptions {
  /** The GCP project that holds the `(default)` database. */
  projectId: string;
  /** `host:port` of the Firestore emulator (`FIRESTORE_EMULATOR_HOST`). */
  emulatorHost?: string;
  fetch?: Fetch;
  now?: () => Date;
}

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
/** A token is renewed this long before it expires, so none dies in flight. */
const TOKEN_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Reservations and settlements that lose a race re-read and try again. */
const MAX_SPEND_ATTEMPTS = 3;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const documentSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  updateTime: z.string(),
});
type FirestoreDocument = z.infer<typeof documentSchema>;

const queryResponseSchema = z.array(
  z.object({ document: documentSchema.optional() }),
);

const feedCursorSchema = z.object({ cursor: z.string().min(1) });
const retryQueueDocumentSchema = z.object({ retries: retryQueueSchema });
const spendSchema = z.object({
  entries: z.record(
    z.string(),
    z.object({
      micros: z.number().int().nonnegative(),
      expiresAt: z.string().nullable(),
    }),
  ),
});

/** Fixed: the free tier is the `(default)` database (ADR 0016 point 1). */
const DATABASE = "(default)";

export function createFirestoreStore(
  options: FirestoreStoreOptions,
): AgentStore {
  const doFetch: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const root = `projects/${options.projectId}/databases/${DATABASE}/documents`;
  const base =
    options.emulatorHost === undefined
      ? `https://firestore.googleapis.com/v1/${root}`
      : `http://${options.emulatorHost}/v1/${root}`;
  let token: { value: string; expiresAt: number } | null = null;

  async function authorization(): Promise<Record<string, string>> {
    if (options.emulatorHost !== undefined) return {};
    if (
      token === null ||
      now().getTime() >= token.expiresAt - TOKEN_MARGIN_MS
    ) {
      const body = await send(METADATA_TOKEN_URL, {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
      });
      const parsed = tokenSchema.safeParse(body);
      if (!parsed.success) throw new StoreError("STORE_BAD_RESPONSE");
      token = {
        value: parsed.data.access_token,
        expiresAt: now().getTime() + parsed.data.expires_in * 1000,
      };
    }
    return { Authorization: `Bearer ${token.value}` };
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    return send(`${base}${path}`, {
      method,
      headers: {
        ...(await authorization()),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function getDocument(path: string): Promise<FirestoreDocument | null> {
    try {
      return parse(documentSchema, await request("GET", `/${path}`));
    } catch (error) {
      if (error instanceof StoreError && error.status === 404) return null;
      throw error;
    }
  }

  /** Replaces the whole document, only if it is still as read. */
  async function putDocument(
    path: string,
    read: FirestoreDocument | null,
    fields: FirestoreFields,
  ): Promise<void> {
    const precondition =
      read === null
        ? "currentDocument.exists=false"
        : `currentDocument.updateTime=${encodeURIComponent(read.updateTime)}`;
    await request("PATCH", `/${path}?${precondition}`, { fields });
  }

  async function readSpend(day: string) {
    const document = await getDocument(`spend/${day}`);
    const entries: DayEntries =
      document === null ? {} : parse(spendSchema, decoded(document)).entries;
    return { document, entries };
  }

  /** Read, change, write with the precondition; on a lost race, again. */
  async function updateSpend<T>(
    day: string,
    change: (entries: DayEntries) => { result: T; entries: DayEntries | null },
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const { document, entries } = await readSpend(day);
      const { result, entries: next } = change(entries);
      if (next === null) return result;
      try {
        await putDocument(
          `spend/${day}`,
          document,
          encodeFields({ entries: next }),
        );
        return result;
      } catch (error) {
        const lostRace =
          error instanceof StoreError && error.code === "STORE_CONFLICT";
        if (!lostRace || attempt >= MAX_SPEND_ATTEMPTS) throw error;
      }
    }
  }

  return {
    async saveRun(run) {
      const parsed = validRun(run);
      // Create only: Firestore answers `409 ALREADY_EXISTS` for a saved id.
      await request(
        "POST",
        `/runs?documentId=${encodeURIComponent(parsed.runId)}`,
        { fields: encodeFields(parsed) },
      );
    },

    async getRun(runId) {
      const document = await getDocument(`runs/${encodeURIComponent(runId)}`);
      return document === null ? null : toRun(document);
    },

    async listRuns({ limit, cursor }) {
      checkPageLimit(limit);
      const after = cursor === undefined ? null : decodeRunCursor(cursor);
      // One more than asked tells whether another page follows.
      const response = await request("POST", ":runQuery", {
        structuredQuery: {
          from: [{ collectionId: "runs" }],
          orderBy: [
            { field: { fieldPath: "startedAt" }, direction: "DESCENDING" },
            { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
          ],
          ...(after === null
            ? {}
            : {
                startAt: {
                  values: [
                    encodeValue(after.startedAt),
                    { referenceValue: `${root}/runs/${after.runId}` },
                  ],
                  before: false,
                },
              }),
          limit: limit + 1,
        },
      });
      const runs = parse(queryResponseSchema, response).flatMap((row) =>
        row.document === undefined ? [] : [toRun(row.document)],
      );
      const page = runs.slice(0, limit);
      const last = page.at(-1);
      return {
        runs: page,
        nextCursor:
          runs.length > limit && last !== undefined
            ? encodeRunCursor(last)
            : null,
      };
    },

    async saveResolution(resolution) {
      const parsed = validResolution(resolution);
      const path = `resolutions/${encodeURIComponent(parsed.runId)}`;
      // Replacing is allowed, but still against the version read.
      await putDocument(path, await getDocument(path), encodeFields(parsed));
    },

    async getResolution(runId) {
      const document = await getDocument(
        `resolutions/${encodeURIComponent(runId)}`,
      );
      return document === null
        ? null
        : parse(runResolutionSchema, decoded(document));
    },

    async readFeedCursor() {
      const document = await getDocument("agentState/feedCursor");
      return document === null ? null : feedCursorOf(document);
    },

    async advanceFeedCursor(from, to) {
      const document = await getDocument("agentState/feedCursor");
      const current = document === null ? null : feedCursorOf(document);
      if (current !== from) throw new StoreError("STORE_CONFLICT");
      // The precondition catches a pass that wrote after this read.
      await putDocument(
        "agentState/feedCursor",
        document,
        encodeFields({ cursor: to }),
      );
    },

    async readRetryQueue() {
      const document = await getDocument("agentState/retryQueue");
      return document === null
        ? []
        : parse(retryQueueDocumentSchema, decoded(document)).retries;
    },

    async replaceRetryQueue(retries) {
      const valid = validRetryQueue(retries);
      // Firestore takes no unconditional write here (every update carries a
      // precondition). Overlapping passes don't happen: ADR 0018's timeout.
      const document = await getDocument("agentState/retryQueue");
      await putDocument(
        "agentState/retryQueue",
        document,
        encodeFields({ retries: valid }),
      );
    },

    reserveSpend(input) {
      const at = now();
      const day = utcDay(at);
      return updateSpend(day, (entries) => {
        const { reservation, entries: next } = reserve(day, entries, input, at);
        return { result: reservation, entries: next };
      });
    },

    async settleSpend(hold, actualMicros) {
      await updateSpend(hold.day, (entries) => ({
        result: undefined,
        entries: settle(entries, hold, actualMicros, now()),
      }));
    },

    async daySpend(): Promise<DaySpend> {
      const at = now();
      const day = utcDay(at);
      const { entries } = await readSpend(day);
      return totalOf(day, entries, at);
    },
  };

  async function send(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A typed error from below (a recorder, a replay) must surface as is.
      if (error instanceof DomainError) throw error;
      throw new StoreError("STORE_UNAVAILABLE", null, { cause: error });
    }
    if (!response.ok) {
      throw new StoreError(await failureCode(response), response.status);
    }
    try {
      const body: unknown = await response.json();
      return body;
    } catch {
      throw new StoreError("STORE_BAD_RESPONSE", response.status);
    }
  }
}

/**
 * The response body is read for its status word only and never kept: it can
 * quote the document (CLAUDE.md §4).
 */
async function failureCode(response: Response): Promise<StoreErrorCode> {
  const { status } = response;
  if (status === 401 || status === 403) return "STORE_FORBIDDEN";
  if (status === 409 || status === 412) return "STORE_CONFLICT";
  if (status === 429 || status === 503) return "STORE_UNAVAILABLE";
  // A stale `updateTime` precondition comes back as `400 FAILED_PRECONDITION`
  // (Google's HTTP mapping of the gRPC code), not as a 409.
  if (status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const word = z
      .object({ error: z.object({ status: z.string() }) })
      .safeParse(body);
    if (word.success && word.data.error.status === "FAILED_PRECONDITION") {
      return "STORE_CONFLICT";
    }
  }
  return "STORE_HTTP_ERROR";
}

/** Zod errors can quote the value, so none travels as the cause. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StoreError("STORE_BAD_RESPONSE");
  return parsed.data;
}

function decoded(document: FirestoreDocument): Record<string, unknown> {
  try {
    return decodeFields(document.fields ?? {});
  } catch {
    throw new StoreError("STORE_BAD_RESPONSE");
  }
}

function toRun(document: FirestoreDocument): RunDocument {
  return parse(runDocumentSchema, decoded(document));
}

function feedCursorOf(document: FirestoreDocument): string {
  return parse(feedCursorSchema, decoded(document)).cursor;
}
