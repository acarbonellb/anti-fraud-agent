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
  /**
   * Other checks this finding settles, when one check can end under several
   * names (the capacity check ends as `venue_capacity` or
   * `capacity_far_above_venue`). A model finding on any of them is dropped.
   */
  covers?: readonly string[];
  /**
   * The verified venue's OpenStreetMap `category=type` (e.g. `leisure=park`),
   * carried by the capacity finding: the policy picks the exposure cap by it
   * (ADR 0015, amendment of #78). Absent when the venue isn't verified.
   */
  venueType?: string;
}

/**
 * How sure a check in code is of its verdict. A computed check is certain of
 * what it found, but one with no data reached no verdict to be sure of: the
 * admin mustn't read "100 %" next to "sin datos" (#75). One rule for every
 * check, not a value per check. The policy reads the verdict, not this.
 */
export function systemConfidence(verdict: Finding["verdict"]): number {
  return verdict === "unknown" ? 0 : 1;
}

export function systemFinding(
  certainty: SystemFinding["certainty"],
  check: string,
  verdict: Finding["verdict"],
  detail: string,
): SystemFinding {
  return {
    certainty,
    finding: {
      check,
      verdict,
      detail,
      confidence: systemConfidence(verdict),
      sources: [],
    },
  };
}
