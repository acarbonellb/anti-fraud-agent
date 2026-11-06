// The spend module's rule for a hold that expires unsettled (ADR 0017,
// amendment of #88), on plain entries. Fakes nothing: the rule is pure.
import { describe, expect, it } from "vitest";

import { chargeExpired } from "./spend.js";

const NOW = new Date("2026-11-05T10:15:00.000Z");

describe("chargeExpired", () => {
  it("settles an expired hold at its reserved amount and leaves the rest", () => {
    expect(
      chargeExpired(
        {
          run_crashed: { micros: 4_000, expiresAt: "2026-11-05T10:15:00.000Z" },
          run_live: { micros: 3_000, expiresAt: "2026-11-05T10:15:00.001Z" },
          run_done: { micros: 1_500, expiresAt: null },
        },
        NOW,
      ),
    ).toEqual({
      run_crashed: { micros: 4_000, expiresAt: null },
      run_live: { micros: 3_000, expiresAt: "2026-11-05T10:15:00.001Z" },
      run_done: { micros: 1_500, expiresAt: null },
    });
  });

  it("has nothing to write when no hold has expired", () => {
    expect(
      chargeExpired(
        {
          run_live: { micros: 3_000, expiresAt: "2026-11-05T10:20:00.000Z" },
          run_done: { micros: 1_500, expiresAt: null },
        },
        NOW,
      ),
    ).toBeNull();
  });
});
