/**
 * What a review gathers beyond Satella, wired once for every place a review
 * runs (the pass, a local review, the evals): the venue checks and, given a
 * search, the `web_search` tool and the searches run in code. A new check is
 * threaded through here, not through each caller.
 */
import type { WebSearch } from "../search/types.js";
import type { Fetch } from "../fetch.js";
import {
  createVenueChecks,
  type VenueThrottles,
} from "../venue/venue-checks.js";
import type { ReviewSubjectInput } from "./review.js";
import { webSearchTool } from "./web-search-tool.js";

export interface ReviewEvidenceOptions {
  fetch: Fetch;
  /** Shared across runs: the providers' rate limits are per client. */
  throttles: VenueThrottles;
  /** Without one, the review runs without web search, as production would. */
  search?: WebSearch | undefined;
}

export function reviewEvidence(
  options: ReviewEvidenceOptions,
): Pick<ReviewSubjectInput, "venueChecks" | "extraTools" | "webSearch"> {
  const { fetch, throttles, search } = options;
  if (search === undefined) {
    return {
      venueChecks: createVenueChecks({ fetch, throttles }),
      extraTools: [],
    };
  }
  return {
    venueChecks: createVenueChecks({ fetch, throttles, search }),
    extraTools: [webSearchTool(search)],
    webSearch: search,
  };
}
