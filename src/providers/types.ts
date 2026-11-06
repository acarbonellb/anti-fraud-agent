/**
 * The provider-neutral interface the agent loop talks to (brief D8). Every
 * adapter translates these shapes to and from one provider API; nothing
 * outside `src/providers/<adapter>/` knows any provider's wire format.
 */
import { DomainError } from "../errors.js";

export interface ToolCall {
  /** The provider's id, echoed back with the result. */
  id: string;
  name: string;
  /** The raw JSON text the model produced; the loop parses and validates it. */
  argumentsJson: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls: ToolCall[];
      /**
       * The provider's own blocks for this turn, opaque to everything but the
       * adapter that produced them, which sends them back unchanged: Claude
       * needs its thinking blocks echoed with the tool results.
       */
      providerContent?: unknown[] | undefined;
    }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the input, generated from the tool's Zod schema. */
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
}

export type StopReason =
  "tool_calls" | "end" | "max_tokens" | "refusal" | "other";

export interface TokenUsage {
  /** Every input token the call processed, cached or not. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` read from the provider's prompt cache. */
  cacheReadInputTokens?: number | undefined;
  /** The part of `inputTokens` written to it. */
  cacheWriteInputTokens?: number | undefined;
}

export interface CompletionResponse {
  message: Extract<ChatMessage, { role: "assistant" }>;
  stopReason: StopReason;
  usage: TokenUsage;
}

export interface LlmProvider {
  /** e.g. `lmstudio`, `openai`, `xai`: recorded with every run. */
  readonly provider: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/**
 * How much the model thinks before it answers. Only Claude takes it today;
 * it lives here so config doesn't depend on one adapter.
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type ProviderErrorCode =
  "LLM_UNAVAILABLE" | "LLM_HTTP_ERROR" | "LLM_BAD_RESPONSE";

/** A failed model call. Never carries the prompt or the response body. */
export class ProviderError extends DomainError {
  constructor(
    readonly code: ProviderErrorCode,
    readonly provider: string,
    readonly status: number | null = null,
  ) {
    super(
      `${provider} call failed: ${code}` +
        (status === null ? "" : ` (${String(status)})`),
    );
  }
}
