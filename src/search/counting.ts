/**
 * One review's searches, counted where they all pass (#82): the copied-text
 * check, the capacity fallback and the model's `web_search` get the same
 * wrapped search, so the count is the credits the provider charges and no
 * caller counts on its own. A `WebSearchError` counts as failed and is thrown
 * on unchanged: each caller still decides what a failure means.
 */
import { type WebSearch, WebSearchError } from "./types.js";

export interface SearchCounts {
  /** Searches sent to the provider, failed ones included. */
  total: number;
  failed: number;
}

export interface CountingSearch {
  search: WebSearch;
  readonly counts: () => SearchCounts;
}

export function countSearches(inner: WebSearch): CountingSearch {
  let total = 0;
  let failed = 0;
  return {
    search: {
      provider: inner.provider,
      async search(query) {
        total += 1;
        try {
          return await inner.search(query);
        } catch (error) {
          if (error instanceof WebSearchError) failed += 1;
          throw error;
        }
      },
    },
    counts: () => ({ total, failed }),
  };
}
