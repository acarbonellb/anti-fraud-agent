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

  it("reads the day's budget in micro-dollars, $2 by default", () => {
    expect(loadConfig({}).dailyBudgetMicros).toBe(2_000_000);
    expect(
      loadConfig({ AGENT_DAILY_BUDGET_MICROS: "500000" }).dailyBudgetMicros,
    ).toBe(500_000);
    expect(() => loadConfig({ AGENT_DAILY_BUDGET_MICROS: "0.5" })).toThrow(
      ConfigError,
    );
  });

  it("keeps runs in memory unless a Firestore project is set", () => {
    expect(loadConfig({}).store).toEqual({
      firestoreProjectId: undefined,
      firestoreEmulatorHost: undefined,
    });
    expect(
      loadConfig({
        FIRESTORE_PROJECT_ID: "demo-agent",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      }).store,
    ).toEqual({
      firestoreProjectId: "demo-agent",
      firestoreEmulatorHost: "localhost:8080",
    });
  });

  it("has no Satella until both its origin and audience are set", () => {
    expect(loadConfig({}).satella).toBeUndefined();
    expect(
      loadConfig({
        SATELLA_STAGING_BASE_URL: "https://staging.example.test",
        SATELLA_AGENT_API_AUDIENCE: "https://staging.example.test",
      }).satella,
    ).toEqual({
      baseUrl: "https://staging.example.test",
      audience: "https://staging.example.test",
    });
  });

  it.each([
    { SATELLA_STAGING_BASE_URL: "https://staging.example.test" },
    { SATELLA_AGENT_API_AUDIENCE: "https://staging.example.test" },
  ])("fails at startup with half of Satella's config: %o", (env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it("rejects a Satella origin that isn't https", () => {
    expect(() =>
      loadConfig({
        SATELLA_STAGING_BASE_URL: "http://staging.example.test",
        SATELLA_AGENT_API_AUDIENCE: "https://staging.example.test",
      }),
    ).toThrow(ConfigError);
  });

  it("defaults to the local LM Studio model and the provisional threshold", () => {
    const config = loadConfig({});

    expect(config.autoApproveThreshold).toBe(0.85);
    expect(config.llm).toEqual({
      provider: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
      model: "qwen/qwen3.5-9b",
      apiKey: undefined,
      // Only anthropic takes an effort: none is sent, none is recorded.
      effort: null,
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

  it.each(["Anthropic", "openai", "lm-studio"])(
    "fails at startup on a provider it can't run: %s",
    (provider) => {
      // A typo used to fall through to the local adapter, sending the key
      // to AGENT_LLM_BASE_URL (#57).
      expect(() => loadConfig({ AGENT_LLM_PROVIDER: provider })).toThrow(
        ConfigError,
      );
    },
  );

  it("fails at startup when anthropic has no key", () => {
    expect(() => loadConfig({ AGENT_LLM_PROVIDER: "anthropic" })).toThrow(
      expect.objectContaining({
        issues: [{ variable: "AGENT_LLM_API_KEY", problem: "custom" }],
      }) as Error,
    );
  });

  it("reads a local server's own key, not the paid one", () => {
    const config = loadConfig({
      AGENT_LLM_PROVIDER: "ollama",
      AGENT_LLM_BASE_URL: "https://api.example.test/v1",
      AGENT_LLM_MODEL: "some-model",
      AGENT_LLM_LOCAL_API_KEY: "local-test",
      AGENT_LLM_API_KEY: "sk-ant-test",
      AGENT_AUTO_APPROVE_THRESHOLD: "0.9",
    });

    expect(config.llm.apiKey).toBe("local-test");
    expect(config.autoApproveThreshold).toBe(0.9);
  });

  it.each(["lmstudio", "ollama"])(
    "never hands the paid key to %s",
    (provider) => {
      // A .env that keeps a real key while pointing at a shared local server
      // would otherwise send it there (#89).
      const config = loadConfig({
        AGENT_LLM_PROVIDER: provider,
        AGENT_LLM_API_KEY: "sk-ant-test",
      });

      expect(config.llm.apiKey).toBeUndefined();
    },
  );

  it("gives anthropic the paid key and never the local one", () => {
    const config = loadConfig({
      AGENT_LLM_PROVIDER: "anthropic",
      AGENT_LLM_API_KEY: "sk-ant-test",
      AGENT_LLM_LOCAL_API_KEY: "local-test",
    });

    expect(config.llm.apiKey).toBe("sk-ant-test");
  });

  it("points anthropic at the public endpoint, not AGENT_LLM_BASE_URL", () => {
    // A local base URL left in .env must not receive the paid key (#89).
    const config = loadConfig({
      AGENT_LLM_PROVIDER: "anthropic",
      AGENT_LLM_API_KEY: "sk-ant-test",
      AGENT_LLM_BASE_URL: "http://localhost:1234/v1",
    });

    expect(config.llm.baseUrl).toBe("https://api.anthropic.com");
  });

  it("reads anthropic's base URL override", () => {
    const config = loadConfig({
      AGENT_LLM_PROVIDER: "anthropic",
      AGENT_LLM_API_KEY: "sk-ant-test",
      AGENT_LLM_ANTHROPIC_BASE_URL: "https://gateway.example.test",
    });

    expect(config.llm.baseUrl).toBe("https://gateway.example.test");
  });

  it.each([
    ["AGENT_AUTO_APPROVE_THRESHOLD", "1.5"],
    ["AGENT_LLM_BASE_URL", "ftp://example.test"],
    ["AGENT_LLM_EFFORT", "extreme"],
    // The paid key never travels in clear.
    ["AGENT_LLM_ANTHROPIC_BASE_URL", "http://gateway.example.test"],
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
