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
      maxWebSearches: 4,
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

  it("defaults to the local LM Studio model and the provisional threshold", () => {
    const config = loadConfig({});

    expect(config.autoApproveThreshold).toBe(0.85);
    expect(config.llm).toEqual({
      provider: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
      model: "qwen/qwen3.5-9b",
      apiKey: undefined,
      effort: "medium",
    });
  });

  it("reads Claude's effort", () => {
    const config = loadConfig({
      AGENT_LLM_PROVIDER: "anthropic",
      AGENT_LLM_MODEL: "claude-haiku-5-5",
      AGENT_LLM_API_KEY: "sk-ant-test",
      AGENT_LLM_EFFORT: "low",
    });

    expect(config.llm).toMatchObject({ provider: "anthropic", effort: "low" });
  });

  it("fails at startup when anthropic has no key", () => {
    expect(() => loadConfig({ AGENT_LLM_PROVIDER: "anthropic" })).toThrow(
      expect.objectContaining({
        issues: [{ variable: "AGENT_LLM_API_KEY", problem: "custom" }],
      }) as Error,
    );
  });

  it("reads the model and its key from the environment", () => {
    const config = loadConfig({
      AGENT_LLM_PROVIDER: "openai",
      AGENT_LLM_BASE_URL: "https://api.example.test/v1",
      AGENT_LLM_MODEL: "some-model",
      AGENT_LLM_API_KEY: "sk-test",
      AGENT_AUTO_APPROVE_THRESHOLD: "0.9",
    });

    expect(config.llm.apiKey).toBe("sk-test");
    expect(config.autoApproveThreshold).toBe(0.9);
  });

  it.each([
    ["AGENT_AUTO_APPROVE_THRESHOLD", "1.5"],
    ["AGENT_LLM_BASE_URL", "ftp://example.test"],
    ["AGENT_LLM_EFFORT", "extreme"],
  ])("rejects %s=%s", (variable, value) => {
    expect(() => loadConfig({ [variable]: value })).toThrow(ConfigError);
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
