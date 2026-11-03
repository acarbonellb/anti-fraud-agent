/**
 * Wikidata: a venue's maximum capacity (property P1083), for the item an OSM
 * element links to with its `wikidata` tag. Data is CC0.
 */
import { z } from "zod";

import { type Fetch, requestJson, VenueProviderError } from "./http.js";
import type { Throttle } from "./throttle.js";

export const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
/**
 * Wikidata states no fixed rate, only restraint and a descriptive
 * User-Agent; one request per second is well within it.
 */
export const WIKIDATA_MIN_INTERVAL_MS = 1000;

const responseSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({ capacity: z.object({ value: z.string() }).optional() }),
    ),
  }),
});

export interface Wikidata {
  /** Null when the item has no capacity. */
  capacity(itemId: string): Promise<number | null>;
}

export function createWikidata(options: {
  fetch: Fetch;
  throttle: Throttle;
}): Wikidata {
  const memo = new Map<string, Promise<number | null>>();
  return {
    capacity(itemId) {
      const url = capacityUrl(itemId);
      const cached = memo.get(url);
      if (cached !== undefined) return cached;
      const result = options
        .throttle(() =>
          requestJson(options.fetch, { provider: "wikidata", url }),
        )
        .then(parseCapacity);
      memo.set(url, result);
      return result;
    },
  };
}

/** Item ids come from OSM tags: anything but `Q<digits>` is refused. */
export function isItemId(value: string): boolean {
  return /^Q[1-9]\d*$/.test(value);
}

export function capacityUrl(itemId: string): string {
  if (!isItemId(itemId)) {
    throw new VenueProviderError("wikidata", "invalid_response");
  }
  const query = `SELECT ?capacity WHERE { wd:${itemId} wdt:P1083 ?capacity }`;
  const params = new URLSearchParams({ query, format: "json" });
  return `${WIKIDATA_SPARQL_URL}?${params.toString()}`;
}

export function itemUrl(itemId: string): string {
  return `https://www.wikidata.org/wiki/${itemId}`;
}

function parseCapacity(body: unknown): number | null {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new VenueProviderError("wikidata", "invalid_response");
  }
  // An item can state several capacities (seated, standing): the largest is
  // the one a sale must stay under.
  const values = parsed.data.results.bindings
    .map((binding) => Number(binding.capacity?.value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return values.length === 0 ? null : Math.max(...values);
}
