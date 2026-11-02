/**
 * What makes `pnpm eval:replay --check` fail in CI (#6). Recordings that no
 * longer apply, and any fraud among the gated cases approved without
 * reaching the admin, block a PR. Approved fraud that the policy escalated
 * is a model-quality number in the report, not a gate: in Satella only
 * `approve` + `auto_resolved` skips the admin (ADR 0012).
 */
import { computeMetrics } from "./metrics.js";
import { percent, type ReportSet } from "./report.js";

export function gateFailures(sets: readonly ReportSet[]): string[] {
  const failures: string[] = [];
  for (const set of sets) {
    const name = `${set.provider}/${set.model}`;
    for (const result of set.results) {
      if (result.failure !== null) {
        failures.push(
          `${name} case ${result.caseId}: ${result.failure}. Re-run \`pnpm eval ${result.caseId}\` locally and commit the recording.`,
        );
      }
    }
    const { autoApprovedFraudRate } = computeMetrics(set.results, {
      includeExternal: false,
    });
    if (autoApprovedFraudRate !== null && autoApprovedFraudRate > 0) {
      failures.push(
        `${name}: auto-approved fraud rate of the gated cases is ${percent(autoApprovedFraudRate)}, above 0.`,
      );
    }
  }
  return failures;
}
