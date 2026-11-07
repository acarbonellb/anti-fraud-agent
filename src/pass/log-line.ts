import type { Subject } from "../satella-client/index.js";

/** Cloud Logging's names for the levels the pass logs (ADR 0018 point 9). */
const SEVERITY = { info: "INFO", warn: "WARNING", error: "ERROR" } as const;

/** What a log field can hold: never an object, which could carry Satella's data. */
export type LogScalar = string | number | boolean | null | undefined;

/** A subject as a log field: its type and id, and nothing it was copied from. */
type SubjectField<S> = S extends undefined
  ? undefined
  : S extends Subject
    ? Exclude<keyof S, keyof Subject> extends never
      ? S
      : never
    : never;

/**
 * Checks a log entry's fields against the "ids only" rule (CLAUDE.md §4,
 * #91): scalars, and the subject's type and id under `subject`. Used as
 * `line: T & LogFields<T>`, so any other field holding an object is a
 * compile error.
 */
export type LogFields<T> = {
  [K in keyof T]: K extends "subject" ? SubjectField<T[K]> : LogScalar;
};

/** A function that writes log lines of shape `Base`, fields checked. */
export type LogWriter<Base> = <
  T extends Base & Record<string, LogScalar | Subject>,
>(
  line: T & LogFields<T>,
) => void;

/** One entry as it reaches the sink: what `LogFields` let through. */
export type LogEntry = { level: keyof typeof SEVERITY; event: string } & Record<
  string,
  LogScalar | Subject
>;

/**
 * One log entry as the JSON line the pass writes to stdout. On Cloud Run,
 * Cloud Logging takes the entry's level from `severity`; `level` stays for
 * whoever reads the line locally.
 */
export function logLine(entry: LogEntry): string {
  return JSON.stringify({ severity: SEVERITY[entry.level], ...entry });
}
