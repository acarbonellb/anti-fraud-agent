/**
 * A provider that replays a script of responses, for tests of the loop
 * without network or cost. It records every request so tests can check what
 * the loop sent. Being a second implementation of `LlmProvider` from day one,
 * it also keeps the interface free of any one provider's shape (ADR 0008).
 */
import type {
  CompletionRequest,
  CompletionResponse,
  LlmProvider,
  TokenUsage,
  ToolCall,
} from "../providers/types.js";

export interface ScriptedProvider extends LlmProvider {
  readonly requests: CompletionRequest[];
}

export function createScriptedProvider(
  script: readonly CompletionResponse[],
  /** Another provider's name, so its prices apply to the script's usage. */
  identity: { provider: string; model: string } = {
    provider: "scripted",
    model: "scripted-model",
  },
): ScriptedProvider {
  const requests: CompletionRequest[] = [];
  return {
    provider: identity.provider,
    model: identity.model,
    requests,
    complete(request) {
      // A snapshot: the loop keeps appending to the same array.
      requests.push({ ...request, messages: [...request.messages] });
      const turn = requests.length;
      const next = script[turn - 1];
      if (next === undefined) {
        return Promise.reject(
          new Error(`Script exhausted at call ${String(turn)}`),
        );
      }
      // Ids are this provider's, by turn and position: unique within a run
      // even when a script repeats the same response object.
      const toolCalls = next.message.toolCalls.map((call, index) => ({
        ...call,
        id: `call_${String(turn)}_${String(index)}`,
      }));
      return Promise.resolve({
        ...next,
        message: { ...next.message, toolCalls },
      });
    },
  };
}

/** A response that calls one tool. */
export function callTool(
  name: string,
  args: unknown,
  usage: TokenUsage = { inputTokens: 100, outputTokens: 20 },
): CompletionResponse {
  const call: ToolCall = {
    // The scripted provider gives each call its id when it replays it.
    id: "",
    name,
    argumentsJson: typeof args === "string" ? args : JSON.stringify(args),
  };
  return {
    message: { role: "assistant", content: null, toolCalls: [call] },
    stopReason: "tool_calls",
    usage,
  };
}

/** A response with text and no tool call. */
export function sayText(
  text: string,
  usage: TokenUsage = { inputTokens: 100, outputTokens: 20 },
): CompletionResponse {
  return {
    message: { role: "assistant", content: text, toolCalls: [] },
    stopReason: "end",
    usage,
  };
}
