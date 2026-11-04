import { z } from "zod";

import { DomainError } from "../errors.js";

// An empty value in .env (`AGENT_MAX_TOKENS=`) means "unset", so it falls back
// to the default instead of failing as 0.
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);

const positiveIntWithDefault = (fallback: number) =>
  z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().positive().default(fallback),
  );

const textWithDefault = (fallback: string) =>
  z.preprocess(unsetIfEmpty, z.string().min(1).default(fallback));

// Names mirror .env.example (env-var skill). Run limits: brief §4.2; the
// defaults are provisional until the agent loop (#5) measures real runs.
const envSchema = z.object({
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
  AGENT_LLM_PROVIDER: textWithDefault("lmstudio"),
  AGENT_LLM_BASE_URL: z.preprocess(
    unsetIfEmpty,
    z.url({ protocol: /^https?$/ }).default("http://localhost:1234/v1"),
  ),
  AGENT_LLM_MODEL: textWithDefault("qwen/qwen3.5-9b"),
  AGENT_LLM_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
  // `webSearch` (ADR 0015 point 8). Optional: without it the agent runs
  // without web search, and the evals can't record.
  TAVILY_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
});

export interface Config {
  runLimits: {
    maxToolCalls: number;
    maxTokens: number;
    maxWebSearches: number;
  };
  autoApproveThreshold: number;
  llm: {
    provider: string;
    baseUrl: string;
    model: string;
    /** Local servers need none. A secret: never logged. */
    apiKey: string | undefined;
  };
  webSearch: {
    /** A secret: never logged. Undefined: no web search. */
    tavilyApiKey: string | undefined;
  };
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
    llm: {
      provider: parsed.AGENT_LLM_PROVIDER,
      baseUrl: parsed.AGENT_LLM_BASE_URL,
      model: parsed.AGENT_LLM_MODEL,
      apiKey: parsed.AGENT_LLM_API_KEY,
    },
    webSearch: { tavilyApiKey: parsed.TAVILY_API_KEY },
  };
}
