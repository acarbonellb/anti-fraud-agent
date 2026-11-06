/**
 * What the venue providers (Nominatim, Wikidata) share: the slice
 * of `fetch` they use, the fixed `User-Agent` and the mapping of every
 * failure to one typed error. The checks turn that error into an `unknown`
 * finding, never into a pass (ADR 0015 point 2).
 */
import { DomainError } from "../errors.js";
import type { Fetch } from "../fetch.js";

/**
 * Identifies the application, as the Nominatim usage policy asks
 * (https://operations.osmfoundation.org/policies/nominatim/). No email and no
 * personal data: the repo URL is the contact (ADR 0015 point 8).
 */
export const USER_AGENT =
  "anti-fraud-agent/0.1 (+https://github.com/acarbonellb/anti-fraud-agent)";

/** Per request. A slow provider yields `unknown`; it never holds a review. */
export const PROVIDER_TIMEOUT_MS = 10_000;

export type VenueProvider = "nominatim" | "wikidata";

export type ProviderFailure =
  "timeout" | "rate_limited" | "http_error" | "network" | "invalid_response";

export class VenueProviderError extends DomainError {
  readonly code = "VENUE_PROVIDER_FAILED";

  constructor(
    readonly provider: VenueProvider,
    readonly failure: ProviderFailure,
    options?: ErrorOptions,
  ) {
    super(`${provider} failed: ${failure}`, options);
  }
}

export interface JsonRequest {
  provider: VenueProvider;
  url: string;
  timeoutMs?: number;
}

/**
 * One attempt, no retries: a `429` or a timeout is reported, not retried, so
 * a provider in trouble costs one request per check (ADR 0015 point 2).
 */
export async function requestJson(
  doFetch: Fetch,
  request: JsonRequest,
): Promise<unknown> {
  const { provider } = request;
  let response: Response;
  try {
    response = await doFetch(request.url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(request.timeoutMs ?? PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    // A typed error from below (a stale eval recording) isn't the
    // provider's failure: it must surface, not become `unknown`.
    if (error instanceof DomainError) throw error;
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new VenueProviderError(provider, timedOut ? "timeout" : "network", {
      cause: error,
    });
  }
  if (response.status === 429) {
    throw new VenueProviderError(provider, "rate_limited");
  }
  if (!response.ok) throw new VenueProviderError(provider, "http_error");
  try {
    const body: unknown = await response.json();
    return body;
  } catch (error) {
    throw new VenueProviderError(provider, "invalid_response", {
      cause: error,
    });
  }
}
