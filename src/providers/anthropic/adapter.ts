/**
 * Adapter for Anthropic's Messages API through the official SDK (ADR 0008
 * phase 2, #30). Written for Claude Haiku 5.5, whose rules shape it:
 *
 * - Thinking is adaptive and on by default; `effort` sets how much. Its
 *   blocks must go back unchanged with the tool results, so each assistant
 *   turn carries the response's own blocks in `providerContent`.
 * - Sampling parameters are rejected (API version 2026-10-21): no
 *   `temperature`. Reproducibility rests on the recordings, not the model.
 * - Thinking counts toward `max_tokens`, so the adapter adds headroom to the
 *   loop's per-call cap, which was sized for the answer alone.
 */
import Anthropic from "@anthropic-ai/sdk";

import {
  type ChatMessage,
  type CompletionRequest,
  type CompletionResponse,
  type LlmProvider,
  type Effort,
  ProviderError,
  type StopReason,
} from "../types.js";

export interface AnthropicOptions {
  apiKey: string;
  /** e.g. `claude-haiku-5-5`, from the current models docs. */
  model: string;
  /** Explicit, so every run records it (#30); the model's default is `medium`. */
  effort: Effort;
  /** Added to the loop's cap for the model's thinking. */
  thinkingHeadroomTokens?: number;
  fetch?: typeof globalThis.fetch;
  /** The SDK retries 429 and 5xx twice by default. */
  maxRetries?: number;
}

const PROVIDER = "anthropic";
const DEFAULT_THINKING_HEADROOM = 8192;

const stopReasons: Partial<Record<string, StopReason>> = {
  end_turn: "end",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

const COMPLETION_TIMEOUT_MS = 120_000;

export function createAnthropicProvider(
  options: AnthropicOptions,
): LlmProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    // The SDK waits 10 minutes per attempt by default, longer than the job
    // itself (ADR 0018). With its two retries, 3 × 2 min still fits (#57).
    timeout: COMPLETION_TIMEOUT_MS,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxRetries === undefined
      ? {}
      : { maxRetries: options.maxRetries }),
  });
  const headroom = options.thinkingHeadroomTokens ?? DEFAULT_THINKING_HEADROOM;

  return {
    provider: PROVIDER,
    model: options.model,

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");

      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: options.model,
          max_tokens: request.maxOutputTokens + headroom,
          ...(system === "" ? {} : { system }),
          messages: toWireMessages(request.messages),
          ...(request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  // Zod's JSON Schema of an object: the shape the API wants.
                  input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
                })),
              }),
          thinking: { type: "adaptive" },
          output_config: { effort: options.effort },
          // Automatic caching: the breakpoint follows the conversation's end,
          // so each step of a review reads the steps before it from cache.
          cache_control: { type: "ephemeral" },
        });
      } catch (error) {
        // A connection error is an APIError too: check it first.
        if (error instanceof Anthropic.APIConnectionError) {
          throw new ProviderError("LLM_UNAVAILABLE", PROVIDER);
        }
        if (error instanceof Anthropic.APIError) {
          throw new ProviderError(
            "LLM_HTTP_ERROR",
            PROVIDER,
            typeof error.status === "number" ? error.status : null,
          );
        }
        throw error;
      }

      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      const toolCalls = response.content.flatMap((block) =>
        block.type === "tool_use"
          ? [
              {
                id: block.id,
                name: block.name,
                argumentsJson: JSON.stringify(block.input),
              },
            ]
          : [],
      );
      const cacheRead = response.usage.cache_read_input_tokens ?? 0;
      const cacheWrite = response.usage.cache_creation_input_tokens ?? 0;

      return {
        message: {
          role: "assistant",
          content: text === "" ? null : text,
          toolCalls,
          providerContent: response.content,
        },
        stopReason:
          toolCalls.length > 0
            ? "tool_calls"
            : (stopReasons[response.stop_reason ?? ""] ?? "other"),
        usage: {
          inputTokens: response.usage.input_tokens + cacheRead + cacheWrite,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: cacheRead,
          cacheWriteInputTokens: cacheWrite,
        },
      };
    },
  };
}

/**
 * The conversation without its system prompt, which travels apart. Tool
 * results and user text become blocks of one user turn: the API wants every
 * result of a turn's tool calls in the next user message.
 */
function toWireMessages(
  messages: readonly ChatMessage[],
): Anthropic.MessageParam[] {
  const wire: Anthropic.MessageParam[] = [];
  let userBlocks: Anthropic.ContentBlockParam[] = [];
  const flushUser = () => {
    if (userBlocks.length === 0) return;
    wire.push({ role: "user", content: userBlocks });
    userBlocks = [];
  };

  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        userBlocks.push({ type: "text", text: message.content });
        break;
      case "tool":
        userBlocks.push({
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        });
        break;
      case "assistant":
        flushUser();
        wire.push({
          role: "assistant",
          // Its own blocks when this adapter produced the turn: thinking and
          // its signature must come back exactly as received.
          content:
            (message.providerContent as
              Anthropic.ContentBlockParam[] | undefined) ??
            assistantBlocks(message),
        });
        break;
    }
  }
  flushUser();
  return wire;
}

/** A turn another provider produced, rebuilt from the neutral shape. */
function assistantBlocks(
  message: Extract<ChatMessage, { role: "assistant" }>,
): Anthropic.ContentBlockParam[] {
  return [
    ...(message.content === null
      ? []
      : [{ type: "text" as const, text: message.content }]),
    ...message.toolCalls.map((call) => ({
      type: "tool_use" as const,
      id: call.id,
      name: call.name,
      input: parseInput(call.argumentsJson),
    })),
  ];
}

function parseInput(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson === "" ? "{}" : argumentsJson);
  } catch {
    // The loop already answered that call as invalid; the API needs an object.
    return {};
  }
}
