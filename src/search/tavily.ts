/**
 * Tavily's search API (https://docs.tavily.com/documentation/api-reference/endpoint/search)
 * behind `WebSearch`. A basic search costs 1 credit; the free plan's 1,000
 * credits a month with no card is the spend cap (ADR 0015 point 8).
 *
 * One attempt, no retries: a `429` or an exhausted plan is reported, and the
 * tool answers that search is unavailable.
 */
import { z } from "zod";

import { DomainError } from "../errors.js";
import type { Fetch } from "../fetch.js";
import {
  MAX_SNIPPET_CHARS,
  type SearchQuery,
  type SearchResult,
  type WebSearch,
  WebSearchError,
} from "./types.js";

export const TAVILY_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 15_000;

const responseSchema = z.object({
  results: z.array(
    z.object({
      url: z.url({ protocol: /^https?$/ }),
      title: z.string(),
      content: z.string(),
    }),
  ),
});

export function createTavilySearch(options: {
  apiKey: string;
  fetch: Fetch;
}): WebSearch {
  return {
    provider: "Tavily",
    async search(query: SearchQuery): Promise<SearchResult[]> {
      let response: Response;
      try {
        response = await options.fetch(TAVILY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(tavilyBody(query)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof DomainError) throw error;
        const timedOut =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        throw new WebSearchError(timedOut ? "timeout" : "network", {
          cause: error,
        });
      }
      if (!response.ok) throw new WebSearchError(failureOf(response.status));
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new WebSearchError("invalid_response", { cause: error });
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new WebSearchError("invalid_response");
      // Only the fields the tool reads leave this function: the raw
      // response stays out of logs and recordings (Tavily's terms).
      return parsed.data.results.slice(0, query.maxResults).map((result) => ({
        url: result.url,
        title: result.title.slice(0, 200),
        snippet: result.content.slice(0, MAX_SNIPPET_CHARS),
      }));
    },
  };
}

/** The request, without the key: what a recording's hash is taken over. */
export function tavilyBody(query: SearchQuery): Record<string, unknown> {
  return {
    query: query.query,
    max_results: query.maxResults,
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
  };
}

function failureOf(status: number): WebSearchError["failure"] {
  if (status === 401) return "unauthorized";
  // 432 and 433: the plan's or the pay-as-you-go limit.
  if (status === 432 || status === 433) return "quota_exceeded";
  if (status === 429) return "rate_limited";
  return "http_error";
}
