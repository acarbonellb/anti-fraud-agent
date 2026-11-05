/**
 * Adapter for OpenAI-compatible Chat Completions APIs: OpenAI itself, xAI's
 * Grok and local servers such as LM Studio or Ollama (ADR 0008). Only the
 * base URL, key and model change between them.
 */
import { z } from "zod";

import {
  type ChatMessage,
  type CompletionRequest,
  type CompletionResponse,
  type LlmProvider,
  ProviderError,
  type StopReason,
} from "../types.js";

export interface OpenAiCompatibleOptions {
  /** Recorded with every run, e.g. `lmstudio`. */
  provider: string;
  /** Up to and including `/v1`, e.g. `http://localhost:1234/v1`. */
  baseUrl: string;
  model: string;
  /** Local servers don't need one. */
  apiKey?: string;
  /** Deterministic by default: reviews must be reproducible. */
  temperature?: number;
  fetch?: typeof globalThis.fetch;
  /** Per completion. A hung server fails as `LLM_UNAVAILABLE` (#57). */
  timeoutMs?: number;
}

/** A local 9B model can take a minute on a long review; a hung one, forever. */
const COMPLETION_TIMEOUT_MS = 120_000;

// Only what the adapter reads. Servers add their own fields (LM Studio sends
// `reasoning_content`); Zod drops them.
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});

const stopReasons: Partial<Record<string, StopReason>> = {
  tool_calls: "tool_calls",
  stop: "end",
  length: "max_tokens",
};

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleOptions,
): LlmProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    provider: options.provider,
    model: options.model,

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const body = {
        model: options.model,
        temperature: options.temperature ?? 0,
        max_tokens: request.maxOutputTokens,
        messages: request.messages.map(toWireMessage),
        ...(request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }),
      };

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey === undefined
              ? {}
              : { authorization: `Bearer ${options.apiKey}` }),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(
            options.timeoutMs ?? COMPLETION_TIMEOUT_MS,
          ),
        });
      } catch {
        throw new ProviderError("LLM_UNAVAILABLE", options.provider);
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
          "LLM_HTTP_ERROR",
          options.provider,
          response.status,
        );
      }

      const parsed = responseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) {
        throw new ProviderError(
          "LLM_BAD_RESPONSE",
          options.provider,
          response.status,
        );
      }

      // `.min(1)` above guarantees a first choice.
      const choice = parsed.data.choices[0];
      if (choice === undefined) {
        throw new ProviderError("LLM_BAD_RESPONSE", options.provider);
      }
      const toolCalls = (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        argumentsJson: call.function.arguments,
      }));
      const content = choice.message.content ?? null;

      return {
        message: {
          role: "assistant",
          content: content === "" ? null : content,
          toolCalls,
        },
        stopReason:
          toolCalls.length > 0
            ? "tool_calls"
            : (stopReasons[choice.finish_reason ?? ""] ?? "other"),
        usage: {
          inputTokens: parsed.data.usage.prompt_tokens,
          outputTokens: parsed.data.usage.completion_tokens,
        },
      };
    },
  };
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls.length === 0
          ? {}
          : {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.argumentsJson },
              })),
            }),
      };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}
