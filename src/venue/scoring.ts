/**
 * Scores the venue providers' responses into system findings (ADR 0015
 * points 3 and 4). Pure: the same responses always give the same findings,
 * so replay exercises this code with recorded responses.
 *
 * Every venue finding is a `heuristic`: OSM and Wikidata are volunteer data,
 * and a mistyped tag must not let a request resolve on its own. Its strength
 * comes from its source instead: a capacity `fail` carries one, which is what
 * lets a `reject` resolve on its own (ADR 0012 point 3).
 *
 * The thresholds are provisional until the evals tune them.
 */
import type { Finding } from "../satella-client/schemas.js";
import type { CheckId } from "../checks/vocabulary.js";
import type { SystemFinding } from "../checks/types.js";
import type { SearchFailure, SearchResult } from "../search/types.js";
import type { ProviderFailure, VenueProvider } from "./http.js";
import { osmUrl, type Place, type PointPlace } from "./nominatim.js";
import { itemUrl } from "./wikidata.js";

/** A venue found by name further than this from the event's coordinates isn't verified. */
export const VENUE_MAX_DISTANCE_M = 200;
/** Tickets above this many times the capacity in one session: `warn`. */
export const CAPACITY_WARN_FACTOR = 1;
/** At or above this many times the capacity: `fail`, a sourced hard signal. */
export const CAPACITY_FAIL_FACTOR = 2;

/** OSM tags of a place that can hold an event (ADR 0015 point 3). */
const VENUE_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  amenity: new Set([
    "arts_centre",
    "bar",
    "cafe",
    "cinema",
    "community_centre",
    "concert_hall",
    "conference_centre",
    "events_venue",
    "exhibition_centre",
    "music_venue",
    "nightclub",
    "pub",
    "restaurant",
    "social_centre",
    "theatre",
  ]),
  leisure: new Set([
    "bandstand",
    "dance",
    "park",
    "sports_centre",
    "sports_hall",
    "stadium",
  ]),
};

const RESIDENTIAL_BUILDINGS: ReadonlySet<string> = new Set([
  "apartments",
  "bungalow",
  "detached",
  "dormitory",
  "house",
  "residential",
  "semidetached_house",
  "terrace",
]);

/** `category=type` of the water a point can fall on. */
const WATER: ReadonlySet<string> = new Set([
  "natural=water",
  "natural=bay",
  "natural=strait",
  "natural=coastline",
  "place=sea",
  "place=ocean",
]);

const OSM_ATTRIBUTION = "© colaboradores de OpenStreetMap, ODbL";

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; provider: VenueProvider; failure: ProviderFailure };

export interface VenueToVerify {
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2, e.g. `ES`. */
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Match {
  place: Place;
  distanceM: number;
}

export function isVenueType(tags: { category: string; type: string }): boolean {
  return VENUE_TYPES[tags.category]?.has(tags.type) ?? false;
}

/** The compatible place closest to the event's coordinates, at any distance. */
export function nearestVenue(
  venue: VenueToVerify,
  places: readonly Place[],
): Match | null {
  const { latitude, longitude } = venue;
  if (latitude === null || longitude === null) return null;
  let best: Match | null = null;
  for (const place of places) {
    if (!isVenueType(place)) continue;
    const distanceM = distanceMeters(
      { latitude, longitude },
      { latitude: place.latitude, longitude: place.longitude },
    );
    if (best === null || distanceM < best.distanceM)
      best = { place, distanceM };
  }
  return best;
}

/** The match that verifies the venue: compatible and close enough. */
export function verifiedMatch(
  venue: VenueToVerify,
  places: readonly Place[],
): Match | null {
  const match = nearestVenue(venue, places);
  return match !== null && match.distanceM <= VENUE_MAX_DISTANCE_M
    ? match
    : null;
}

export interface VenueEvidence {
  venue: VenueToVerify;
  places: Outcome<readonly Place[]>;
  /**
   * What lies at the event's coordinates (reverse geocoding), or null when
   * nothing was found there. Only asked for when the name search doesn't
   * verify the venue.
   */
  point: Outcome<PointPlace | null> | null;
}

/** `verifyVenue` (ADR 0015 point 3). `permanentlyClosed` isn't judged: OSM rarely knows it. */
export function scoreVenue(evidence: VenueEvidence): SystemFinding {
  const { venue, places, point } = evidence;
  const check = "venue_exists";
  const finding = (
    verdict: Finding["verdict"],
    detail: string,
    sources: Finding["sources"] = [],
  ) => venueFinding(check, verdict, detail, sources);

  if (venue.latitude === null || venue.longitude === null) {
    return finding(
      "unknown",
      `El recinto «${venue.name}» no tiene coordenadas: no se puede verificar.`,
    );
  }
  if (!places.ok) {
    return finding(
      "unknown",
      `No se pudo verificar el recinto: ${failureText(places)}.`,
    );
  }

  const verified = verifiedMatch(venue, places.value);
  if (verified !== null) {
    return finding(
      "pass",
      `Recinto verificado: «${placeName(verified.place, venue)}» figura en OpenStreetMap como ${typeText(verified.place)} a ${metres(verified.distanceM)} de las coordenadas del evento (umbral: ${metres(VENUE_MAX_DISTANCE_M)}).`,
      [osmSource(verified.place, venue)],
    );
  }
  const nearest = nearestVenue(venue, places.value);

  // Nothing found at all proves nothing: it stays `unknown` below.
  const at = point?.ok ? point.value : null;
  if (at !== null) {
    const water =
      WATER.has(`${at.category}=${at.type}`) || at.category === "waterway";
    // Spanish municipalities end at the coast, so a point in none of them is
    // at sea; elsewhere that doesn't follow.
    const atSea = at.locality === null && venue.country === "ES";
    if (water || atSea) {
      return finding(
        "fail",
        `Heurística de recinto: según OpenStreetMap, las coordenadas del evento caen ${water ? "sobre una masa de agua" : "fuera de todo término municipal, es decir, en el mar"}, y OpenStreetMap no tiene el recinto «${venue.name}» en esas coordenadas. Los datos de OSM pueden contener errores.`,
        [pointSource(venue)],
      );
    }
    if (at.category === "building" && RESIDENTIAL_BUILDINGS.has(at.type)) {
      return finding(
        "fail",
        `Heurística de recinto: las coordenadas del evento están sobre un edificio residencial (building=${at.type}) según OpenStreetMap, y OpenStreetMap no tiene el recinto «${venue.name}» en esas coordenadas. Los datos de OSM pueden contener errores.`,
        [
          at.osmType === null || at.osmId === null
            ? pointSource(venue)
            : {
                url: osmUrl({ osmType: at.osmType, osmId: at.osmId }),
                title: `OpenStreetMap: edificio en las coordenadas del evento (${OSM_ATTRIBUTION})`,
              },
        ],
      );
    }
  }

  const unchecked =
    point !== null && !point.ok
      ? ` Tampoco se pudo comprobar qué hay en las coordenadas: ${failureText(point)}.`
      : "";
  if (nearest !== null) {
    return finding(
      "unknown",
      `Recinto sin verificar: «${placeName(nearest.place, venue)}» figura en OpenStreetMap a ${metres(nearest.distanceM)} de las coordenadas del evento, más lejos del umbral de ${metres(VENUE_MAX_DISTANCE_M)}.${unchecked}`,
      [osmSource(nearest.place, venue)],
    );
  }
  return finding(
    "unknown",
    `Recinto sin verificar: OpenStreetMap no tiene ningún recinto «${venue.name}» en ${venue.city}.${unchecked}`,
  );
}

export interface CapacityEvidence {
  venue: VenueToVerify;
  /** The verified match, or null: an unverified place's capacity proves nothing. */
  match: Match | null;
  /** Null when the place has no `wikidata` tag. */
  wikidata: Outcome<number | null> | null;
  /**
   * The web search fallback, asked only when neither Wikidata nor OSM
   * publishes a capacity, and when a search provider is configured.
   */
  web: WebCapacitySearch | null;
  maxTicketsOnSale: number;
}

export type WebCapacitySearch =
  | { ok: true; results: readonly SearchResult[] }
  | { ok: false; failure: SearchFailure };

/** `estimateVenueCapacity` (ADR 0015 point 4), compared per session. */
export function scoreCapacity(evidence: CapacityEvidence): SystemFinding {
  const { venue, match, wikidata, web, maxTicketsOnSale: tickets } = evidence;
  const onSale = `la sesión con más entradas pone a la venta ${count(tickets)}`;
  if (match === null) {
    return venueFinding(
      "venue_capacity",
      "unknown",
      `Aforo desconocido: el recinto no está verificado en OpenStreetMap, así que no hay aforo publicado; ${onSale}.`,
    );
  }

  const published = publishedCapacity(match.place, wikidata);
  const fromWeb =
    published === null && web?.ok ? capacityFromWeb(venue, web.results) : null;
  if (fromWeb !== null) return scoreWebCapacity(fromWeb, tickets, onSale);
  const known = published;
  if (known === null) {
    const failed =
      wikidata !== null && !wikidata.ok ? ` (${failureText(wikidata)})` : "";
    const searched =
      web === null
        ? ""
        : web.ok
          ? ", ni la búsqueda web"
          : `, y la búsqueda web falló (${web.failure})`;
    return venueFinding(
      "venue_capacity",
      "unknown",
      `Aforo desconocido: ni Wikidata${failed} ni OpenStreetMap publican el aforo de «${placeName(match.place, venue)}»${searched}; ${onSale}.`,
    );
  }

  const { capacity, source } = known;
  const factor = (tickets / capacity).toFixed(1).replace(".", ",");
  const against = `${onSale}, ${factor} veces el aforo de ${count(capacity)} que publica ${source.title}`;
  if (tickets >= CAPACITY_FAIL_FACTOR * capacity) {
    return venueFinding(
      "capacity_far_above_venue",
      "fail",
      `Señal grave de aforo: ${against} (umbral: ${String(CAPACITY_FAIL_FACTOR)} veces).`,
      [source],
    );
  }
  if (tickets > CAPACITY_WARN_FACTOR * capacity) {
    return venueFinding(
      "venue_capacity",
      "warn",
      `Heurística de aforo: ${against}. Entre ${String(CAPACITY_WARN_FACTOR)} y ${String(CAPACITY_FAIL_FACTOR)} veces puede tener explicación (una terraza, un aforo ampliado).`,
      [source],
    );
  }
  return venueFinding(
    "venue_capacity",
    "pass",
    `Aforo compatible: ${onSale}, dentro del aforo de ${count(capacity)} que publica ${source.title}.`,
    [source],
  );
}

/**
 * A capacity read from one search snippet can only hold back (ADR 0015 point
 * 6, amendment of #57). Too many tickets for it escalates; within it, the
 * capacity still counts as unknown, so the exposure cap decides an approval.
 * It never gives a `pass` or a hard `fail`: the organizer names the venue, and
 * a page that names it can say anything.
 */
function scoreWebCapacity(
  known: { capacity: number; source: Finding["sources"][number] },
  tickets: number,
  onSale: string,
): SystemFinding {
  const { capacity, source } = known;
  const factor = (tickets / capacity).toFixed(1).replace(".", ",");
  if (tickets > CAPACITY_WARN_FACTOR * capacity) {
    return venueFinding(
      "venue_capacity",
      "warn",
      `Heurística de aforo: ${onSale}, ${factor} veces el aforo de ${count(capacity)} que da ${source.title}. Una cifra de la web no está verificada, así que lo decide el admin.`,
      [source],
    );
  }
  return venueFinding(
    "venue_capacity",
    "unknown",
    `Aforo sin verificar: ${source.title} da un aforo de ${count(capacity)} y ${onSale}, pero una cifra de la web no cuenta para aprobar; se aplica el tope de exposición.`,
    [source],
  );
}

/** Wikidata first, then the OSM tag (ADR 0015 point 4). Null: ask the web. */
export function publishedCapacity(
  place: Place,
  wikidata: Outcome<number | null> | null,
): { capacity: number; source: Finding["sources"][number] } | null {
  const itemId = place.tags.wikidata;
  if (wikidata !== null && wikidata.ok && wikidata.value !== null && itemId) {
    return {
      capacity: wikidata.value,
      source: { url: itemUrl(itemId), title: `Wikidata (${itemId}, CC0)` },
    };
  }
  const tag = place.tags.capacity;
  if (tag !== undefined && /^\d+$/.test(tag) && Number(tag) > 0) {
    return {
      capacity: Number(tag),
      source: {
        url: osmUrl(place),
        title: `OpenStreetMap (${OSM_ATTRIBUTION})`,
      },
    };
  }
  return null;
}

/**
 * The third step of ADR 0015 point 4: a capacity read from a search result
 * that names the venue, with that result as the source. A number counts only
 * next to a unit («300 personas») or right after «aforo de» or «aforo:», so a
 * year or an address doesn't pass for one.
 */
export function capacityFromWeb(
  venue: VenueToVerify,
  results: readonly SearchResult[],
): { capacity: number; source: Finding["sources"][number] } | null {
  const name = fold(venue.name);
  for (const result of results) {
    const text = `${result.title}. ${result.snippet}`;
    if (!fold(text).includes(name)) continue;
    const match = CAPACITY_PATTERNS.map((pattern) => pattern.exec(text)).find(
      (found) => found !== null,
    );
    const capacity = match?.[1] === undefined ? NaN : parseCount(match[1]);
    if (capacity >= MIN_WEB_CAPACITY && capacity <= MAX_WEB_CAPACITY) {
      return {
        capacity,
        source: {
          url: result.url,
          title: `la web (${new URL(result.url).hostname})`,
        },
      };
    }
  }
  return null;
}

const NUMBER = String.raw`(\d{1,3}(?:[.\s]\d{3})+|\d{2,6})`;
const CAPACITY_PATTERNS = [
  new RegExp(
    String.raw`(?:aforo|capacidad)\b[^.\d]{0,40}?${NUMBER}\s*(?:personas|espectadores|plazas|localidades|butacas|asistentes)\b`,
    "iu",
  ),
  new RegExp(
    String.raw`aforo(?:\s+(?:máximo|total))?\s*(?:de|:)\s*${NUMBER}\b`,
    "iu",
  ),
];
/** Outside this, a number next to «aforo» is more likely something else. */
const MIN_WEB_CAPACITY = 20;
const MAX_WEB_CAPACITY = 200_000;

function parseCount(text: string): number {
  return Number(text.replace(/[.\s]/g, ""));
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine: plenty at the scale of a city block. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

const PROVIDER_NAMES: Record<VenueProvider, string> = {
  nominatim: "OpenStreetMap (Nominatim)",
  wikidata: "Wikidata",
};

const FAILURE_TEXT: Record<ProviderFailure, string> = {
  timeout: "no respondió a tiempo",
  rate_limited: "rechazó la consulta por exceso de peticiones (429)",
  http_error: "devolvió un error",
  network: "no se pudo contactar",
  invalid_response: "devolvió una respuesta que no se entiende",
};

export function failureText(outcome: {
  provider: VenueProvider;
  failure: ProviderFailure;
}): string {
  return `${PROVIDER_NAMES[outcome.provider]} ${FAILURE_TEXT[outcome.failure]}; sin datos no se da nada por bueno`;
}

export function venueFinding(
  check: VenueCheck,
  verdict: Finding["verdict"],
  detail: string,
  sources: Finding["sources"] = [],
): SystemFinding {
  return {
    certainty: "heuristic",
    finding: { check, verdict, detail, confidence: 1, sources },
    // One family: a model finding on any of them is dropped (ADR 0012 point 1).
    covers: VENUE_CHECKS,
  };
}

/** The checks the venue findings settle. */
export const VENUE_CHECKS = [
  "venue_exists",
  "venue_capacity",
  "capacity_far_above_venue",
] as const satisfies readonly CheckId[];
export type VenueCheck = (typeof VENUE_CHECKS)[number];

export function isVenueCheck(check: string): check is VenueCheck {
  return (VENUE_CHECKS as readonly string[]).includes(check);
}

function osmSource(place: Place, venue: VenueToVerify) {
  return {
    url: osmUrl(place),
    title:
      `OpenStreetMap: ${placeName(place, venue)} (${OSM_ATTRIBUTION})`.slice(
        0,
        200,
      ),
  };
}

function pointSource(venue: VenueToVerify) {
  const lat = String(venue.latitude);
  const lon = String(venue.longitude);
  return {
    url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
    title: `OpenStreetMap: coordenadas del evento (${OSM_ATTRIBUTION})`,
  };
}

function placeName(place: Place, venue: VenueToVerify): string {
  return place.name ?? venue.name;
}

function typeText(place: Place): string {
  return `${place.category}=${place.type}`;
}

function metres(distance: number): string {
  return distance < 1000
    ? `${String(Math.round(distance))} m`
    : `${(distance / 1000).toFixed(1).replace(".", ",")} km`;
}

function count(value: number): string {
  // Fixed grouping, independent of the machine's locale.
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
