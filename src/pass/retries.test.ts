// Checks which failed reviews count as able to pass, and so are tried again
// (#57). Fakes nothing: the errors are built as the clients throw them.
import { describe, expect, it } from "vitest";

import { ProviderError } from "../providers/types.js";
import { SatellaApiError } from "../satella-client/errors.js";
import { isTransient } from "./retries.js";

describe("isTransient", () => {
  it.each([
    [
      "a model that can't be reached",
      new ProviderError("LLM_UNAVAILABLE", "anthropic"),
    ],
    [
      "a rate-limited model",
      new ProviderError("LLM_HTTP_ERROR", "anthropic", 429),
    ],
    [
      "an overloaded model",
      new ProviderError("LLM_HTTP_ERROR", "anthropic", 529),
    ],
    [
      "Satella down or timed out",
      new SatellaApiError("SATELLA_UNAVAILABLE", "getFeed", null),
    ],
    [
      "a rate-limited Satella",
      new SatellaApiError("SATELLA_RATE_LIMITED", "getFeed", 429),
    ],
  ])("tries again after %s", (_, error) => {
    expect(isTransient(error)).toBe(true);
  });

  it.each([
    [
      "a request the model refuses",
      new ProviderError("LLM_HTTP_ERROR", "anthropic", 400),
    ],
    [
      "a model answer that doesn't parse",
      new ProviderError("LLM_BAD_RESPONSE", "anthropic"),
    ],
    [
      "a forbidden Satella call",
      new SatellaApiError("SATELLA_FORBIDDEN", "getEventReviewContext", 403),
    ],
    [
      "a subject Satella doesn't have",
      new SatellaApiError("SATELLA_NOT_FOUND", "getEventReviewContext", 404),
    ],
    ["a bug", new TypeError("x is undefined")],
  ])("doesn't try again after %s", (_, error) => {
    expect(isTransient(error)).toBe(false);
  });
});
