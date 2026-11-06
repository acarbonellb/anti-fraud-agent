/**
 * The configured model's adapter (ADR 0008): `anthropic` speaks the Messages
 * API through its SDK; any other provider name is an OpenAI-compatible server
 * at `AGENT_LLM_BASE_URL` (LM Studio by default).
 */
import type { Config } from "../config/config.js";
import { DomainError } from "../errors.js";
import { createAnthropicProvider } from "./anthropic/adapter.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible/adapter.js";
import type { LlmProvider } from "./types.js";

/** A provider configured without the key it needs to run. */
export class ProviderKeyMissingError extends DomainError {
  readonly code = "LLM_KEY_MISSING";

  constructor(readonly provider: string) {
    super(`${provider} needs AGENT_LLM_API_KEY`);
  }
}

export function createConfiguredProvider(llm: Config["llm"]): LlmProvider {
  if (llm.provider === "anthropic") {
    if (llm.apiKey === undefined) {
      // loadConfig already refuses this; the check narrows the type, and the
      // code lets the pass log it as more than UNEXPECTED.
      throw new ProviderKeyMissingError(llm.provider);
    }
    return createAnthropicProvider({
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
      effort: llm.effort,
    });
  }
  return createOpenAiCompatibleProvider({
    provider: llm.provider,
    baseUrl: llm.baseUrl,
    model: llm.model,
    ...(llm.apiKey === undefined ? {} : { apiKey: llm.apiKey }),
  });
}
