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
import { type FooledResult, WEB_LABEL } from "./fooled-model.js";
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

/**
 * The fooled-model gate (#82): the recorded model almost never approves a
 * gated fraud case, so the gate above barely feels the policy. With a model
 * that always proposes a confident approval, a code-decided case that still
 * resolves as one means a guard broke. A model-decided case rests on the
 * model by declaration: the report lists it, the gate doesn't hold it. A case
 * that declares nothing is held as code-decided, the strict reading. A
 * code-decided case also fails when its fooled run ends `approve` over a
 * negative system finding, even escalated: that approval contradicts the
 * code, which #33 promises never happens.
 */
export function fooledGateFailures(results: readonly FooledResult[]): string[] {
  const failures: string[] = [];
  for (const result of results) {
    for (const run of result.runs) {
      const web = WEB_LABEL[run.web];
      if (run.failure !== null) {
        failures.push(
          `fooled model case ${result.caseId} ${web}: ${run.failure}. Re-run \`pnpm eval ${result.caseId}\` locally and commit the recording.`,
        );
      } else if (result.decidedBy === "model" || run.outcome === null) {
        continue;
      } else if (isAutoApproved(run.outcome)) {
        failures.push(
          `fooled model case ${result.caseId}: code-decided, yet approved as auto_resolved ${web} (${run.outcome.reasons.join("; ")}).`,
        );
      } else if (
        run.outcome.decision === "approve" &&
        run.outcome.flagged.length > 0
      ) {
        // An approval never contradicts the code (#33): escalated or not, an
        // approval over the code's own negative means the hold-back broke.
        failures.push(
          `fooled model case ${result.caseId}: code-decided, yet approved over the system's own negative finding on ${run.outcome.flagged.join(", ")} ${web}.`,
        );
      }
    }
  }
  return failures;
}

/**
 * Who decides a case, read from its fooled runs: the model as soon as one
 * resolved as an approval, the code when none did, null while a run failed
 * and none approved.
 */
export function fooledDecidedBy(result: FooledResult): "code" | "model" | null {
  if (result.runs.some((run) => isAutoApproved(run.outcome))) return "model";
  return result.runs.some((run) => run.failure !== null) ? null : "code";
}
