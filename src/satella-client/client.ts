import type { z } from "zod";

import { SatellaApiError } from "./errors.js";
import {
  type CreateReviewRequest,
  type CreateReviewResponse,
  createReviewRequestSchema,
  createReviewResponseSchema,
  type EventReviewContext,
  eventReviewContextSchema,
  type FeedPage,
  feedPageSchema,
  type PriceBenchmark,
  type PriceBenchmarkQuery,
  priceBenchmarkSchema,
  type SimilarEvent,
  similarEventsSchema,
} from "./schemas.js";

export interface SatellaClientOptions {
  /** Origin of Satella; the client appends `/api/agent/v1`. */
  baseUrl: string;
  /** A Google identity token in GCP, a bearer token locally (brief §13). */
  getAccessToken: () => Promise<string>;
  /** Sent as `X-Correlation-Id` so Satella's logs join the agent's run. */
  correlationId: string;
  fetch?: typeof globalThis.fetch;
}

export interface CreateReviewResult {
  review: CreateReviewResponse;
  /** `false` when Satella returned an existing recommendation (200, not 201). */
  created: boolean;
}

export interface SatellaClient {
  getFeed(options?: { cursor?: string; limit?: number }): Promise<FeedPage>;
  getEventContext(eventId: string): Promise<EventReviewContext>;
  findSimilarEvents(
    eventId: string,
    options?: { windowDays?: number },
  ): Promise<SimilarEvent[]>;
  getPriceBenchmark(query: PriceBenchmarkQuery): Promise<PriceBenchmark>;
  /**
   * Idempotent: reusing `idempotencyKey` returns the existing review. Throws
   * `STALE_SUBJECT` when the subject changed since its context was read.
   */
  createReview(
    request: CreateReviewRequest,
    options: { idempotencyKey: string },
  ): Promise<CreateReviewResult>;
}

const API_PREFIX = "/api/agent/v1";

export function createSatellaClient(
  options: SatellaClientOptions,
): SatellaClient {
  const doFetch = options.fetch ?? globalThis.fetch;

  async function call<T>(
    name: string,
    path: string,
    schema: z.ZodType<T>,
    init: {
      method?: "GET" | "POST";
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ data: T; status: number }> {
    const url = new URL(API_PREFIX + path, options.baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${await options.getAccessToken()}`,
      "x-correlation-id": options.correlationId,
      accept: "application/json",
      ...init.headers,
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method: init.method ?? "GET",
        headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      // Network failure: no status, and nothing from Satella to keep.
      throw new SatellaApiError("SATELLA_UNAVAILABLE", name, null);
    }

    if (!response.ok) {
      // Drain the body without reading it into errors: it may hold data that
      // must not reach logs.
      await response.body?.cancel();
      throw SatellaApiError.fromStatus(
        name,
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new SatellaApiError(
        "SATELLA_CONTRACT_VIOLATION",
        name,
        response.status,
      );
    }
    return { data: parsed.data, status: response.status };
  }

  const pathId = (value: string) => encodeURIComponent(value);

  return {
    async getFeed({ cursor, limit } = {}) {
      const { data } = await call("getFeed", "/feed", feedPageSchema, {
        query: { cursor, limit },
      });
      return data;
    },

    async getEventContext(eventId) {
      const { data } = await call(
        "getEventContext",
        `/events/${pathId(eventId)}/review-context`,
        eventReviewContextSchema,
      );
      return data;
    },

    async findSimilarEvents(eventId, { windowDays } = {}) {
      const { data } = await call(
        "findSimilarEvents",
        `/events/${pathId(eventId)}/similar`,
        similarEventsSchema,
        { query: { windowDays } },
      );
      return data;
    },

    async getPriceBenchmark(query) {
      const { data } = await call(
        "getPriceBenchmark",
        "/benchmarks/prices",
        priceBenchmarkSchema,
        { query: { ...query } },
      );
      return data;
    },

    async createReview(request, { idempotencyKey }) {
      // Same schema as Satella's limits: a request that would get a 400 fails
      // here with a clear local error instead.
      const body = createReviewRequestSchema.parse(request);
      const { data, status } = await call(
        "createReview",
        "/reviews",
        createReviewResponseSchema,
        {
          method: "POST",
          body,
          headers: { "idempotency-key": idempotencyKey },
        },
      );
      return { review: data, created: status === 201 };
    },
  };
}

/** `Retry-After` in delta-seconds; an HTTP-date or garbage yields null. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}
