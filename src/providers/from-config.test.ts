// Checks the provider factory's refusal: a config that names anthropic without
// its key fails with a stable code the pass can log, not a plain error. Fakes
// nothing: no request is made.
import { describe, expect, it } from "vitest";

import { caughtCode } from "../test-support/caught-code.js";
import { createConfiguredProvider } from "./from-config.js";

describe("createConfiguredProvider", () => {
  it("refuses anthropic without a key with a domain error", async () => {
    const code = await caughtCode(() =>
      createConfiguredProvider({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-haiku-5-5",
        apiKey: undefined,
        effort: "medium",
      }),
    );

    expect(code).toBe("LLM_KEY_MISSING");
  });
});
