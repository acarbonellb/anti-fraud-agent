// Checks the price heuristic against Satella's benchmark: the query it sends,
// the 3× p90 threshold on both sides, and `unknown` when the sample is too
// small or Satella can't be asked. Pure function over the fictitious fixture;
// fakes nothing.
import { describe, expect, it } from "vitest";

import { fixtures } from "../satella-client/fixtures.js";
import type {
  EventReviewContext,
  PriceBenchmark,
} from "../satella-client/schemas.js";
import {
  benchmarkQuery,
  PRICE_OUTLIER_FACTOR,
  priceBenchmarkCheck,
} from "./price-benchmark.js";

const benchmark: PriceBenchmark = {
  sampleSize: 42,
  p10Cents: 1000,
  p50Cents: 1800,
  p90Cents: 3500,
  maxCents: 8000,
};

function priced(priceCents: number): EventReviewContext {
  const context = structuredClone(fixtures.eventContext);
  for (const session of context.sessions) {
    for (const ticketType of session.ticketTypes) {
      ticketType.priceCents = priceCents;
    }
  }
  return context;
}

describe("price against the benchmark", () => {
  it("asks for the event's genre, province and capacity band", () => {
    const context = fixtures.eventContext;
    expect(benchmarkQuery(context)).toEqual({
      genre: context.event.genre,
      province: context.venue?.province,
      capacityBand: "lt300",
    });
  });

  it.each([
    [PRICE_OUTLIER_FACTOR * 3500, "pass"],
    [PRICE_OUTLIER_FACTOR * 3500 + 1, "warn"],
  ])("rates %i cents against a p90 of 3500: %s", (price, verdict) => {
    const result = priceBenchmarkCheck(priced(price), benchmark);
    expect(result.certainty).toBe("heuristic");
    expect(result.finding.check).toBe("price_benchmark");
    expect(result.finding.verdict).toBe(verdict);
  });

  it("names the ticket, the factor and the threshold", () => {
    const { finding } = priceBenchmarkCheck(priced(95_000), benchmark);
    expect(finding.detail).toContain(
      "cuesta 950,00 €, 27,1 veces el p90 (35,00 €)",
    );
    expect(finding.detail).toContain("umbral: 3 veces");
  });

  it("is unknown with too small a sample", () => {
    const thin = { ...benchmark, sampleSize: 3, p90Cents: null };
    expect(priceBenchmarkCheck(priced(95_000), thin).finding.verdict).toBe(
      "unknown",
    );
  });

  it("is unknown when Satella couldn't be asked", () => {
    expect(priceBenchmarkCheck(priced(95_000), null).finding.verdict).toBe(
      "unknown",
    );
  });
});
