import type { z } from "zod";

import { SatellaApiError } from "./errors.js";
import {
  type AgentReview,
  agentReviewSchema,
  type CreateReviewRequest,
  createReviewRequestSchema,
  errorBodySchema,
  type EventReviewContext,
  eventReviewContextSchema,
  type FeedPage,
  feedPageSchema,
  idempotencyKeySchema,
  type OrganizerReviewContext,
  organizerReviewContextSchema,
  type PriceBenchmark,
  type PriceBenchmarkQuery,
  priceBenchmarkSchema,
  type SimilarEvent,
  similarEventsPageSchema,
} from "./schemas.js";

export interface SatellaClientOptions {
  /** Origin of Satella; the client appends `/api/agent/v1`. */
  baseUrl: string;
  /** A Google identity token in GCP, a bearer token locally (brief §13). */
  getAccessToken: () => Promise<string>;
  /** Sent as `X-Correlation-Id` so Satella's logs join the agent's run. */
  correlationId: string;
  fetch?: typeof globalThis.fetch;
  /** Per request. A hung call fails as `SATELLA_UNAVAILABLE` (#57). */
  timeoutMs?: number;
}

export interface CreateReviewResult {
  review: AgentReview;
  /** `false` when Satella returned an existing recommendation (200, not 201). */
  created: boolean;
}

export interface SatellaClient {
  getFeed(options?: { cursor?: string; limit?: number }): Promise<FeedPage>;
  getEventContext(eventId: string): Promise<EventReviewContext>;
  getOrganizerContext(organizerId: string): Promise<OrganizerReviewContext>;
  findSimilarEvents(
    eventId: string,
    options?: { windowDays?: number },
  ): Promise<SimilarEvent[]>;
  getPriceBenchmark(query: PriceBenchmarkQuery): Promise<PriceBenchmark>;
  /**
   * Idempotent: reusing `idempotencyKey`, or resending the same subject,
   * version and prompt version, returns the existing review. Throws
   * `STALE_SUBJECT` when the subject changed since its context was read.
   */
  createReview(
    request: CreateReviewRequest,
    options: { idempotencyKey: string },
  ): Promise<CreateReviewResult>;
  /** A recommendation with its status and the admin's resolution, if any. */
  getReview(reviewId: string): Promise<AgentReview>;
}

const API_PREFIX = "/api/agent/v1";
/** Well under the job's timeout: a hung socket must not use the whole pass. */
const REQUEST_TIMEOUT_MS = 15_000;

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
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or timeout: no status, nothing from Satella to keep.
      throw new SatellaApiError("SATELLA_UNAVAILABLE", name, null);
    }

    if (!response.ok) {
      // Only the stable code survives; the es-ES message stays out of errors
      // and logs.
      const errorBody = errorBodySchema.safeParse(
        await response.json().catch(() => null),
      );
      throw SatellaApiError.fromResponse(
        name,
        response.status,
        errorBody.success ? errorBody.data.error.code : null,
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

    async getOrganizerContext(organizerId) {
      const { data } = await call(
        "getOrganizerContext",
        `/organizers/${pathId(organizerId)}/review-context`,
        organizerReviewContextSchema,
      );
      return data;
    },

    async findSimilarEvents(eventId, { windowDays } = {}) {
      const { data } = await call(
        "findSimilarEvents",
        `/events/${pathId(eventId)}/similar`,
        similarEventsPageSchema,
        { query: { windowDays } },
      );
      return data.items;
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
      // Same limits as Satella: a request that would get a 400 fails here,
      // typed like Satella's 400 but with no status, since nothing was sent.
      const body = createReviewRequestSchema.safeParse(request);
      if (
        !body.success ||
        !idempotencyKeySchema.safeParse(idempotencyKey).success
      ) {
        throw new SatellaApiError("SATELLA_BAD_REQUEST", "createReview", null);
      }
      const { data, status } = await call(
        "createReview",
        "/reviews",
        agentReviewSchema,
        {
          method: "POST",
          body: body.data,
          headers: { "idempotency-key": idempotencyKey },
        },
      );
      return { review: data, created: status === 201 };
    },

    async getReview(reviewId) {
      const { data } = await call(
        "getReview",
        `/reviews/${pathId(reviewId)}`,
        agentReviewSchema,
      );
      return data;
    },
  };
}

/** `Retry-After` in delta-seconds; an HTTP-date or garbage yields null. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}
