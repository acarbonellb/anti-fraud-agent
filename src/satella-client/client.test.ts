// Contract tests: the Satella client against the mock server built from the
// same schemas (brief §13 over §3.2). Covers each endpoint's happy path, the
// documented errors (400, 401, 403, 404, 409 STALE_SUBJECT, 429 Retry-After),
// 201 vs 200 on POST /reviews, and the headers the contract requires. Fakes
// Satella with the in-process mock; `fetch` is stubbed only to produce a
// response the mock can't (a contract violation, a network failure).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSatellaClient, type SatellaClient } from "./client.js";
import { SatellaApiError } from "./errors.js";
import { fixtures } from "./fixtures.js";
import {
  type MockSatella,
  type MockSatellaOptions,
  startMockSatella,
} from "./mock-server.js";
import type { CreateReviewRequest } from "./schemas.js";

const READ_AND_RECOMMEND = "token-read-recommend";
const READ_ONLY = "token-read-only";

let mock: MockSatella;
let client: SatellaClient;

async function setup(overrides: Partial<MockSatellaOptions> = {}) {
  await mock.close();
  mock = await startMockSatella({ ...defaultOptions(), ...overrides });
  client = clientFor(READ_AND_RECOMMEND);
}

function defaultOptions(): MockSatellaOptions {
  return {
    fixtures: {
      feed: fixtures.feed,
      events: [fixtures.eventContext],
      organizerVersions: { org_0001: "org-v1" },
      similar: { evt_0001: fixtures.similarEvents },
      benchmarks: [
        {
          query: {
            genre: "jazz",
            province: "Valladolid",
            capacityBand: "lt300",
          },
          benchmark: fixtures.priceBenchmark,
        },
      ],
    },
    tokens: {
      [READ_AND_RECOMMEND]: ["agent:read", "agent:recommend"],
      [READ_ONLY]: ["agent:read"],
    },
  };
}

function clientFor(token: string, fetch?: typeof globalThis.fetch) {
  return createSatellaClient({
    baseUrl: mock.baseUrl,
    getAccessToken: () => Promise.resolve(token),
    correlationId: "corr-123",
    ...(fetch === undefined ? {} : { fetch }),
  });
}

function reviewRequest(
  overrides: Partial<CreateReviewRequest> = {},
): CreateReviewRequest {
  return {
    subject: { type: "event", id: "evt_0001" },
    subjectVersion: fixtures.eventContext.version,
    decision: "approve",
    autonomy: "auto_resolved",
    confidence: 0.92,
    rationale: "Recinto verificado, aforo coherente y precio en la mediana.",
    findings: [
      {
        check: "venue_capacity",
        verdict: "pass",
        detail: "180 entradas para un aforo estimado de 200.",
        confidence: 0.9,
        sources: [{ url: "https://example.test/sala-lumbre", title: "Sala" }],
      },
    ],
    agent: {
      runId: "run-1",
      promptVersion: "p1",
      provider: "anthropic",
      model: "test-model",
    },
    ...overrides,
  };
}

async function expectSatellaError(
  promise: Promise<unknown>,
  code: SatellaApiError["code"],
): Promise<SatellaApiError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SatellaApiError);
  expect((error as SatellaApiError).code).toBe(code);
  return error as SatellaApiError;
}

beforeEach(async () => {
  mock = await startMockSatella(defaultOptions());
  client = clientFor(READ_AND_RECOMMEND);
});

afterEach(async () => {
  await mock.close();
});

describe("feed", () => {
  it("starts from the beginning without a cursor", async () => {
    const page = await client.getFeed();

    expect(page.items.map((item) => item.id)).toEqual([
      "fe_0001",
      "fe_0002",
      "fe_0003",
    ]);
    expect(page.items[2]?.changedFields).toEqual(["description", "terms"]);
  });

  it("pages forward with the cursor of the last item", async () => {
    const first = await client.getFeed({ limit: 2 });
    const second = await client.getFeed({
      cursor: first.nextCursor ?? "",
      limit: 2,
    });

    expect(first.items.map((item) => item.id)).toEqual(["fe_0001", "fe_0002"]);
    expect(second.items.map((item) => item.id)).toEqual(["fe_0003"]);
  });

  it("echoes the cursor when nothing is new", async () => {
    const all = await client.getFeed();
    const cursor = all.nextCursor ?? "";

    const empty = await client.getFeed({ cursor });

    expect(empty).toEqual({ items: [], nextCursor: cursor });
  });

  it("rejects an invalid cursor with 400", async () => {
    await expectSatellaError(
      client.getFeed({ cursor: "not-a-cursor" }),
      "SATELLA_BAD_REQUEST",
    );
  });

  it.each([0, 201])("rejects limit %i with 400", async (limit) => {
    await expectSatellaError(client.getFeed({ limit }), "SATELLA_BAD_REQUEST");
  });
});

describe("event review context", () => {
  it("returns the parsed context", async () => {
    const context = await client.getEventContext("evt_0001");

    expect(context.version).toBe(fixtures.eventContext.version);
    expect(context.sessions[0]?.ticketTypes[0]?.priceCents).toBe(1500);
  });

  it("maps an unknown event to SATELLA_NOT_FOUND", async () => {
    await expectSatellaError(
      client.getEventContext("evt_missing"),
      "SATELLA_NOT_FOUND",
    );
  });
});

describe("similar events", () => {
  it("returns other organizers' similar events", async () => {
    const similar = await client.findSimilarEvents("evt_0001", {
      windowDays: 30,
    });

    expect(similar).toEqual(fixtures.similarEvents);
  });

  it("rejects a window over 60 days with 400", async () => {
    await expectSatellaError(
      client.findSimilarEvents("evt_0001", { windowDays: 61 }),
      "SATELLA_BAD_REQUEST",
    );
  });
});

describe("price benchmark", () => {
  it("returns the benchmark for the query", async () => {
    const benchmark = await client.getPriceBenchmark({
      genre: "jazz",
      province: "Valladolid",
      capacityBand: "lt300",
    });

    expect(benchmark).toEqual(fixtures.priceBenchmark);
  });

  it("returns null percentiles for a thin sample", async () => {
    const benchmark = await client.getPriceBenchmark({ genre: "ópera" });

    expect(benchmark).toEqual({
      sampleSize: 0,
      p10: null,
      p50: null,
      p90: null,
      max: null,
    });
  });
});

describe("create review", () => {
  it("creates a recommendation with 201", async () => {
    const result = await client.createReview(reviewRequest(), {
      idempotencyKey: "key-1",
    });

    expect(result.created).toBe(true);
    expect(result.review.status).toBe("auto_resolved");
  });

  it("returns the existing recommendation with 200 on a retry", async () => {
    const first = await client.createReview(reviewRequest(), {
      idempotencyKey: "key-1",
    });
    const retry = await client.createReview(reviewRequest(), {
      idempotencyKey: "key-1",
    });

    expect(retry).toEqual({ review: first.review, created: false });
    expect(mock.reviews).toHaveLength(1);
  });

  it("deduplicates on subject, version and prompt version", async () => {
    const first = await client.createReview(reviewRequest(), {
      idempotencyKey: "key-1",
    });
    const again = await client.createReview(reviewRequest(), {
      idempotencyKey: "key-2",
    });

    expect(again.created).toBe(false);
    expect(again.review.reviewId).toBe(first.review.reviewId);
  });

  it("leaves a reject pending for the admin even when auto-resolved", async () => {
    const result = await client.createReview(
      reviewRequest({ decision: "reject" }),
      { idempotencyKey: "key-1" },
    );

    expect(result.review.status).toBe("pending_admin");
  });

  it("supersedes the subject's unresolved recommendations", async () => {
    await client.createReview(reviewRequest({ decision: "request_info" }), {
      idempotencyKey: "key-1",
    });
    await client.createReview(
      reviewRequest({
        agent: { ...reviewRequest().agent, promptVersion: "p2" },
      }),
      { idempotencyKey: "key-2" },
    );

    expect(mock.reviews.map((review) => review.status)).toEqual([
      "superseded",
      "auto_resolved",
    ]);
  });

  it("throws STALE_SUBJECT when the subject changed during the review", async () => {
    mock.setEventVersion("evt_0001", "v2-changed");

    await expectSatellaError(
      client.createReview(reviewRequest(), { idempotencyKey: "key-1" }),
      "STALE_SUBJECT",
    );
    expect(mock.reviews).toHaveLength(0);
  });

  it("reviews organizers against their version", async () => {
    const result = await client.createReview(
      reviewRequest({
        subject: { type: "organizer", id: "org_0001" },
        subjectVersion: "org-v1",
      }),
      { idempotencyKey: "key-1" },
    );

    expect(result.created).toBe(true);
  });

  it("maps an unknown subject to SATELLA_NOT_FOUND", async () => {
    await expectSatellaError(
      client.createReview(
        reviewRequest({ subject: { type: "event", id: "evt_missing" } }),
        { idempotencyKey: "key-1" },
      ),
      "SATELLA_NOT_FOUND",
    );
  });

  it("refuses locally a request over Satella's limits, before any call", async () => {
    await expect(
      client.createReview(reviewRequest({ rationale: "x".repeat(4001) }), {
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow();
    expect(mock.requests).toHaveLength(0);
  });
});

describe("authentication and limits", () => {
  it("sends the bearer token, correlation id and idempotency key", async () => {
    await client.createReview(reviewRequest(), { idempotencyKey: "key-1" });

    expect(mock.requests).toEqual([
      {
        method: "POST",
        path: "/api/agent/v1/reviews",
        correlationId: "corr-123",
        idempotencyKey: "key-1",
      },
    ]);
  });

  it("maps an unknown token to SATELLA_UNAUTHORIZED", async () => {
    await expectSatellaError(
      clientFor("wrong-token").getFeed(),
      "SATELLA_UNAUTHORIZED",
    );
  });

  it("maps a missing scope to SATELLA_FORBIDDEN", async () => {
    await expectSatellaError(
      clientFor(READ_ONLY).createReview(reviewRequest(), {
        idempotencyKey: "key-1",
      }),
      "SATELLA_FORBIDDEN",
    );
  });

  it("exposes Retry-After when rate limited", async () => {
    await setup({
      requestsPerMinute: 1,
      now: () => new Date("2026-10-31T10:00:15.000Z"),
    });
    await client.getFeed();

    const error = await expectSatellaError(
      client.getFeed(),
      "SATELLA_RATE_LIMITED",
    );

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(45);
  });
});

describe("responses outside the contract", () => {
  it("rejects a body that doesn't match the schema", async () => {
    const lying = clientFor(READ_AND_RECOMMEND, () =>
      Promise.resolve(Response.json({ items: "nope" })),
    );

    const error = await expectSatellaError(
      lying.getFeed(),
      "SATELLA_CONTRACT_VIOLATION",
    );
    expect(error.message).not.toContain("nope");
  });

  it("maps a network failure to SATELLA_UNAVAILABLE", async () => {
    const offline = clientFor(READ_AND_RECOMMEND, () =>
      Promise.reject(new TypeError("fetch failed")),
    );

    await expectSatellaError(offline.getFeed(), "SATELLA_UNAVAILABLE");
  });
});
