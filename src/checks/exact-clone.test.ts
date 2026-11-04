// Checks the exact-clone rule against Satella's similar events: a match on
// title, venue and Madrid day fails as a hard signal, anything less gives no
// finding at all. Pure function over the fictitious fixture; fakes nothing.
import { describe, expect, it } from "vitest";

import { fixtures } from "../satella-client/fixtures.js";
import type { SimilarEvent } from "../satella-client/schemas.js";
import { exactCloneCheck } from "./exact-clone.js";

// The fixture's only session starts 2026-11-20T20:00Z: 21:00 in Madrid.
const clone: SimilarEvent = {
  id: "evt_0099",
  slug: "noche-de-jazz-en-sala-lumbre",
  title: "Noche de jazz en Sala Lumbre",
  firstSessionInWindow: "2026-11-20T19:00:00.000Z",
  venueName: "Sala Lumbre",
  titleSimilarity: 1,
  sharesVenueName: true,
};

describe("exact clone of another organizer's event", () => {
  it("fails as a rule when title, venue and day all match", () => {
    const [finding] = exactCloneCheck(fixtures.eventContext, [clone]);
    expect(finding?.certainty).toBe("rule");
    expect(finding?.finding).toMatchObject({
      check: "exact_duplicate_other_organizer",
      verdict: "fail",
    });
    expect(finding?.finding.detail).toContain("Noche de jazz en Sala Lumbre");
    expect(finding?.finding.detail).toContain("20/11/2026");
  });

  it.each([
    ["a title that is only similar", { titleSimilarity: 0.92 }],
    ["another venue", { sharesVenueName: false }],
    ["another day", { firstSessionInWindow: "2026-11-21T19:00:00.000Z" }],
  ])("gives no finding for %s", (_, change) => {
    expect(
      exactCloneCheck(fixtures.eventContext, [{ ...clone, ...change }]),
    ).toEqual([]);
  });

  it("compares days in Madrid, not in UTC", () => {
    // 23:30 UTC on the 19th is already the 20th in Madrid.
    const lateNight = {
      ...clone,
      firstSessionInWindow: "2026-11-19T23:30:00.000Z",
    };
    expect(exactCloneCheck(fixtures.eventContext, [lateNight])).toHaveLength(1);
  });
});
