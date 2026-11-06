// Checks the venue checks through their providers: the requests they build
// (fixed User-Agent, no request repeated in a run, Nominatim's pace), and
// that every provider failure ends as an `unknown` finding that says so.
// Fakes `fetch` with canned provider responses and the throttle's clock.
import { describe, expect, it } from "vitest";

import { fixtures } from "../satella-client/fixtures.js";
import type { EventReviewContext } from "../satella-client/schemas.js";
import type { WebSearch } from "../search/types.js";
import type { Fetch } from "../fetch.js";
import { USER_AGENT } from "./http.js";
import { createThrottle, noThrottle } from "./throttle.js";
import { createVenueChecks } from "./venue-checks.js";

const throttles = {
  nominatim: noThrottle,
  wikidata: noThrottle,
};

function eventAt(latitude: number, longitude: number): EventReviewContext {
  const context = structuredClone(fixtures.eventContext);
  if (context.venue === null) throw new Error("fixture without a venue");
  context.venue = { ...context.venue, latitude, longitude };
  return context;
}

const LAT = 40.4154216;
const LON = -3.7040234;

const nominatimHit = (tags: Record<string, string>) => [
  {
    osm_type: "node",
    osm_id: 1,
    lat: String(LAT),
    lon: String(LON),
    category: "amenity",
    type: "theatre",
    name: "Teatro",
    extratags: tags,
  },
];

interface Call {
  url: string;
  init: RequestInit;
}

/** Answers by provider host; anything unexpected is a network failure. */
function fakeFetch(answers: {
  search?: () => Response;
  reverse?: () => Response;
  wikidata?: () => Response;
}): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    const { hostname, pathname } = new URL(url);
    const answer =
      hostname === "nominatim.openstreetmap.org"
        ? pathname === "/search"
          ? answers.search
          : answers.reverse
        : hostname === "query.wikidata.org"
          ? answers.wikidata
          : undefined;
    return answer === undefined
      ? Promise.reject(new TypeError("fetch failed"))
      : Promise.resolve(answer());
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("venue checks", () => {
  it("sends the fixed User-Agent and searches Nominatim once for both checks", async () => {
    const { fetch, calls } = fakeFetch({
      search: () => json(nominatimHit({ capacity: "898" })),
    });
    const findings = await createVenueChecks({ fetch, throttles })(
      eventAt(LAT, LON),
    );

    expect(findings.map((item) => item.finding.verdict)).toEqual([
      "pass",
      "pass",
    ]);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(new Headers(call?.init.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(
      /^anti-fraud-agent\/[\d.]+ \(\+https:\/\/github\.com\/acarbonellb\/anti-fraud-agent\)$/,
    );
    const url = new URL(call?.url ?? "");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("extratags")).toBe("1");
  });

  it("asks Wikidata for the capacity of the item OSM links to", async () => {
    const { fetch, calls } = fakeFetch({
      search: () => json(nominatimHit({ wikidata: "Q2635919" })),
      wikidata: () =>
        json({ results: { bindings: [{ capacity: { value: "1100" } }] } }),
    });
    const [, capacity] = await createVenueChecks({ fetch, throttles })(
      eventAt(LAT, LON),
    );
    expect(capacity?.finding.sources[0]?.url).toBe(
      "https://www.wikidata.org/wiki/Q2635919",
    );
    expect(calls[1]?.url).toContain("wd%3AQ2635919+wdt%3AP1083");
  });

  it("asks what lies at the point only when the name doesn't verify the venue", async () => {
    const { fetch, calls } = fakeFetch({
      search: () => json([]),
      // What Nominatim answers at sea: the country, no municipality.
      reverse: () =>
        json({
          category: "boundary",
          type: "administrative",
          address: { country: "España" },
        }),
    });
    const [exists] = await createVenueChecks({ fetch, throttles })(
      eventAt(39.41, -0.2),
    );
    expect(exists?.finding.verdict).toBe("fail");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/search",
      "/reverse",
    ]);
    const reverse = new URL(calls[1]?.url ?? "");
    expect(reverse.searchParams.get("lat")).toBe("39.41");
    expect(reverse.searchParams.get("zoom")).toBe("18");
  });

  it.each([
    {
      failure: "a 429",
      answer: () => json({}, 429),
      text: "429",
    },
    {
      failure: "an error status",
      answer: () => json({}, 503),
      text: "devolvió un error",
    },
    {
      failure: "a body that doesn't parse",
      answer: () => json({ unexpected: true }),
      text: "no se entiende",
    },
    {
      failure: "a timeout",
      answer: () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      text: "no respondió a tiempo",
    },
  ])("turns $failure from Nominatim into unknown findings", async (row) => {
    const { fetch } = fakeFetch({ search: row.answer });
    const findings = await createVenueChecks({ fetch, throttles })(
      eventAt(LAT, LON),
    );
    expect(findings.map((item) => item.finding.verdict)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(findings[0]?.finding.detail).toContain(row.text);
  });

  it("gives no confidence to the findings a failed lookup left unknown", async () => {
    const { fetch } = fakeFetch({ search: () => json({}, 503) });
    const findings = await createVenueChecks({ fetch, throttles })(
      eventAt(LAT, LON),
    );
    expect(findings.map((item) => item.finding.confidence)).toEqual([0, 0]);
  });

  it("keeps full confidence on the findings a lookup settled", async () => {
    const { fetch } = fakeFetch({
      search: () => json(nominatimHit({ capacity: "898" })),
    });
    const findings = await createVenueChecks({ fetch, throttles })(
      eventAt(LAT, LON),
    );
    expect(
      findings.map((item) => [item.finding.verdict, item.finding.confidence]),
    ).toEqual([
      ["pass", 1],
      ["pass", 1],
    ]);
  });

  it("says so when the reverse lookup fails after an empty name search", async () => {
    const { fetch } = fakeFetch({
      search: () => json([]),
      reverse: () => new Response("busy", { status: 504 }),
    });
    const [exists] = await createVenueChecks({ fetch, throttles })(
      eventAt(LAT, LON),
    );
    expect(exists?.finding.verdict).toBe("unknown");
    expect(exists?.finding.detail).toContain(
      "Tampoco se pudo comprobar qué hay en las coordenadas",
    );
  });
});

// A venue stored without coordinates (#74): only its name and address can
// find it, so the match has to agree on both.
describe("a venue without coordinates", () => {
  function eventWithoutCoordinates(): EventReviewContext {
    const context = structuredClone(fixtures.eventContext);
    if (context.venue === null) throw new Error("fixture without a venue");
    context.venue = {
      ...context.venue,
      name: "Sala Lumbre",
      city: "Medina del Campo",
      province: "Valladolid",
      latitude: null,
      longitude: null,
    };
    return context;
  }

  const lumbre = (overrides: Record<string, unknown> = {}) => ({
    osm_type: "way",
    osm_id: 7,
    lat: "41.31",
    lon: "-4.91",
    category: "amenity",
    type: "music_venue",
    name: "Sala Lumbre",
    display_name:
      "Sala Lumbre, Calle Mayor, Medina del Campo, Valladolid, Castilla y León, 47400, España",
    extratags: { capacity: "898" },
    ...overrides,
  });

  it("verifies it by name, city and province, with its OSM page as source", async () => {
    const { fetch, calls } = fakeFetch({ search: () => json([lumbre()]) });
    const [exists, capacity] = await createVenueChecks({ fetch, throttles })(
      eventWithoutCoordinates(),
    );

    expect(exists?.finding.verdict).toBe("pass");
    expect(exists?.finding.sources[0]?.url).toBe(
      "https://www.openstreetmap.org/way/7",
    );
    expect(capacity?.finding.verdict).toBe("pass");
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("q")).toBe(
      "Sala Lumbre, Medina del Campo, Valladolid",
    );
  });

  it.each([
    {
      miss: "another venue of the city",
      place: lumbre({ name: "Teatro Simón Ruiz" }),
    },
    {
      miss: "a namesake in another town",
      place: lumbre({
        display_name: "Sala Lumbre, Calle Real, Olmedo, Valladolid, España",
      }),
    },
    {
      miss: "a namesake that isn't a venue",
      place: lumbre({ category: "shop", type: "clothes" }),
    },
  ])("leaves it unknown when the search finds $miss", async (row) => {
    const { fetch, calls } = fakeFetch({ search: () => json([row.place]) });
    const [exists, capacity] = await createVenueChecks({ fetch, throttles })(
      eventWithoutCoordinates(),
    );

    expect(exists?.finding.verdict).toBe("unknown");
    expect(exists?.finding.detail).toContain("no guarda coordenadas");
    expect(capacity?.finding.verdict).toBe("unknown");
    // No point to look at: the reverse lookup is never asked.
    expect(calls).toHaveLength(1);
  });

  it("says so when the search times out", async () => {
    const { fetch } = fakeFetch({
      search: () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    const [exists] = await createVenueChecks({ fetch, throttles })(
      eventWithoutCoordinates(),
    );
    expect(exists?.finding.verdict).toBe("unknown");
    expect(exists?.finding.detail).toContain("no respondió a tiempo");
  });

  it("keeps the lookup of a venue with coordinates as it was", async () => {
    const context = eventWithoutCoordinates();
    if (context.venue === null) throw new Error("fixture without a venue");
    context.venue = { ...context.venue, latitude: 41.31, longitude: -4.91 };
    const { fetch, calls } = fakeFetch({ search: () => json([lumbre()]) });
    const [exists] = await createVenueChecks({ fetch, throttles })(context);

    expect(exists?.finding.verdict).toBe("pass");
    expect(exists?.finding.detail).toContain("de las coordenadas del evento");
    expect(new URL(calls[0]?.url ?? "").searchParams.get("q")).toBe(
      "Sala Lumbre, Medina del Campo",
    );
  });
});

describe("the web search fallback for capacity", () => {
  function counting(snippet: string): {
    search: WebSearch;
    queries: string[];
  } {
    const queries: string[] = [];
    return {
      queries,
      search: {
        provider: "fake",
        search: ({ query }) => {
          queries.push(query);
          return Promise.resolve([
            {
              url: "https://salas-ejemplo.test/teatro",
              title: "Teatro",
              snippet,
            },
          ]);
        },
      },
    };
  }

  it("searches only when neither Wikidata nor OSM publishes it", async () => {
    const { search, queries } = counting("Sala Lumbre: aforo de 300 personas.");
    const { fetch } = fakeFetch({ search: () => json(nominatimHit({})) });
    const [, capacity] = await createVenueChecks({ fetch, throttles, search })(
      eventAt(LAT, LON),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("aforo");
    expect(capacity?.finding.sources[0]?.url).toBe(
      "https://salas-ejemplo.test/teatro",
    );
  });

  it("doesn't search when OSM has the capacity", async () => {
    const { search, queries } = counting("irrelevante");
    const { fetch } = fakeFetch({
      search: () => json(nominatimHit({ capacity: "898" })),
    });
    await createVenueChecks({ fetch, throttles, search })(eventAt(LAT, LON));
    expect(queries).toEqual([]);
  });
});

describe("throttle", () => {
  it("spaces calls at least the interval apart, in order", async () => {
    let clock = 0;
    const starts: number[] = [];
    const throttle = createThrottle(1000, {
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });
    const task = () => {
      starts.push(clock);
      return Promise.resolve();
    };
    await Promise.all([throttle(task), throttle(task), throttle(task)]);
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it("keeps going after a failed call", async () => {
    const throttle = createThrottle(0);
    await expect(
      throttle(() => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    await expect(throttle(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
