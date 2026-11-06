/**
 * A `fetch` for tests that answers Nominatim with a theatre at the given
 * coordinates, with a published capacity: every venue check passes. Any
 * other request fails as the network would, so a test can't reach it.
 */
import type { Fetch } from "../fetch.js";

export function fakeVenueFetch(venue: {
  latitude: number;
  longitude: number;
  capacity: number;
}): Fetch {
  return (url) =>
    new URL(url).hostname === "nominatim.openstreetmap.org"
      ? Promise.resolve(
          new Response(
            JSON.stringify([
              {
                osm_type: "node",
                osm_id: 1,
                lat: String(venue.latitude),
                lon: String(venue.longitude),
                category: "amenity",
                type: "theatre",
                name: "Teatro",
                extratags: { capacity: String(venue.capacity) },
              },
            ]),
            { status: 200 },
          ),
        )
      : Promise.reject(new TypeError("fetch failed"));
}
