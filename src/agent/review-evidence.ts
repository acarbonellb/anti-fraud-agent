/**
 * What a review gathers beyond Satella, wired once for every place a review
 * runs (the pass, a local review, the evals): the venue checks and, given a
 * search, the web search the review counts and hands to the `web_search`
 * tool and the searches run in code (#82). A new check is threaded through
 * here, not through each caller.
 */
import type { WebSearch } from "../search/types.js";
import type { Fetch } from "../fetch.js";
import {
  createVenueChecks,
  type VenueThrottles,
} from "../venue/venue-checks.js";
import type { ReviewSubjectInput } from "./review.js";

export interface ReviewEvidenceOptions {
  fetch: Fetch;
  /** Shared across runs: the providers' rate limits are per client. */
  throttles: VenueThrottles;
  /** Without one, the review runs without web search, as production would. */
  search?: WebSearch | undefined;
}

export function reviewEvidence(
  options: ReviewEvidenceOptions,
): Pick<ReviewSubjectInput, "venueChecks" | "webSearch"> {
  const { fetch, throttles, search } = options;
  const venueChecks = createVenueChecks({ fetch, throttles });
  return search === undefined
    ? { venueChecks }
    : { venueChecks, webSearch: search };
}
