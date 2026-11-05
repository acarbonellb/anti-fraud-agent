/**
 * An in-process HTTP stand-in for Satella's agent API, built from the same
 * schemas as the client so the agent can be tested without Satella. It
 * mirrors the shipped v1 behaviour (see schemas.ts) and nothing more: what
 * filtering Satella does (similar events, benchmarks) is the fixture's answer.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  type AgentReview,
  capacityBandSchema,
  createReviewRequestSchema,
  type EventReviewContext,
  eventReviewContextSchema,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  type FeedItem,
  feedItemSchema,
  idempotencyKeySchema,
  type OrganizerReviewContext,
  organizerReviewContextSchema,
  type PriceBenchmark,
  type PriceBenchmarkQuery,
  priceBenchmarkSchema,
  type ReviewStatus,
  SIMILAR_DEFAULT_WINDOW_DAYS,
  SIMILAR_MAX_WINDOW_DAYS,
  type SimilarEvent,
  similarEventSchema,
  type SubjectType,
} from "./schemas.js";

export type Scope = "agent:read" | "agent:recommend";

export interface MockSatellaFixtures {
  feed?: FeedItem[];
  events?: EventReviewContext[];
  organizers?: OrganizerReviewContext[];
  similar?: Record<string, SimilarEvent[]>;
  benchmarks?: { query: PriceBenchmarkQuery; benchmark: PriceBenchmark }[];
}

export interface MockSatellaOptions {
  fixtures: MockSatellaFixtures;
  /** Bearer token → scopes it grants. */
  tokens: Record<string, Scope[]>;
  /** Per credential and minute (Satella: 60). */
  requestsPerMinute?: number;
  now?: () => Date;
}

export interface RecordedRequest {
  method: string;
  path: string;
  correlationId: string | undefined;
  idempotencyKey: string | undefined;
}

export interface MockSatella {
  baseUrl: string;
  reviews: AgentReview[];
  requests: RecordedRequest[];
  /** Simulates the subject changing while the agent reviews it. */
  setSubjectVersion(type: SubjectType, id: string, version: string): void;
  /** Simulates something happening in Satella after the mock started. */
  appendFeedItem(item: FeedItem): void;
  /** Simulates an admin resolving a recommendation in Satella's panel. */
  resolveReview(reviewId: string, outcome: "accepted" | "dismissed"): void;
  close(): Promise<void>;
}

const EMPTY_BENCHMARK: PriceBenchmark = {
  sampleSize: 0,
  p10Cents: null,
  p50Cents: null,
  p90Cents: null,
  maxCents: null,
};

/** Satella's API v1 error shape: `{ error: { code, message } }`. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }
}

export async function startMockSatella(
  options: MockSatellaOptions,
): Promise<MockSatella> {
  // A fixture that doesn't parse is a failing test, not a warning (write-tests §2).
  const feed = (options.fixtures.feed ?? []).map((item) =>
    feedItemSchema.parse(item),
  );
  const events = new Map(
    (options.fixtures.events ?? []).map((context) => {
      const parsed = eventReviewContextSchema.parse(context);
      return [parsed.event.id, parsed];
    }),
  );
  const organizers = new Map(
    (options.fixtures.organizers ?? []).map((context) => {
      const parsed = organizerReviewContextSchema.parse(context);
      return [parsed.organizer.id, parsed];
    }),
  );
  const similar = new Map(
    Object.entries(options.fixtures.similar ?? {}).map(([eventId, list]) => [
      eventId,
      list.map((item) => similarEventSchema.parse(item)),
    ]),
  );
  const benchmarks = (options.fixtures.benchmarks ?? []).map(
    ({ query, benchmark }) => ({
      query,
      benchmark: priceBenchmarkSchema.parse(benchmark),
    }),
  );

  const now = options.now ?? (() => new Date());
  const requestsPerMinute = options.requestsPerMinute ?? 60;
  const windows = new Map<string, { minute: number; count: number }>();
  const reviews: AgentReview[] = [];
  const idempotencyKeys = new Map<string, AgentReview>();
  const requests: RecordedRequest[] = [];

  // Satella checks the credential and its scope first, then the rate limit.
  function authorize(req: IncomingMessage, scope: Scope): void {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const scopes = token === undefined ? undefined : options.tokens[token];
    if (token === undefined || scopes === undefined) {
      throw new HttpError(401, "AUTH_REQUIRED", {
        "www-authenticate": "Bearer",
      });
    }
    if (!scopes.includes(scope)) throw new HttpError(403, "FORBIDDEN");

    const minute = Math.floor(now().getTime() / 60_000);
    const window = windows.get(token);
    const used = window?.minute === minute ? window.count : 0;
    if (used >= requestsPerMinute) {
      const retryAfter = 60 - (Math.floor(now().getTime() / 1000) % 60);
      throw new HttpError(429, "RATE_LIMITED", {
        "retry-after": String(retryAfter),
      });
    }
    windows.set(token, { minute, count: used + 1 });
  }

  function currentVersion(type: SubjectType, id: string) {
    return type === "event"
      ? events.get(id)?.version
      : organizers.get(id)?.version;
  }

  async function route(req: IncomingMessage, url: URL) {
    const path = url.pathname.replace(/^\/api\/agent\/v1/, "");
    const method = req.method ?? "GET";
    let match: RegExpExecArray | null;

    if (method === "GET" && path === "/feed") {
      authorize(req, "agent:read");
      return { status: 200, body: readFeed(url.searchParams) };
    }

    if (
      method === "GET" &&
      (match = /^\/(events|organizers)\/([^/]+)\/review-context$/.exec(path))
    ) {
      authorize(req, "agent:read");
      const id = decodeURIComponent(match[2] ?? "");
      const context =
        match[1] === "events" ? events.get(id) : organizers.get(id);
      if (context === undefined) throw new HttpError(404, "NOT_FOUND");
      return { status: 200, body: context };
    }

    if (
      method === "GET" &&
      (match = /^\/events\/([^/]+)\/similar$/.exec(path))
    ) {
      authorize(req, "agent:read");
      const eventId = decodeURIComponent(match[1] ?? "");
      const windowDays = intParam(
        url.searchParams.get("windowDays"),
        SIMILAR_DEFAULT_WINDOW_DAYS,
      );
      if (windowDays < 1 || windowDays > SIMILAR_MAX_WINDOW_DAYS) {
        throw new HttpError(400, "VALIDATION");
      }
      if (!events.has(eventId)) throw new HttpError(404, "NOT_FOUND");
      return {
        status: 200,
        body: { items: (similar.get(eventId) ?? []).slice(0, 10) },
      };
    }

    if (method === "GET" && path === "/benchmarks/prices") {
      authorize(req, "agent:read");
      return { status: 200, body: readBenchmark(url.searchParams) };
    }

    if (method === "POST" && path === "/reviews") {
      authorize(req, "agent:recommend");
      return createReview(req);
    }

    if (method === "GET" && (match = /^\/reviews\/([^/]+)$/.exec(path))) {
      authorize(req, "agent:read");
      const id = decodeURIComponent(match[1] ?? "");
      const review = reviews.find((candidate) => candidate.id === id);
      if (review === undefined) throw new HttpError(404, "NOT_FOUND");
      return { status: 200, body: review };
    }

    throw new HttpError(404, "NOT_FOUND");
  }

  function readFeed(params: URLSearchParams) {
    const limit = intParam(params.get("limit"), FEED_DEFAULT_LIMIT);
    if (limit < 1 || limit > FEED_MAX_LIMIT) {
      throw new HttpError(400, "VALIDATION");
    }

    const cursor = blankToUndefined(params.get("cursor")) ?? null;
    let start = 0;
    if (cursor !== null) {
      const index = feed.findIndex((item) => encodeCursor(item) === cursor);
      if (index === -1) throw new HttpError(400, "INVALID_CURSOR");
      start = index + 1;
    }

    const items = feed.slice(start, start + limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: last === undefined ? cursor : encodeCursor(last),
    };
  }

  function readBenchmark(params: URLSearchParams): PriceBenchmark {
    const band = blankToUndefined(params.get("capacityBand"));
    if (band !== undefined && !capacityBandSchema.safeParse(band).success) {
      throw new HttpError(400, "VALIDATION");
    }
    // An empty filter (`?genre=`) is the same as none.
    const genre = blankToUndefined(params.get("genre"));
    const province = blankToUndefined(params.get("province"));
    const found = benchmarks.find(
      (entry) =>
        entry.query.genre === genre &&
        entry.query.province === province &&
        entry.query.capacityBand === band,
    );
    return found?.benchmark ?? EMPTY_BENCHMARK;
  }

  async function createReview(req: IncomingMessage) {
    const idempotencyKey = idempotencyKeySchema.safeParse(
      header(req, "idempotency-key") ?? "",
    );
    if (!idempotencyKey.success) {
      throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
    }

    const parsed = createReviewRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "VALIDATION");
    const { subject, ...request } = parsed.data;

    // The same key, or the same subject, version and prompt version, returns
    // the existing recommendation before the version is checked.
    const existing =
      idempotencyKeys.get(idempotencyKey.data) ??
      reviews.find(
        (review) =>
          review.subject.type === subject.type &&
          review.subject.id === subject.id &&
          review.subject.version === subject.version &&
          review.promptVersion === request.promptVersion,
      );
    if (existing !== undefined) return { status: 200, body: existing };

    const current = currentVersion(subject.type, subject.id);
    if (current === undefined) throw new HttpError(404, "NOT_FOUND");
    if (current !== subject.version) throw new HttpError(409, "STALE_SUBJECT");

    // The subject's open recommendations (pending or auto-resolved) are
    // superseded; those an admin resolved stay as they are.
    for (const review of reviews) {
      if (
        review.subject.type === subject.type &&
        review.subject.id === subject.id &&
        (review.status === "pending_admin" || review.status === "auto_resolved")
      ) {
        review.status = "superseded";
      }
    }

    // Only an auto-resolved approval asks nothing of the admin.
    const status: ReviewStatus =
      request.decision === "approve" && request.autonomy === "auto_resolved"
        ? "auto_resolved"
        : "pending_admin";
    const review: AgentReview = {
      ...request,
      id: randomUUID(),
      subject,
      infoRequest: request.infoRequest ?? null,
      status,
      createdAt: now().toISOString(),
      resolution: null,
    };
    reviews.push(review);
    idempotencyKeys.set(idempotencyKey.data, review);
    return { status: 201, body: review };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock.invalid");
    const correlationId = header(req, "x-correlation-id");
    requests.push({
      method: req.method ?? "GET",
      path: url.pathname,
      correlationId,
      idempotencyKey: header(req, "idempotency-key"),
    });
    const baseHeaders: Record<string, string> =
      correlationId === undefined ? {} : { "x-correlation-id": correlationId };

    route(req, url).then(
      ({ status, body }) => {
        send(res, status, body, baseHeaders);
      },
      (error: unknown) => {
        if (error instanceof HttpError) {
          send(
            res,
            error.status,
            { error: { code: error.code, message: "Mock error." } },
            { ...baseHeaders, ...error.headers },
          );
        } else {
          send(
            res,
            500,
            { error: { code: "INTERNAL", message: "Mock error." } },
            baseHeaders,
          );
        }
      },
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    reviews,
    requests,
    setSubjectVersion(type, id, version) {
      if (type === "event") {
        const context = events.get(id);
        if (context === undefined) throw new Error(`No fixture for ${id}`);
        events.set(id, { ...context, version });
      } else {
        const context = organizers.get(id);
        if (context === undefined) throw new Error(`No fixture for ${id}`);
        organizers.set(id, { ...context, version });
      }
    },
    appendFeedItem(item) {
      feed.push(feedItemSchema.parse(item));
    },
    resolveReview(reviewId, outcome) {
      const review = reviews.find((candidate) => candidate.id === reviewId);
      if (review === undefined) throw new Error(`No review ${reviewId}`);
      review.status = outcome;
      review.resolution = { outcome, resolvedAt: now().toISOString() };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/** Opaque to the client; here, a hash of the item's stable id. */
function encodeCursor(item: FeedItem): string {
  return createHash("sha256").update(item.id).digest("base64url");
}

/** Satella treats an empty query value (`?genre=`) as not passed. */
function blankToUndefined(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function intParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^-?\d+$/.test(value)) throw new HttpError(400, "VALIDATION");
  return Number(value);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "VALIDATION");
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>,
) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
