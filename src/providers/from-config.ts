/**
 * The configured model's adapter (ADR 0008): `anthropic` speaks the Messages
 * API through its SDK; any other provider name is an OpenAI-compatible server
 * at `AGENT_LLM_BASE_URL` (LM Studio by default).
 */
import type { Config } from "../config/config.js";
import { createAnthropicProvider } from "./anthropic/adapter.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible/adapter.js";
import type { LlmProvider } from "./types.js";

/** Providers that bill per token: recording with them needs a go-ahead. */
export const PAID_PROVIDERS: ReadonlySet<string> = new Set(["anthropic"]);

export function createConfiguredProvider(llm: Config["llm"]): LlmProvider {
  if (llm.provider === "anthropic") {
    if (llm.apiKey === undefined) {
      // loadConfig already refuses this; the check narrows the type.
      throw new Error("anthropic needs AGENT_LLM_API_KEY");
    }
    return createAnthropicProvider({
      apiKey: llm.apiKey,
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
