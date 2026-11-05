// Checks the pass's JSON log line (#46): Cloud Logging reads `severity` for the
// entry's level, so each line carries it next to `level`. Fakes nothing.
import { describe, expect, it } from "vitest";

import { logLine } from "./log-line.js";

describe("logLine", () => {
  it("adds the Cloud Logging severity for each level", () => {
    expect(
      [
        logLine({ level: "info", event: "pass.done" }),
        logLine({ level: "warn", event: "run.failed" }),
        logLine({ level: "error", event: "pass.failed" }),
      ].map((line) => (JSON.parse(line) as { severity: string }).severity),
    ).toEqual(["INFO", "WARNING", "ERROR"]);
  });

  it("keeps every field of the entry on one line", () => {
    const line = logLine({
      correlationId: "c-1",
      level: "info",
      event: "pass.report",
      runs: 2,
    });

    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      severity: "INFO",
      correlationId: "c-1",
      level: "info",
      event: "pass.report",
      runs: 2,
    });
  });
});
