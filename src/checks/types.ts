import type { Finding } from "../satella-client/schemas.js";

/**
 * A finding computed in code, not by the model. `certainty` is what the
 * autonomy policy weighs (ADR 0012): a `rule` finding is a certain
 * inconsistency anyone can verify; a `heuristic` one crosses a threshold
 * that still needs a person's judgement.
 */
export interface SystemFinding {
  finding: Finding;
  certainty: "rule" | "heuristic";
}

export function systemFinding(
  certainty: SystemFinding["certainty"],
  check: string,
  verdict: Finding["verdict"],
  detail: string,
): SystemFinding {
  return {
    certainty,
    finding: { check, verdict, detail, confidence: 1, sources: [] },
  };
}
