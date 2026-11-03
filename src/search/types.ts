/**
 * Web search behind one provider-neutral interface (ADR 0015 point 1): the
 * `web_search` tool and the capacity fallback call it, and a Tavily adapter
 * (or an authored corpus, in the evals) sits behind it. Swapping the adapter
 * doesn't touch the tool.
 */
import { DomainError } from "../errors.js";

/** One result, reduced to what the agent reads (Tavily's terms, ADR 0015 point 9). */
export interface SearchResult {
  url: string;
  title: string;
  /** The provider's extract of the page: organizer- or web-written, untrusted. */
  snippet: string;
}

export interface SearchQuery {
  query: string;
  maxResults: number;
}

export interface WebSearch {
  /** Attribution for the results, e.g. `Tavily`. */
  readonly provider: string;
  search(query: SearchQuery): Promise<SearchResult[]>;
}

export type SearchFailure =
  | "unauthorized"
  | "quota_exceeded"
  | "rate_limited"
  | "http_error"
  | "timeout"
  | "network"
  | "invalid_response";

export class WebSearchError extends DomainError {
  readonly code = "WEB_SEARCH_FAILED";

  constructor(
    readonly failure: SearchFailure,
    options?: ErrorOptions,
  ) {
    super(`Web search failed: ${failure}`, options);
  }
}

/** Snippets are cut here: enough to judge a page, little to store. */
export const MAX_SNIPPET_CHARS = 500;
