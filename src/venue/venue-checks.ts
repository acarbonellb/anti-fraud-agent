/**
 * The venue checks (ADR 0015 points 2–4): `verifyVenue` and
 * `estimateVenueCapacity`, run in code before the model on an event's review
 * context. Both run in parallel and share the one Nominatim search; every
 * provider call has its own timeout, and a failure becomes an `unknown`
 * finding that says so.
 */
import type { EventReviewContext } from "../satella-client/schemas.js";
import type { SystemFinding } from "../checks/types.js";
import type { Fetch } from "../fetch.js";
import { VenueProviderError } from "./http.js";
import { createNominatim, NOMINATIM_MIN_INTERVAL_MS } from "./nominatim.js";
import { maxTicketsOnSale } from "../checks/tickets-on-sale.js";
import {
  hasCoordinates,
  type Outcome,
  publishedCapacity,
  scoreCapacity,
  scoreVenue,
  venueFinding,
  type VenueToVerify,
  verifiedMatch,
  type WebCapacitySearch,
} from "./scoring.js";
import { type WebSearch, WebSearchError } from "../search/types.js";
import { createThrottle, type Throttle } from "./throttle.js";
import {
  createWikidata,
  isItemId,
  WIKIDATA_MIN_INTERVAL_MS,
} from "./wikidata.js";

/** Runs the venue checks on one event. */
export type VenueChecks = (
  context: EventReviewContext,
) => Promise<SystemFinding[]>;

export interface VenueChecksOptions {
  fetch: Fetch;
  /**
   * The capacity's last resort (ADR 0015 point 4). Without one, a capacity
   * neither Wikidata nor OSM publishes stays unknown.
   */
  search?: WebSearch;
  /** Shared across runs: the providers' rate limits are per client. */
  throttles: VenueThrottles;
}

export interface VenueThrottles {
  nominatim: Throttle;
  wikidata: Throttle;
}

/** One set per process: each provider's limit is per client. */
export function createVenueThrottles(): VenueThrottles {
  return {
    nominatim: createThrottle(NOMINATIM_MIN_INTERVAL_MS),
    wikidata: createThrottle(WIKIDATA_MIN_INTERVAL_MS),
  };
}

export function createVenueChecks(options: VenueChecksOptions): VenueChecks {
  return async (context) => {
    if (context.venue === null) {
      return [
        venueFinding(
          "venue_exists",
          "unknown",
          "El evento no tiene recinto: no se puede verificar.",
        ),
      ];
    }
    // Fresh providers per run: their memo is what keeps a run from repeating
    // an identical request, and it must not outlive the run.
    const nominatim = createNominatim({
      fetch: options.fetch,
      throttle: options.throttles.nominatim,
    });
    const wikidata = createWikidata({
      fetch: options.fetch,
      throttle: options.throttles.wikidata,
    });

    const venue: VenueToVerify = {
      name: context.venue.name,
      city: context.venue.city,
      province: context.venue.province,
      country: context.venue.country,
      latitude: context.venue.latitude,
      longitude: context.venue.longitude,
    };
    const places = settle(
      nominatim.search({
        name: venue.name,
        city: venue.city,
        // Only without coordinates (#74): with them, distance already tells
        // two places of the same name apart, and their lookup stays as it was.
        ...(!hasCoordinates(venue) ? { province: venue.province } : {}),
        country: context.venue.country,
      }),
    );

    const verify = async (): Promise<SystemFinding> => {
      const found = await places;
      const verified = found.ok ? verifiedMatch(venue, found.value) : null;
      // What lies at the point matters only when the name didn't verify it.
      const point =
        found.ok && verified === null && hasCoordinates(venue)
          ? await settle(nominatim.reverse(venue.latitude, venue.longitude))
          : null;
      return scoreVenue({ venue, places: found, point });
    };

    const estimate = async (): Promise<SystemFinding> => {
      const found = await places;
      const match = found.ok ? verifiedMatch(venue, found.value) : null;
      const itemId = match?.place.tags.wikidata;
      const fromWikidata =
        itemId !== undefined && isItemId(itemId)
          ? await settle(wikidata.capacity(itemId))
          : null;
      const needsWeb =
        match !== null &&
        options.search !== undefined &&
        publishedCapacity(match.place, fromWikidata) === null;
      const web =
        needsWeb && options.search !== undefined
          ? await searchCapacity(options.search, venue)
          : null;
      return scoreCapacity({
        venue,
        match,
        wikidata: fromWikidata,
        web,
        maxTicketsOnSale: maxTicketsOnSale(context),
      });
    };

    return Promise.all([verify(), estimate()]);
  };
}

/** A fixed query: the venue's name, its city and the word for capacity. */
async function searchCapacity(
  search: WebSearch,
  venue: VenueToVerify,
): Promise<WebCapacitySearch> {
  try {
    const results = await search.search({
      query: `${venue.name} ${venue.city} aforo`,
      maxResults: CAPACITY_SEARCH_RESULTS,
    });
    return { ok: true, results };
  } catch (error) {
    if (error instanceof WebSearchError) {
      return { ok: false, failure: error.failure };
    }
    throw error;
  }
}

const CAPACITY_SEARCH_RESULTS = 5;

/** A provider error becomes data the scoring reads; anything else is a bug. */
async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    if (error instanceof VenueProviderError) {
      return { ok: false, provider: error.provider, failure: error.failure };
    }
    throw error;
  }
}
