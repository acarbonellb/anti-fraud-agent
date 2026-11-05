/** Cloud Logging's names for the levels the pass logs (ADR 0018 point 9). */
const SEVERITY = { info: "INFO", warn: "WARNING", error: "ERROR" } as const;

/**
 * One log entry as the JSON line the pass writes to stdout. On Cloud Run,
 * Cloud Logging takes the entry's level from `severity`; `level` stays for
 * whoever reads the line locally.
 */
export function logLine(
  entry: { level: keyof typeof SEVERITY } & Record<string, unknown>,
): string {
  return JSON.stringify({ severity: SEVERITY[entry.level], ...entry });
}
