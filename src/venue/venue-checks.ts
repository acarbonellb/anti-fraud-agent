/**
 * The venue checks (ADR 0015 points 2–4): `verifyVenue` and
 * `estimateVenueCapacity`, run in code before the model on an event's review
 * context. Both run in parallel and share the one Nominatim search; every
 * provider call has its own timeout, and a failure becomes an `unknown`
 * finding that says so.
 */
import type { EventReviewContext } from "../satella-client/schemas.js";
import type { SystemFinding } from "../checks/types.js";
import { type Fetch, VenueProviderError } from "./http.js";
import { createNominatim, NOMINATIM_MIN_INTERVAL_MS } from "./nominatim.js";
import {
  maxTicketsOnSale,
  type Outcome,
  scoreCapacity,
  scoreVenue,
  type VenueToVerify,
  verifiedMatch,
} from "./scoring.js";
import { createThrottle, type Throttle } from "./throttle.js";
import { createWikidata, isItemId } from "./wikidata.js";

/** Runs the venue checks on one event. */
export type VenueChecks = (
  context: EventReviewContext,
) => Promise<SystemFinding[]>;

export interface VenueChecksOptions {
  fetch: Fetch;
  /** Shared across runs: the providers' rate limits are per client. */
  throttles: VenueThrottles;
}

export interface VenueThrottles {
  nominatim: Throttle;
  wikidata: Throttle;
}

/** One set per process. Wikidata asks for no rate, only restraint. */
export function createVenueThrottles(): VenueThrottles {
  return {
    nominatim: createThrottle(NOMINATIM_MIN_INTERVAL_MS),
    wikidata: createThrottle(NOMINATIM_MIN_INTERVAL_MS),
  };
}

export function createVenueChecks(options: VenueChecksOptions): VenueChecks {
  return async (context) => {
    if (context.venue === null) {
      return [
        {
          certainty: "heuristic",
          finding: {
            check: "venue_exists",
            verdict: "unknown",
            detail: "El evento no tiene recinto: no se puede verificar.",
            confidence: 1,
            sources: [],
          },
        },
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
      latitude: context.venue.latitude,
      longitude: context.venue.longitude,
    };
    const places = settle(
      nominatim.search({
        name: venue.name,
        city: venue.city,
        country: context.venue.country,
      }),
    );

    const verify = async (): Promise<SystemFinding> => {
      const found = await places;
      const verified = found.ok ? verifiedMatch(venue, found.value) : null;
      const { latitude, longitude } = venue;
      // What lies at the point matters only when the name didn't verify it.
      const point =
        found.ok && verified === null && latitude !== null && longitude !== null
          ? await settle(nominatim.reverse(latitude, longitude))
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
      return scoreCapacity({
        venue,
        match,
        wikidata: fromWikidata,
        maxTicketsOnSale: maxTicketsOnSale(context),
      });
    };

    return Promise.all([verify(), estimate()]);
  };
}

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
