/**
 * An in-process HTTP stand-in for Satella's agent API, built from the same
 * schemas as the client so the agent can progress before Satella ships
 * (brief §9 step 2). It implements only what the brief states (§13 over §3):
 * a behaviour the brief doesn't state is asked, not invented here.
 *
 * Error bodies are the mock's own (`{ code }`): the brief doesn't fix their
 * shape, so the client maps errors by status and never reads the body.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  capacityBandSchema,
  type CreateReviewRequest,
  createReviewRequestSchema,
  type EventReviewContext,
  eventReviewContextSchema,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  type FeedItem,
  feedItemSchema,
  type PriceBenchmark,
  type PriceBenchmarkQuery,
  priceBenchmarkSchema,
  type ReviewStatus,
  SIMILAR_DEFAULT_WINDOW_DAYS,
  SIMILAR_MAX_WINDOW_DAYS,
  type SimilarEvent,
  similarEventSchema,
} from "./schemas.js";

export type Scope = "agent:read" | "agent:recommend";

export interface MockSatellaFixtures {
  feed?: FeedItem[];
  events?: EventReviewContext[];
  /** Organizer `version`s, so reviews of organizers can be checked for staleness. */
  organizerVersions?: Record<string, string>;
  similar?: Record<string, SimilarEvent[]>;
  benchmarks?: { query: PriceBenchmarkQuery; benchmark: PriceBenchmark }[];
}

export interface MockSatellaOptions {
  fixtures: MockSatellaFixtures;
  /** Bearer token → scopes it grants. */
  tokens: Record<string, Scope[]>;
  /** Per credential and minute (§13: 60). */
  requestsPerMinute?: number;
  now?: () => Date;
}

export interface StoredReview {
  reviewId: string;
  idempotencyKey: string;
  request: CreateReviewRequest;
  status: ReviewStatus;
}

export interface RecordedRequest {
  method: string;
  path: string;
  correlationId: string | undefined;
  idempotencyKey: string | undefined;
}

export interface MockSatella {
  baseUrl: string;
  reviews: StoredReview[];
  requests: RecordedRequest[];
  /** Simulates the subject changing while the agent reviews it. */
  setEventVersion(eventId: string, version: string): void;
  close(): Promise<void>;
}

const EMPTY_BENCHMARK: PriceBenchmark = {
  sampleSize: 0,
  p10: null,
  p50: null,
  p90: null,
  max: null,
};

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
  const organizerVersions = new Map(
    Object.entries(options.fixtures.organizerVersions ?? {}),
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
  const reviews: StoredReview[] = [];
  const requests: RecordedRequest[] = [];

  function authorize(req: IncomingMessage, scope: Scope): string {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const scopes = token === undefined ? undefined : options.tokens[token];
    if (token === undefined || scopes === undefined) {
      throw new HttpError(401, "UNAUTHORIZED");
    }

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

    if (!scopes.includes(scope)) throw new HttpError(403, "FORBIDDEN");
    return token;
  }

  function subjectVersion(type: "event" | "organizer", id: string) {
    return type === "event"
      ? events.get(id)?.version
      : organizerVersions.get(id);
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
      (match = /^\/events\/([^/]+)\/review-context$/.exec(path))
    ) {
      authorize(req, "agent:read");
      const context = events.get(decodeURIComponent(match[1] ?? ""));
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
        throw new HttpError(400, "BAD_REQUEST");
      }
      if (!events.has(eventId)) throw new HttpError(404, "NOT_FOUND");
      // Filtering by window, province and trigram similarity is Satella's job:
      // the fixture already holds the answer.
      return { status: 200, body: (similar.get(eventId) ?? []).slice(0, 10) };
    }

    if (method === "GET" && path === "/benchmarks/prices") {
      authorize(req, "agent:read");
      return { status: 200, body: readBenchmark(url.searchParams) };
    }

    if (method === "POST" && path === "/reviews") {
      authorize(req, "agent:recommend");
      return createReview(req);
    }

    throw new HttpError(404, "NOT_FOUND");
  }

  function readFeed(params: URLSearchParams) {
    const limit = intParam(params.get("limit"), FEED_DEFAULT_LIMIT);
    if (limit < 1 || limit > FEED_MAX_LIMIT) {
      throw new HttpError(400, "BAD_REQUEST");
    }

    const cursor = params.get("cursor");
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
    const band = params.get("capacityBand");
    if (band !== null && !capacityBandSchema.safeParse(band).success) {
      throw new HttpError(400, "BAD_REQUEST");
    }
    const query = {
      genre: params.get("genre") ?? undefined,
      province: params.get("province") ?? undefined,
      capacityBand: band ?? undefined,
    };
    const found = benchmarks.find(
      (entry) =>
        entry.query.genre === query.genre &&
        entry.query.province === query.province &&
        entry.query.capacityBand === query.capacityBand,
    );
    return found?.benchmark ?? EMPTY_BENCHMARK;
  }

  async function createReview(req: IncomingMessage) {
    const idempotencyKey = header(req, "idempotency-key");
    if (idempotencyKey === undefined) throw new HttpError(400, "BAD_REQUEST");

    const parsed = createReviewRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "BAD_REQUEST");
    const request = parsed.data;

    // Brief §3.2: the same key, or the same (subject, subjectVersion,
    // promptVersion), returns the existing recommendation.
    const existing = reviews.find(
      (review) =>
        review.idempotencyKey === idempotencyKey ||
        (review.request.subject.type === request.subject.type &&
          review.request.subject.id === request.subject.id &&
          review.request.subjectVersion === request.subjectVersion &&
          review.request.agent.promptVersion === request.agent.promptVersion),
    );
    if (existing !== undefined) {
      return { status: 200, body: toResponse(existing) };
    }

    const current = subjectVersion(request.subject.type, request.subject.id);
    if (current === undefined) throw new HttpError(404, "NOT_FOUND");
    if (current !== request.subjectVersion) {
      throw new HttpError(409, "STALE_SUBJECT");
    }

    // §13: a new recommendation supersedes the subject's unresolved ones.
    // `auto_resolved` asks nothing of the admin, so it counts as resolved.
    for (const review of reviews) {
      if (
        review.request.subject.type === request.subject.type &&
        review.request.subject.id === request.subject.id &&
        review.status === "pending_admin"
      ) {
        review.status = "superseded";
      }
    }

    // §4.2 and §3.2: only an auto-resolved approval asks nothing of the admin;
    // every reject or request_info is pending for a person.
    const status: ReviewStatus =
      request.decision === "approve" && request.autonomy === "auto_resolved"
        ? "auto_resolved"
        : "pending_admin";
    const stored = { reviewId: randomUUID(), idempotencyKey, request, status };
    reviews.push(stored);
    return { status: 201, body: toResponse(stored) };
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
            { code: error.code },
            {
              ...baseHeaders,
              ...error.headers,
            },
          );
        } else {
          send(res, 500, { code: "INTERNAL" }, baseHeaders);
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
    setEventVersion(eventId, version) {
      const context = events.get(eventId);
      if (context === undefined) throw new Error(`No fixture for ${eventId}`);
      events.set(eventId, { ...context, version });
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

function intParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^-?\d+$/.test(value)) throw new HttpError(400, "BAD_REQUEST");
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
    throw new HttpError(400, "BAD_REQUEST");
  }
}

function toResponse(review: StoredReview) {
  return { reviewId: review.reviewId, status: review.status };
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
