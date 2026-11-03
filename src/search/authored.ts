/**
 * A `WebSearch` over hand-written pages, for eval cases whose organizers,
 * artists and texts are invented (CLAUDE.md §5): a real search for them finds
 * nothing, so their web is written by hand (ADR 0015 point 9, `authored`).
 *
 * The model picks its own queries, so pages are matched, not looked up: a
 * page answers a query when it contains enough of the query's words.
 * Deterministic, so a recording replays against it.
 */
import type { SearchQuery, SearchResult, WebSearch } from "./types.js";

/** Words of a query a page must contain, at least, to answer it. */
const MIN_MATCHING_WORDS = 2;

export function createAuthoredSearch(
  pages: readonly SearchResult[],
): WebSearch {
  const indexed = pages.map((page) => ({
    page,
    words: new Set(words(`${page.title} ${page.snippet} ${page.url}`)),
  }));
  return {
    provider: "authored",
    search(query: SearchQuery) {
      const wanted = [...new Set(words(query.query))];
      const results = indexed
        .map(({ page, words: have }) => ({
          page,
          score: wanted.filter((word) => have.has(word)).length,
        }))
        .filter(
          ({ score }) =>
            score >= Math.min(MIN_MATCHING_WORDS, wanted.length) && score > 0,
        )
        // Stable for equal scores: the corpus order breaks ties.
        .sort((a, b) => b.score - a.score)
        .slice(0, query.maxResults)
        .map(({ page }) => page);
      return Promise.resolve(results);
    },
  };
}

/** Words that match every page, so they say nothing about one. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "con",
  "del",
  "las",
  "los",
  "para",
  "por",
  "que",
  "una",
  "the",
  "and",
  "https",
  "http",
  "www",
  "com",
]);

/** Lowercase words of 3 letters or more, without accents or stop words. */
function words(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) ?? []
  ).filter((word) => !STOP_WORDS.has(word));
}
