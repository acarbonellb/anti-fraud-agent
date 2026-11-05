/**
 * A `fetch` that answers as Firestore's REST API and Cloud Run's metadata
 * server do, for the requests the Firestore store sends and no others: get,
 * create, patch with a precondition, and the one `runQuery` that lists runs.
 * It keeps documents in their wire encoding, so the store's own encoding is
 * what a test reads back. Anything else is a `400`, so a store that drifts
 * from the real API fails here first. Tests can also queue a failure.
 */
import type { Fetch } from "../venue/http.js";

export const FAKE_PROJECT = "demo-project";
export const FAKE_TOKEN = "fake-access-token";

const FIRESTORE = "https://firestore.googleapis.com";
const METADATA_TOKEN =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const ROOT = `projects/${FAKE_PROJECT}/databases/(default)/documents`;

type Fields = Record<string, unknown>;

interface StoredDocument {
  name: string;
  fields: Fields;
  createTime: string;
  updateTime: string;
}

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeFirestore {
  fetch: Fetch;
  requests: FakeRequest[];
  /** Documents by path below `documents/`, e.g. `runs/run_1`. */
  documents: Map<string, StoredDocument>;
  /** Answers the next Firestore request (not the token) with this instead. */
  failNext(answer: { status: number; body?: unknown } | "network"): void;
  /** Runs before the next patch is applied: another writer getting in first. */
  beforeNextPatch(action: () => void): void;
  tokenRequests(): number;
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const apiError = (code: number, status: string, message: string) =>
  json(code, { error: { code, message, status } });

export function createFakeFirestore(
  options: { tokenExpiresInSeconds?: number } = {},
): FakeFirestore {
  const documents = new Map<string, StoredDocument>();
  const requests: FakeRequest[] = [];
  const failures: ({ status: number; body?: unknown } | "network")[] = [];
  let patchHook: (() => void) | null = null;
  let tokens = 0;
  let tick = 0;

  // Real update times have microseconds; each write gets a later one.
  const nextTime = () => {
    tick += 1;
    return `2026-11-05T00:00:00.${String(tick).padStart(6, "0")}Z`;
  };

  const write = (path: string, fields: Fields): StoredDocument => {
    const time = nextTime();
    const previous = documents.get(path);
    const document = {
      name: `${ROOT}/${path}`,
      fields,
      createTime: previous?.createTime ?? time,
      updateTime: time,
    };
    documents.set(path, document);
    return document;
  };

  const fetch: Fetch = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const method = init.method ?? "GET";
    requests.push({ method, url, headers, body });

    if (url === METADATA_TOKEN) {
      if (headers["metadata-flavor"] !== "Google") {
        return json(403, { error: "missing Metadata-Flavor" });
      }
      tokens += 1;
      return json(200, {
        access_token: FAKE_TOKEN,
        expires_in: options.tokenExpiresInSeconds ?? 3599,
        token_type: "Bearer",
      });
    }

    const parsed = new URL(url);
    if (parsed.origin !== FIRESTORE) throw new TypeError("fetch failed");

    const failure = failures.shift();
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure !== undefined) return json(failure.status, failure.body ?? {});

    if (headers.authorization !== `Bearer ${FAKE_TOKEN}`) {
      return apiError(401, "UNAUTHENTICATED", "Missing or invalid token.");
    }

    const prefix = `/v1/${ROOT}`;
    const pathname = decodeURIComponent(parsed.pathname);
    if (!pathname.startsWith(prefix)) {
      return apiError(400, "INVALID_ARGUMENT", "Unknown database.");
    }
    const rest = pathname.slice(prefix.length);

    if (method === "POST" && rest === ":runQuery") return runQuery(body);

    const path = rest.replace(/^\//, "");
    const segments = path.split("/");

    if (method === "GET" && segments.length === 2) {
      const document = documents.get(path);
      return document === undefined
        ? apiError(404, "NOT_FOUND", `No document to get: ${path}`)
        : json(200, document);
    }

    if (method === "POST" && segments.length === 1) {
      const id = parsed.searchParams.get("documentId");
      if (id === null) return apiError(400, "INVALID_ARGUMENT", "No id.");
      const target = `${path}/${id}`;
      if (documents.has(target)) {
        return apiError(
          409,
          "ALREADY_EXISTS",
          `Document already exists: ${target}`,
        );
      }
      return json(200, write(target, fieldsOf(body)));
    }

    if (method === "PATCH" && segments.length === 2) {
      const exists = parsed.searchParams.get("currentDocument.exists");
      const updateTime = parsed.searchParams.get("currentDocument.updateTime");
      if (exists === null && updateTime === null) {
        return apiError(
          400,
          "INVALID_ARGUMENT",
          "The store always sends a precondition.",
        );
      }
      if (parsed.searchParams.has("updateMask.fieldPaths")) {
        return apiError(
          400,
          "INVALID_ARGUMENT",
          "The store replaces whole documents.",
        );
      }
      const hook = patchHook;
      patchHook = null;
      hook?.();
      const current = documents.get(path);
      if (exists === "false" && current !== undefined) {
        return apiError(
          409,
          "ALREADY_EXISTS",
          `Document already exists: ${path}`,
        );
      }
      if (updateTime !== null && current?.updateTime !== updateTime) {
        return apiError(
          400,
          "FAILED_PRECONDITION",
          "the stored version does not match the required base version.",
        );
      }
      return json(200, write(path, fieldsOf(body)));
    }

    return apiError(400, "INVALID_ARGUMENT", `Unsupported: ${method} ${rest}`);
  };

  /**
   * The query `listRuns` sends: runs by `startedAt` then name, both
   * descending, optionally after a position, limited.
   */
  function runQuery(body: unknown) {
    const query = (
      body as { structuredQuery?: Record<string, unknown> } | undefined
    )?.structuredQuery;
    const expectedOrder = JSON.stringify([
      { field: { fieldPath: "startedAt" }, direction: "DESCENDING" },
      { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
    ]);
    if (
      query === undefined ||
      JSON.stringify(query.from) !==
        JSON.stringify([{ collectionId: "runs" }]) ||
      JSON.stringify(query.orderBy) !== expectedOrder ||
      typeof query.limit !== "number"
    ) {
      return apiError(400, "INVALID_ARGUMENT", "Unsupported query.");
    }
    const startedAt = (document: StoredDocument) =>
      (document.fields.startedAt as { stringValue: string }).stringValue;
    const descending = (a: [string, string], b: [string, string]) =>
      a[0] !== b[0]
        ? a[0] > b[0]
          ? -1
          : 1
        : a[1] > b[1]
          ? -1
          : a[1] < b[1]
            ? 1
            : 0;

    const start = query.startAt as
      | {
          values: [{ stringValue: string }, { referenceValue: string }];
          before: boolean;
        }
      | undefined;
    if (start?.before === true) {
      return apiError(400, "INVALID_ARGUMENT", "The store pages after a run.");
    }
    const after: [string, string] | null =
      start === undefined
        ? null
        : [start.values[0].stringValue, start.values[1].referenceValue];

    const runs = [...documents.values()]
      .filter((document) => document.name.startsWith(`${ROOT}/runs/`))
      .map((document): [[string, string], StoredDocument] => [
        [startedAt(document), document.name],
        document,
      ])
      .sort(([a], [b]) => descending(a, b))
      .filter(([key]) => after === null || descending(key, after) > 0)
      .slice(0, query.limit)
      .map(([, document]) => ({ document, readTime: nextTime() }));
    return json(200, runs.length === 0 ? [{ readTime: nextTime() }] : runs);
  }

  return {
    fetch,
    requests,
    documents,
    failNext(answer) {
      failures.push(answer);
    },
    beforeNextPatch(action) {
      patchHook = action;
    },
    tokenRequests: () => tokens,
  };
}

function fieldsOf(body: unknown): Fields {
  const fields = (body as { fields?: unknown } | undefined)?.fields;
  return typeof fields === "object" && fields !== null
    ? (fields as Fields)
    : {};
}
