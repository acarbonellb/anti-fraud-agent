/**
 * Nominatim (OpenStreetMap's geocoder): finds a venue by name and city and,
 * when the name doesn't verify it, tells what lies at the event's
 * coordinates (reverse geocoding): a residential building, or nothing inside
 * any municipality, which in Spain means the sea.
 *
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * — at most 1 request per second, a `User-Agent` that identifies the
 * application, and no repeated identical requests. The throttle covers the
 * first, `requestJson` the second, and the per-run memo the third.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { z } from "zod";

import type { Fetch } from "../fetch.js";
import { requestJson, VenueProviderError } from "./http.js";
import type { Throttle } from "./throttle.js";

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
/** The policy's absolute maximum. */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;
const MAX_RESULTS = 5;

const placeSchema = z.object({
  osm_type: z.enum(["node", "way", "relation"]),
  osm_id: z.number().int(),
  lat: z.coerce.number(),
  lon: z.coerce.number(),
  category: z.string(),
  type: z.string(),
  name: z.string().nullable().optional(),
  display_name: z.string().optional(),
  extratags: z.record(z.string(), z.string()).nullable().optional(),
});

export interface Place {
  osmType: "node" | "way" | "relation";
  osmId: number;
  latitude: number;
  longitude: number;
  /** OSM key and value, e.g. `amenity` / `theatre`. */
  category: string;
  type: string;
  name: string | null;
  /** The address Nominatim gives, comma-separated, e.g. `…, Zamora, Castilla y León, 49004, España`. */
  displayName: string | null;
  tags: Readonly<Record<string, string>>;
}

export interface VenueQuery {
  name: string;
  city: string;
  /**
   * Narrows the search when there are no coordinates to tell two places of
   * the same name apart (#74). Left out otherwise, so a venue with
   * coordinates is looked up as it always was.
   */
  province?: string;
  /** ISO 3166-1 alpha-2, e.g. `ES`. */
  country: string;
}

/** What lies at a point, or null when Nominatim finds nothing there. */
export interface PointPlace {
  osmType: "node" | "way" | "relation" | null;
  osmId: number | null;
  category: string;
  type: string;
  /** The city, town, village or municipality the point is in, if any. */
  locality: string | null;
}

export interface Nominatim {
  search(query: VenueQuery): Promise<Place[]>;
  reverse(latitude: number, longitude: number): Promise<PointPlace | null>;
}

/** One per run: the memo is what keeps identical requests from repeating. */
export function createNominatim(options: {
  fetch: Fetch;
  throttle: Throttle;
}): Nominatim {
  const memo = new Map<string, Promise<unknown>>();
  const get = (url: string): Promise<unknown> => {
    const cached = memo.get(url);
    if (cached !== undefined) return cached;
    const result = options.throttle(() =>
      requestJson(options.fetch, { provider: "nominatim", url }),
    );
    memo.set(url, result);
    return result;
  };
  return {
    search: (query) => get(searchUrl(query)).then(parsePlaces),
    reverse: (latitude, longitude) =>
      get(reverseUrl(latitude, longitude)).then(parsePoint),
  };
}

export function searchUrl(query: VenueQuery): string {
  const params = new URLSearchParams({
    q: searchText(query),
    format: "jsonv2",
    limit: String(MAX_RESULTS),
    extratags: "1",
    ...(/^[a-z]{2}$/i.test(query.country)
      ? { countrycodes: query.country.toLowerCase() }
      : {}),
  });
  return `${NOMINATIM_URL}/search?${params.toString()}`;
}

function searchText(query: VenueQuery): string {
  const { name, city, province } = query;
  // "Zamora, Zamora" adds nothing: a province named like its capital is left out.
  const sameAsCity =
    province === undefined ||
    province.trim().toLowerCase() === city.trim().toLowerCase();
  return sameAsCity ? `${name}, ${city}` : `${name}, ${city}, ${province}`;
}

export function reverseUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: "jsonv2",
    // Building level: the object the point stands on.
    zoom: "18",
    addressdetails: "1",
  });
  return `${NOMINATIM_URL}/reverse?${params.toString()}`;
}

const pointSchema = z.union([
  // Nominatim's answer when nothing at all is near the point.
  z.object({ error: z.string() }).transform(() => null),
  z.object({
    osm_type: z.enum(["node", "way", "relation"]).optional(),
    osm_id: z.number().int().optional(),
    category: z.string(),
    type: z.string(),
    address: z.record(z.string(), z.string()).optional(),
  }),
]);

const LOCALITY_KEYS = ["city", "town", "village", "municipality"] as const;

function parsePoint(body: unknown): PointPlace | null {
  const parsed = pointSchema.safeParse(body);
  if (!parsed.success) {
    throw new VenueProviderError("nominatim", "invalid_response");
  }
  const point = parsed.data;
  if (point === null) return null;
  const address = point.address ?? {};
  return {
    osmType: point.osm_type ?? null,
    osmId: point.osm_id ?? null,
    category: point.category,
    type: point.type,
    locality:
      LOCALITY_KEYS.map((key) => address[key]).find(
        (value) => value !== undefined,
      ) ?? null,
  };
}

function parsePlaces(body: unknown): Place[] {
  const parsed = z.array(placeSchema).safeParse(body);
  if (!parsed.success) {
    throw new VenueProviderError("nominatim", "invalid_response");
  }
  return parsed.data.map((place) => ({
    osmType: place.osm_type,
    osmId: place.osm_id,
    latitude: place.lat,
    longitude: place.lon,
    category: place.category,
    type: place.type,
    name: place.name ?? null,
    displayName: place.display_name ?? null,
    tags: place.extratags ?? {},
  }));
}

/** What `parsePlaces` and `parsePoint` read; `class` is `category` in older formats. */
const KEPT_FIELDS = [
  "osm_type",
  "osm_id",
  "lat",
  "lon",
  "category",
  "class",
  "type",
  "name",
  "display_name",
] as const;
/** The only tags the scorer reads (identity and capacity). */
const KEPT_TAGS = ["wikidata", "capacity"] as const;

/**
 * A Nominatim response reduced to what the venue checks read, for
 * recordings (#85). Raw responses carry venues' emails, phones and opening
 * hours in `extratags`, and street addresses in `address`, which a public
 * repo has no reason to republish. Each result keeps `KEPT_FIELDS`; from
 * `extratags`, only `KEPT_TAGS`; from a reverse lookup's `address`, only
 * `LOCALITY_KEYS` (the locality is read from it). An `{ error }` body stays
 * as it is. Anything that isn't a result object is left alone, so an
 * unexpected body still fails replay the way it failed live.
 */
export function reduceNominatimBody(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(reducePlace);
  if (isObject(body) && "error" in body) return body;
  return reducePlace(body);
}

function reducePlace(place: unknown): unknown {
  if (!isObject(place)) return place;
  const reduced: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) {
    if (field in place) reduced[field] = place[field];
  }
  if ("extratags" in place) {
    reduced.extratags = pick(place.extratags, KEPT_TAGS);
  }
  if ("address" in place) {
    reduced.address = pick(place.address, LOCALITY_KEYS);
  }
  return reduced;
}

/** The listed keys of an object; anything else is kept as it is. */
function pick(value: unknown, keys: readonly string[]): unknown {
  if (!isObject(value)) return value;
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The public page of an OSM element: the source a finding links to. */
export function osmUrl(place: Pick<Place, "osmType" | "osmId">): string {
  return `https://www.openstreetmap.org/${place.osmType}/${String(place.osmId)}`;
}
