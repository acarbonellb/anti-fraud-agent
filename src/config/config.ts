import { z } from "zod";

import { DomainError } from "../errors.js";
import type { Effort } from "../providers/anthropic/adapter.js";

// An empty value in .env (`AGENT_MAX_TOKENS=`) means "unset", so it falls back
// to the default instead of failing as 0.
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);

const positiveIntWithDefault = (fallback: number) =>
  z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().positive().default(fallback),
  );

/** `anthropic` through its SDK; the local ones through the OpenAI-compatible adapter. */
export const LLM_PROVIDERS = ["lmstudio", "ollama", "anthropic"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

const textWithDefault = (fallback: string) =>
  z.preprocess(unsetIfEmpty, z.string().min(1).default(fallback));

// Names mirror .env.example (env-var skill). Run limits: brief §4.2; the
// defaults are provisional until the agent loop (#5) measures real runs.
const envSchema = z
  .object({
    AGENT_MAX_TOOL_CALLS: positiveIntWithDefault(30),
    AGENT_MAX_TOKENS: positiveIntWithDefault(200_000),
    AGENT_MAX_WEB_SEARCHES: positiveIntWithDefault(4),
    // Brief §4.2; set from the evals once they exist (#6).
    AGENT_AUTO_APPROVE_THRESHOLD: z.preprocess(
      unsetIfEmpty,
      z.coerce.number().min(0).max(1).default(0.85),
    ),
    // Phase 1 runs a local open-source model through an OpenAI-compatible
    // server (ADR 0008); the defaults point at LM Studio on this machine.
    // Closed: an unknown name used to fall through to the local adapter and
    // send AGENT_LLM_API_KEY to AGENT_LLM_BASE_URL (#57).
    AGENT_LLM_PROVIDER: z.preprocess(
      unsetIfEmpty,
      z.enum(LLM_PROVIDERS).default("lmstudio"),
    ),
    AGENT_LLM_BASE_URL: z.preprocess(
      unsetIfEmpty,
      z.url({ protocol: /^https?$/ }).default("http://localhost:1234/v1"),
    ),
    AGENT_LLM_MODEL: textWithDefault("qwen/qwen3.5-9b"),
    AGENT_LLM_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
    // How much Claude thinks (#30): set explicitly so every run records it.
    // Read only by the `anthropic` provider.
    AGENT_LLM_EFFORT: z.preprocess(
      unsetIfEmpty,
      z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
    ),
    // Brief §6.3.3 and ADR 0017: the day's model spend, in integer
    // micro-dollars ($2 by default). Every run reserves its worst case first.
    AGENT_DAILY_BUDGET_MICROS: positiveIntWithDefault(2_000_000),
    // The agent's store (ADR 0016). Without a project, runs stay in memory.
    FIRESTORE_PROJECT_ID: z.preprocess(unsetIfEmpty, z.string().optional()),
    // `host:port` of the emulator: no token is sent to it.
    FIRESTORE_EMULATOR_HOST: z.preprocess(unsetIfEmpty, z.string().optional()),
    // `webSearch` (ADR 0015 point 8). Optional: without it the agent runs
    // without web search, and the evals can't record.
    TAVILY_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
    // Satella staging (#9, brief §13). The origin, without `/api/agent/v1`.
    // Unset: the pass has no Satella and runs only against the mock.
    SATELLA_STAGING_BASE_URL: z.preprocess(
      unsetIfEmpty,
      z.url({ protocol: /^https$/ }).optional(),
    ),
    // The `aud` Satella requires in the agent's Google identity token.
    SATELLA_AGENT_API_AUDIENCE: z.preprocess(
      unsetIfEmpty,
      z.string().min(1).optional(),
    ),
  })
  // A paid provider fails at startup without its key, not on the first call.
  .refine(
    (env) =>
      env.AGENT_LLM_PROVIDER !== "anthropic" ||
      env.AGENT_LLM_API_KEY !== undefined,
    { path: ["AGENT_LLM_API_KEY"], message: "required by anthropic" },
  )
  // Half a Satella would only fail on the first call, after the pass started.
  .refine(
    (env) =>
      (env.SATELLA_STAGING_BASE_URL === undefined) ===
      (env.SATELLA_AGENT_API_AUDIENCE === undefined),
    {
      path: ["SATELLA_AGENT_API_AUDIENCE"],
      message: "set with SATELLA_STAGING_BASE_URL",
    },
  );

export interface Config {
  runLimits: {
    maxToolCalls: number;
    maxTokens: number;
    maxWebSearches: number;
  };
  autoApproveThreshold: number;
  /** `AGENT_DAILY_BUDGET_MICROS`: what the day's runs may cost. */
  dailyBudgetMicros: number;
  store: {
    /** Undefined: the in-memory store. */
    firestoreProjectId: string | undefined;
    firestoreEmulatorHost: string | undefined;
  };
  llm: {
    provider: LlmProviderName;
    baseUrl: string;
    model: string;
    /** Local servers need none. A secret: never logged. */
    apiKey: string | undefined;
    effort: Effort;
  };
  webSearch: {
    /** A secret: never logged. Undefined: no web search. */
    tavilyApiKey: string | undefined;
  };
  /** Undefined: no Satella configured, so only the mock can be reviewed. */
  satella: { baseUrl: string; audience: string } | undefined;
}

export interface ConfigIssue {
  variable: string;
  problem: string;
}

export class ConfigError extends DomainError {
  readonly code = "CONFIG_INVALID";

  constructor(readonly issues: readonly ConfigIssue[]) {
    super(
      `Invalid environment: ${issues
        .map(({ variable, problem }) => `${variable} (${problem})`)
        .join(", ")}`,
    );
  }
}

/**
 * Parses the environment once, at startup. Errors name the variable and the
 * rule it broke but never echo the value, which may be a secret.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        variable: issue.path.join("."),
        problem: issue.code,
      })),
    );
  }

  const parsed = result.data;
  return {
    runLimits: {
      maxToolCalls: parsed.AGENT_MAX_TOOL_CALLS,
      maxTokens: parsed.AGENT_MAX_TOKENS,
      maxWebSearches: parsed.AGENT_MAX_WEB_SEARCHES,
    },
    autoApproveThreshold: parsed.AGENT_AUTO_APPROVE_THRESHOLD,
    dailyBudgetMicros: parsed.AGENT_DAILY_BUDGET_MICROS,
    store: {
      firestoreProjectId: parsed.FIRESTORE_PROJECT_ID,
      firestoreEmulatorHost: parsed.FIRESTORE_EMULATOR_HOST,
    },
    llm: {
      provider: parsed.AGENT_LLM_PROVIDER,
      baseUrl: parsed.AGENT_LLM_BASE_URL,
      model: parsed.AGENT_LLM_MODEL,
      apiKey: parsed.AGENT_LLM_API_KEY,
      effort: parsed.AGENT_LLM_EFFORT,
    },
    webSearch: { tavilyApiKey: parsed.TAVILY_API_KEY },
    satella:
      parsed.SATELLA_STAGING_BASE_URL === undefined ||
      parsed.SATELLA_AGENT_API_AUDIENCE === undefined
        ? undefined
        : {
            baseUrl: parsed.SATELLA_STAGING_BASE_URL,
            audience: parsed.SATELLA_AGENT_API_AUDIENCE,
          },
  };
}
