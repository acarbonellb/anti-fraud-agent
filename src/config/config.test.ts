// Checks that loadConfig turns an env map into typed config with defaults and
// rejects bad values with a typed error that names the variable without
// leaking its value. Fakes nothing: the env is a plain object.
import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies the default run limits when nothing is set", () => {
    expect(loadConfig({}).runLimits).toEqual({
      maxToolCalls: 30,
      maxTokens: 200_000,
      maxWebSearches: 10,
    });
  });

  it("treats an empty value as unset", () => {
    expect(loadConfig({ AGENT_MAX_TOKENS: "" }).runLimits.maxTokens).toBe(
      200_000,
    );
  });

  it("reads run limits from the environment as integers", () => {
    const config = loadConfig({
      AGENT_MAX_TOOL_CALLS: "5",
      AGENT_MAX_TOKENS: "1000",
      AGENT_MAX_WEB_SEARCHES: "2",
    });

    expect(config.runLimits).toEqual({
      maxToolCalls: 5,
      maxTokens: 1000,
      maxWebSearches: 2,
    });
  });

  it.each(["0", "-3", "1.5", "lots"])("rejects %s as a run limit", (value) => {
    expect(() => loadConfig({ AGENT_MAX_TOOL_CALLS: value })).toThrow(
      ConfigError,
    );
  });

  it("names every invalid variable and never echoes its value", () => {
    const secretLooking = "sk-not-a-number-123";
    let error: unknown;
    try {
      loadConfig({
        AGENT_MAX_TOOL_CALLS: secretLooking,
        AGENT_MAX_WEB_SEARCHES: "0",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.code).toBe("CONFIG_INVALID");
    expect(configError.issues.map((issue) => issue.variable)).toEqual([
      "AGENT_MAX_TOOL_CALLS",
      "AGENT_MAX_WEB_SEARCHES",
    ]);
    expect(configError.message).not.toContain(secretLooking);
  });
});
