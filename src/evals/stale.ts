import { DomainError } from "../errors.js";

export type StaleReason =
  | "missing_recording"
  | "prompt_version"
  | "request_changed"
  | "missing_step"
  // A tool request with no recorded response: changed, or never recorded.
  | "missing_tool_response";

/** The recording no longer matches what the code sends: re-run `pnpm eval`. */
export class StaleRecordingError extends DomainError {
  readonly code = "EVAL_STALE";

  constructor(
    readonly reason: StaleReason,
    readonly step: number | null = null,
  ) {
    super(
      `Stale recording: ${reason}` +
        (step === null ? "" : ` at call ${String(step + 1)}`),
    );
  }
}
