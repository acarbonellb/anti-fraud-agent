import { z } from "zod";

import { DomainError } from "../errors.js";

// An empty value in .env (`AGENT_MAX_TOKENS=`) means "unset", so it falls back
// to the default instead of failing as 0.
const positiveIntWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().default(fallback),
  );

// Names mirror .env.example (env-var skill). Run limits: brief §4.2; the
// defaults are provisional until the agent loop (#5) measures real runs.
const envSchema = z.object({
  AGENT_MAX_TOOL_CALLS: positiveIntWithDefault(30),
  AGENT_MAX_TOKENS: positiveIntWithDefault(200_000),
  AGENT_MAX_WEB_SEARCHES: positiveIntWithDefault(10),
});

export interface Config {
  runLimits: {
    maxToolCalls: number;
    maxTokens: number;
    maxWebSearches: number;
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
  };
}
