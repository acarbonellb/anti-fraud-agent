// Checks the provider factory's refusal: a config that names anthropic without
// its key fails with a stable code the pass can log, not a plain error. Fakes
// nothing: no request is made.
import { describe, expect, it } from "vitest";

import { DomainError } from "../errors.js";
import { createConfiguredProvider } from "./from-config.js";

describe("createConfiguredProvider", () => {
  it("refuses anthropic without a key with a domain error", () => {
    let error: unknown;
    try {
      createConfiguredProvider({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-haiku-5-5",
        apiKey: undefined,
        effort: "medium",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "LLM_KEY_MISSING" });
  });
});
