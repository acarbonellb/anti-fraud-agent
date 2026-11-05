/**
 * What makes `pnpm eval:replay --check` fail in CI (#6). Recordings that no
 * longer apply, and any fraud among the gated cases approved without
 * reaching the admin, block a PR. Approved fraud that the policy escalated
 * is a model-quality number in the report, not a gate: in Satella only
 * `approve` + `auto_resolved` skips the admin (ADR 0012).
 *
 * With repeated runs a case fails when any of its runs auto-approved it
 * (#57). Majorities suit the reported metrics, where one run is noise; for the
 * one outcome that skips the admin, one run in three is a rate, not noise.
 */
import { isAutoApproved } from "./metrics.js";
import type { ReportSet } from "./report.js";
import { byCase } from "./runs.js";
import type { CaseResult } from "./types.js";

export function gateFailures(sets: readonly ReportSet[]): string[] {
  const failures: string[] = [];
  for (const set of sets) {
    const name = `${set.provider}/${set.model}`;
    const several = set.runs.length > 1;
    set.runs.forEach((results, index) => {
      const run = several ? ` run ${String(index + 1)}` : "";
      for (const result of results) {
        if (result.failure !== null) {
          failures.push(
            `${name} case ${result.caseId}${run}: ${result.failure}. Re-run \`pnpm eval ${result.caseId}\` locally and commit the recording.`,
          );
        }
      }
    });
    for (const results of byCase(set.runs)) {
      const [first] = results;
      if (first === undefined || !first.problem || first.external) continue;
      if (results.some(autoApproved)) {
        const count = results.filter(autoApproved).length;
        failures.push(
          `${name} case ${first.caseId}: fraud approved as auto_resolved in ${String(count)}/${String(results.length)} runs.`,
        );
      }
    }
  }
  return failures;
}

function autoApproved(result: CaseResult): boolean {
  return isAutoApproved(result.outcome);
}
