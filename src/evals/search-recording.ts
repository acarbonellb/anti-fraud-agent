/**
 * Recordings of web searches, taken at the `WebSearch` boundary rather than
 * over HTTP: what is kept is the reduced result (url, title, snippet), never
 * the raw response (Tavily's terms, ADR 0015 point 9). The model picks the
 * queries, so searches live in each model's recording, not in the shared
 * venue responses.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { MODEL_SNIPPET_CHARS } from "../agent/web-search-tool.js";
import {
  type SearchQuery,
  type WebSearch,
  WebSearchError,
} from "../search/types.js";
import { StaleRecordingError } from "./stale.js";

export const searchCallSchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  provider: z.string().min(1),
  query: z.string(),
  maxResults: z.number().int().positive(),
  origin: z.enum(["recorded", "authored"]),
  response: z.union([
    z.object({
      results: z.array(
        z.object({ url: z.string(), title: z.string(), snippet: z.string() }),
      ),
    }),
    z.object({
      failure: z.enum([
        "unauthorized",
        "quota_exceeded",
        "rate_limited",
        "http_error",
        "timeout",
        "network",
        "invalid_response",
      ]),
    }),
  ]),
});
export type SearchCall = z.infer<typeof searchCallSchema>;

/**
 * The query alone: the key and the transport don't change the answer, and
 * the recording already belongs to one run of one model.
 */
export function hashSearch(query: SearchQuery): string {
  return createHash("sha256")
    .update(JSON.stringify([query.query, query.maxResults]))
    .digest("hex");
}

export interface RecordingSearch {
  search: WebSearch;
  calls(): SearchCall[];
}

/**
 * Wraps a real search and keeps each reduced answer, or failure, by hash.
 * Snippets are cut to what the model reads, so the repo keeps no more
 * third-party text than the agent uses (#85); the recording run gets the cut
 * text too, so it sees exactly what replay will serve.
 */
export function createRecordingSearch(inner: WebSearch): RecordingSearch {
  const calls = new Map<string, SearchCall>();
  const search: WebSearch = {
    provider: inner.provider,
    async search(query) {
      const base = {
        requestHash: hashSearch(query),
        provider: inner.provider,
        query: query.query,
        maxResults: query.maxResults,
        origin: "recorded" as const,
      };
      try {
        const results = (await inner.search(query)).map((result) => ({
          ...result,
          snippet: result.snippet.slice(0, MODEL_SNIPPET_CHARS),
        }));
        calls.set(base.requestHash, { ...base, response: { results } });
        return results;
      } catch (error) {
        if (error instanceof WebSearchError) {
          calls.set(base.requestHash, {
            ...base,
            response: { failure: error.failure },
          });
        }
        throw error;
      }
    },
  };
  return { search, calls: () => [...calls.values()] };
}

/** Serves recorded searches by hash; a query with no recording is stale. */
export function createReplaySearch(searches: readonly SearchCall[]): WebSearch {
  const byHash = new Map(searches.map((call) => [call.requestHash, call]));
  return {
    provider: searches[0]?.provider ?? "replay",
    search(query) {
      const call = byHash.get(hashSearch(query));
      if (call === undefined) {
        return Promise.reject(new StaleRecordingError("missing_tool_response"));
      }
      return "failure" in call.response
        ? Promise.reject(new WebSearchError(call.response.failure))
        : Promise.resolve(call.response.results);
    },
  };
}
