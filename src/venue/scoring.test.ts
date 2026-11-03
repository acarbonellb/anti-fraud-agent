// Checks how the venue checks score provider responses (ADR 0015 points 3
// and 4): verifyVenue's verdicts, where the capacity comes from, and the
// per-session ratio against it. Fakes nothing: the inputs are parsed provider
// responses written as literals.
import { describe, expect, it } from "vitest";

import type { Place, PointPlace } from "./nominatim.js";
import {
  scoreCapacity,
  scoreVenue,
  type VenueToVerify,
  verifiedMatch,
} from "./scoring.js";

const venue: VenueToVerify = {
  name: "Sala Ejemplo",
  city: "Granada",
  country: "ES",
  latitude: 37.1751633,
  longitude: -3.5987706,
};

function place(overrides: Partial<Place> = {}): Place {
  return {
    osmType: "node",
    osmId: 42,
    latitude: venue.latitude ?? 0,
    longitude: venue.longitude ?? 0,
    category: "amenity",
    type: "pub",
    name: "Sala Ejemplo",
    tags: {},
    ...overrides,
  };
}

const ok = <T>(value: T) => ({ ok: true as const, value });
const at = (overrides: Partial<PointPlace>): PointPlace => ({
  osmType: "way",
  osmId: 7,
  category: "highway",
  type: "residential",
  locality: "Granada",
  ...overrides,
});
const onLand = at({});

describe("verifyVenue", () => {
  it("passes a venue found by name with a venue type next to the coordinates", () => {
    const { finding } = scoreVenue({
      venue,
      places: ok([place({ latitude: 37.1752 })]),
      point: null,
    });
    expect(finding.verdict).toBe("pass");
    expect(finding.detail).toContain("amenity=pub");
    expect(finding.sources[0]?.url).toBe(
      "https://www.openstreetmap.org/node/42",
    );
    expect(finding.sources[0]?.title).toContain("ODbL");
  });

  it("doesn't pass a place found by name that isn't a venue", () => {
    const places = [place({ category: "highway", type: "bus_stop" })];
    const { finding } = scoreVenue({
      venue,
      places: ok(places),
      point: ok(onLand),
    });
    expect(finding.verdict).toBe("unknown");
  });

  it("leaves a venue found too far from the coordinates unverified", () => {
    // About 1.1 km north.
    const far = place({ latitude: 37.1851633 });
    expect(verifiedMatch(venue, [far])).toBeNull();
    const { finding } = scoreVenue({
      venue,
      places: ok([far]),
      point: ok(onLand),
    });
    expect(finding.verdict).toBe("unknown");
    expect(finding.detail).toContain("1,1 km");
  });

  it("is unknown when the venue isn't found and the point looks ordinary", () => {
    const { finding } = scoreVenue({
      venue,
      places: ok([]),
      point: ok(onLand),
    });
    expect(finding.verdict).toBe("unknown");
    expect(finding.detail).toContain("no tiene ningún recinto «Sala Ejemplo»");
  });

  it("fails, as a heuristic, when the coordinates stand on a residential building", () => {
    const result = scoreVenue({
      venue,
      places: ok([]),
      point: ok(at({ category: "building", type: "apartments" })),
    });
    expect(result.certainty).toBe("heuristic");
    expect(result.finding.verdict).toBe("fail");
    expect(result.finding.detail).toContain("building=apartments");
    expect(result.finding.sources[0]?.url).toBe(
      "https://www.openstreetmap.org/way/7",
    );
  });

  it("doesn't fail on a building that isn't residential", () => {
    const { finding } = scoreVenue({
      venue,
      places: ok([]),
      point: ok(at({ category: "building", type: "commercial" })),
    });
    expect(finding.verdict).toBe("unknown");
  });

  it.each([
    [
      "outside every municipality, at sea",
      at({ category: "boundary", type: "administrative", locality: null }),
      "en el mar",
    ],
    [
      "on a body of water",
      at({ category: "natural", type: "water" }),
      "sobre una masa de agua",
    ],
  ])("fails when the coordinates fall %s", (_, point, text) => {
    const { finding } = scoreVenue({ venue, places: ok([]), point: ok(point) });
    expect(finding.verdict).toBe("fail");
    expect(finding.detail).toContain(text);
  });

  it("doesn't read the sea into a missing municipality outside Spain", () => {
    const { finding } = scoreVenue({
      venue: { ...venue, country: "PT" },
      places: ok([]),
      point: ok(at({ category: "boundary", locality: null })),
    });
    expect(finding.verdict).toBe("unknown");
  });

  it("stays unknown when Nominatim finds nothing at the point", () => {
    const { finding } = scoreVenue({ venue, places: ok([]), point: ok(null) });
    expect(finding.verdict).toBe("unknown");
  });

  it("says which provider failed and stays unknown", () => {
    const { finding } = scoreVenue({
      venue,
      places: { ok: false, provider: "nominatim", failure: "rate_limited" },
      point: null,
    });
    expect(finding.verdict).toBe("unknown");
    expect(finding.detail).toContain("Nominatim");
    expect(finding.detail).toContain("429");
  });
});

describe("estimateVenueCapacity", () => {
  const match = (tags: Record<string, string>) => ({
    place: place({ tags }),
    distanceM: 5,
  });

  it("takes Wikidata's capacity before the OSM tag", () => {
    const { finding } = scoreCapacity({
      venue,
      match: match({ wikidata: "Q1", capacity: "50" }),
      wikidata: ok(400),
      web: null,
      maxTicketsOnSale: 350,
    });
    expect(finding.verdict).toBe("pass");
    expect(finding.sources).toEqual([
      { url: "https://www.wikidata.org/wiki/Q1", title: "Wikidata (Q1, CC0)" },
    ]);
  });

  it("falls back to the OSM capacity tag", () => {
    const { finding } = scoreCapacity({
      venue,
      match: match({ capacity: "400" }),
      wikidata: null,
      web: null,
      maxTicketsOnSale: 350,
    });
    expect(finding.verdict).toBe("pass");
    expect(finding.sources[0]?.url).toBe(
      "https://www.openstreetmap.org/node/42",
    );
  });

  it("falls back to the OSM tag when Wikidata has no capacity or fails", () => {
    for (const wikidata of [
      ok(null),
      {
        ok: false as const,
        provider: "wikidata" as const,
        failure: "timeout" as const,
      },
    ]) {
      const { finding } = scoreCapacity({
        venue,
        match: match({ wikidata: "Q1", capacity: "400" }),
        wikidata,
        web: null,
        maxTicketsOnSale: 350,
      });
      expect(finding.verdict).toBe("pass");
    }
  });

  it("is unknown when neither publishes it", () => {
    const { finding } = scoreCapacity({
      venue,
      match: match({}),
      wikidata: null,
      web: null,
      maxTicketsOnSale: 80,
    });
    expect(finding.check).toBe("venue_capacity");
    expect(finding.verdict).toBe("unknown");
  });

  it("is unknown for a venue that isn't verified", () => {
    const { finding } = scoreCapacity({
      venue,
      match: null,
      wikidata: null,
      web: null,
      maxTicketsOnSale: 80,
    });
    expect(finding.verdict).toBe("unknown");
  });

  it.each([
    { tickets: 400, check: "venue_capacity", verdict: "pass" },
    { tickets: 401, check: "venue_capacity", verdict: "warn" },
    { tickets: 799, check: "venue_capacity", verdict: "warn" },
    { tickets: 800, check: "capacity_far_above_venue", verdict: "fail" },
  ])(
    "compares $tickets tickets with a capacity of 400: $verdict",
    ({ tickets, check, verdict }) => {
      const { finding } = scoreCapacity({
        venue,
        match: match({ capacity: "400" }),
        wikidata: null,
        web: null,
        maxTicketsOnSale: tickets,
      });
      expect(finding.check).toBe(check);
      expect(finding.verdict).toBe(verdict);
    },
  );

  describe("from the web, the last resort", () => {
    const result = (title: string, snippet: string) => ({
      url: "https://salas-ejemplo.test/sala-ejemplo",
      title,
      snippet,
    });
    const fromWeb = (results: ReturnType<typeof result>[]) =>
      scoreCapacity({
        venue,
        match: match({}),
        wikidata: null,
        web: { ok: true, results },
        maxTicketsOnSale: 350,
      }).finding;

    it.each([
      "Sala Ejemplo tiene un aforo de 400 personas.",
      "Sala Ejemplo · Aforo: 400",
      "Capacidad para 1.200 espectadores en Sala Ejemplo.",
    ])("reads a capacity next to a unit or after «aforo»: %s", (snippet) => {
      const finding = fromWeb([result("Sala Ejemplo", snippet)]);
      expect(finding.verdict).toBe("pass");
      expect(finding.sources[0]?.url).toBe(
        "https://salas-ejemplo.test/sala-ejemplo",
      );
      expect(finding.detail).toContain("la web (salas-ejemplo.test)");
    });

    it.each([
      ["a page about another venue", "Otra Sala", "Aforo de 400 personas."],
      ["a year next to «aforo»", "Sala Ejemplo", "Aforo ampliado en 2019."],
      ["no number at all", "Sala Ejemplo", "Aforo reducido, reserva ya."],
    ])("ignores %s", (_, title, snippet) => {
      expect(fromWeb([result(title, snippet)]).verdict).toBe("unknown");
    });

    it("prefers Wikidata and OSM over the web", () => {
      const { finding } = scoreCapacity({
        venue,
        match: match({ capacity: "100" }),
        wikidata: null,
        web: {
          ok: true,
          results: [result("Sala Ejemplo", "Aforo de 5.000 personas.")],
        },
        maxTicketsOnSale: 350,
      });
      expect(finding.verdict).toBe("fail");
    });

    it("says when the search failed", () => {
      const { finding } = scoreCapacity({
        venue,
        match: match({}),
        wikidata: null,
        web: { ok: false, failure: "quota_exceeded" },
        maxTicketsOnSale: 350,
      });
      expect(finding.verdict).toBe("unknown");
      expect(finding.detail).toContain("la búsqueda web falló");
    });
  });

  it("names the ratio, the capacity and its source in the detail", () => {
    const { finding } = scoreCapacity({
      venue,
      match: match({ capacity: "140" }),
      wikidata: null,
      web: null,
      maxTicketsOnSale: 2000,
    });
    expect(finding.detail).toBe(
      "Señal grave de aforo: la sesión con más entradas pone a la venta 2.000, 14,3 veces el aforo de 140 que publica OpenStreetMap (© colaboradores de OpenStreetMap, ODbL) (umbral: 2 veces).",
    );
  });
});
