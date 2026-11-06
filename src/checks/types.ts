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
