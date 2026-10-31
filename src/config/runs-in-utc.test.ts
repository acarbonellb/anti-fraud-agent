// Guards CLAUDE.md §5: the suite runs with TZ=UTC (set in vitest.config.ts),
// so a local-time leak fails here first instead of passing on a machine in
// Europe/Madrid. Fakes nothing.
import { expect, it } from "vitest";

it("runs the test suite in UTC", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  expect(new Date("2026-07-01T12:00:00Z").getTimezoneOffset()).toBe(0);
});
