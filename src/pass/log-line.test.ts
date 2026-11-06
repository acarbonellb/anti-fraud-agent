// Checks the pass's JSON log line (#46): Cloud Logging reads `severity` for the
// entry's level, so each line carries it next to `level`; and that the pass's
// log fields take scalars, and the subject only under `subject` (#91), checked
// by the compiler through `@ts-expect-error`. Fakes nothing.
import { describe, expect, it } from "vitest";

import { type LogWriter, logLine } from "./log-line.js";

/** What the pass's `log` accepts, without a pass to run. */
const writeLine: LogWriter<object> = () => undefined;
const evt1 = { type: "event", id: "evt_0001" } as const;

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

describe("the pass's log fields", () => {
  it("take scalars, and the subject's type and id under `subject`", () => {
    expect(() => {
      writeLine({ subject: evt1, runs: 2, code: "X", transient: null });
    }).not.toThrow();
  });

  it("refuse an object, so no Satella data rides along", () => {
    // @ts-expect-error an array of runs is no id nor count
    writeLine({ runs: [{ runId: "run_1" }] });
    // @ts-expect-error an object is refused under any other name
    writeLine({ context: evt1 });
    // @ts-expect-error `subject` takes a subject, not any object
    writeLine({
      subject: { type: "event", id: "evt_0001", name: "Concierto" },
    });
  });

  it("refuse an object on the line written out", () => {
    // @ts-expect-error the pass report logs counts, not its runs
    logLine({ level: "info", event: "pass.report", runs: [{ runId: "r" }] });
  });
});
