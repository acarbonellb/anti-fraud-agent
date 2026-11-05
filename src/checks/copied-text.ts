/**
 * Copied descriptions (brief §5 case 8): one web search for the
 * description's longest sentence, run in code before the model. The model
 * never thought to search the text, and a query this mechanical doesn't need
 * it to (ADR 0015 amendment; #37, E004).
 *
 * A result counts only if it holds the whole sentence word for word: a
 * search engine answers a long query with pages that merely share its words.
 * It only ever warns, as a heuristic: a reused text is a reason to ask, not
 * proof of fraud (an organizer may publish its own text elsewhere), and no
 * copy found proves nothing either, so a miss gives no finding.
 */
import {
  type SearchResult,
  type WebSearch,
  WebSearchError,
} from "../search/types.js";
import type { EventReviewContext } from "../satella-client/schemas.js";
import { type SystemFinding, systemFinding } from "./types.js";

/** Shorter sentences are boilerplate ("Plazas limitadas"), not a fingerprint. */
const MIN_WORDS = 8;
/** Enough to be unique, short enough for any search engine's query limit. */
const MAX_WORDS = 25;
const SEARCH_RESULTS = 5;
/** Satella's limits on a finding's sources. */
const MAX_SOURCES = 10;
const MAX_SOURCE_TITLE_CHARS = 200;

export async function copiedTextCheck(
  context: EventReviewContext,
  search: WebSearch,
): Promise<SystemFinding[]> {
  const sentence = fingerprint(context.event.description ?? "");
  if (sentence === null) return [];

  let results: SearchResult[];
  try {
    results = await search.search({
      query: `"${sentence}"`,
      maxResults: SEARCH_RESULTS,
    });
  } catch (error) {
    // Without search there is no evidence either way: the review goes on.
    if (error instanceof WebSearchError) return [];
    throw error;
  }

  const wanted = normalized(sentence);
  const copies = results.filter(
    (result) =>
      isHttpUrl(result.url) &&
      ` ${normalized(`${result.title} ${result.snippet}`)} `.includes(
        ` ${wanted} `,
      ),
  );
  const [first] = copies;
  if (first === undefined) return [];

  const finding = systemFinding(
    "heuristic",
    "text_originality",
    "warn",
    `Texto copiado: una frase de la descripción aparece literal en ${hostOf(first.url)}${copies.length > 1 ? ` y en otras ${String(copies.length - 1)} webs` : ""}: «${sentence}».`,
  );
  finding.finding.sources = copies.slice(0, MAX_SOURCES).map((copy) => ({
    url: copy.url,
    title: copy.title.slice(0, MAX_SOURCE_TITLE_CHARS),
  }));
  return [finding];
}

/** The longest sentence, cut to its first words; null if none is long enough. */
function fingerprint(description: string): string | null {
  const sentences = description.split(/[.!?…\n]+/u).map((sentence) =>
    sentence
      .trim()
      .split(/\s+/u)
      .filter((w) => w !== ""),
  );
  const longest = sentences.reduce<string[]>(
    (best, words) => (words.length > best.length ? words : best),
    [],
  );
  return longest.length < MIN_WORDS
    ? null
    : longest.slice(0, MAX_WORDS).join(" ");
}

/** Words only: another site's casing, accents and punctuation don't hide a copy. */
function normalized(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).join(" ");
}

/** Satella only links `http(s)`; a result without one can't be a source. */
function isHttpUrl(url: string): boolean {
  return URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}
