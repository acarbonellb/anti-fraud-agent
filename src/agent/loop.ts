/**
 * The agent loop: model ↔ tools until the model submits a recommendation or a
 * run limit is reached (brief §4.2). Limits are enforced here, not in the
 * prompt; reaching one escalates with the reason recorded.
 */
import type { z } from "zod";

import { DomainError } from "../errors.js";
import type {
  ChatMessage,
  LlmProvider,
  TokenUsage,
  ToolCall,
} from "../providers/types.js";
import { type AutonomyVerdict, decideAutonomy } from "./policy.js";
import { PROMPT_VERSION, systemPrompt } from "./prompt.js";
import { type Proposal, SUBMIT_TOOL } from "./recommendation.js";
import { type AnyAgentTool, toToolDefinition } from "./tools.js";
import { createUntrustedFence, type UntrustedFence } from "./untrusted.js";

export interface RunLimits {
  maxToolCalls: number;
  maxTokens: number;
  maxWebSearches: number;
}

export type RunEnd =
  | "submitted"
  | "max_tool_calls"
  | "max_tokens"
  | "max_web_searches"
  | "no_submission";

export interface TraceEntry {
  tool: string;
  ok: boolean;
  /** A stable code, never the error's text. */
  error?: string;
}

export interface RunResult {
  promptVersion: string;
  provider: string;
  model: string;
  endedBy: RunEnd;
  recommendation: Proposal;
  autonomy: AutonomyVerdict;
  usage: TokenUsage;
  toolCalls: number;
  webSearches: number;
  trace: TraceEntry[];
}

export interface RunReviewInput {
  provider: LlmProvider;
  tools: readonly AnyAgentTool[];
  limits: RunLimits;
  autoApproveThreshold: number;
  /** What to review, in trusted words: e.g. "event evt_123". */
  task: string;
  /** The subject's review context: reaches the model fenced as untrusted. */
  context: unknown;
  fence?: UntrustedFence;
}

/** Output tokens asked for per call; the run's token budget caps it further. */
const MAX_OUTPUT_TOKENS_PER_CALL = 4096;
/** Reminders to submit before giving up on a model that only talks. */
const MAX_NUDGES = 2;

export async function runReview(input: RunReviewInput): Promise<RunResult> {
  const { provider, tools, limits } = input;
  const fence = input.fence ?? createUntrustedFence();
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = [...tools, SUBMIT_TOOL].map(toToolDefinition);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(fence.nonce) },
    {
      role: "user",
      content: `Review ${input.task}. Its review context follows.\n${fence.wrap("review_context", input.context)}`,
    },
  ];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const trace: TraceEntry[] = [];
  let toolCalls = 0;
  let webSearches = 0;
  let nudges = 0;

  const finish = (endedBy: RunEnd, proposal?: Proposal): RunResult => {
    const recommendation = proposal ?? limitFallback(endedBy);
    return {
      promptVersion: PROMPT_VERSION,
      provider: provider.provider,
      model: provider.model,
      endedBy,
      recommendation,
      // A run that didn't finish never resolves on its own.
      autonomy:
        endedBy === "submitted"
          ? decideAutonomy({
              decision: recommendation.decision,
              confidence: recommendation.confidence,
              findings: recommendation.findings,
              autoApproveThreshold: input.autoApproveThreshold,
            })
          : { autonomy: "escalated", reasons: [`run ended by ${endedBy}`] },
      usage,
      toolCalls,
      webSearches,
      trace,
    };
  };

  for (;;) {
    const remaining = limits.maxTokens - usage.inputTokens - usage.outputTokens;
    if (remaining <= 0) return finish("max_tokens");

    const response = await provider.complete({
      messages,
      tools: definitions,
      maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS_PER_CALL, remaining),
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    if (usage.inputTokens + usage.outputTokens > limits.maxTokens) {
      return finish("max_tokens");
    }
    messages.push(response.message);

    if (response.message.toolCalls.length === 0) {
      if (nudges >= MAX_NUDGES) return finish("no_submission");
      nudges += 1;
      messages.push({
        role: "user",
        content: `End the review by calling ${SUBMIT_TOOL.name}.`,
      });
      continue;
    }

    for (const call of response.message.toolCalls) {
      if (call.name === SUBMIT_TOOL.name) {
        const proposal = parseArguments(call, SUBMIT_TOOL.input);
        if (proposal.ok) return finish("submitted", proposal.value);
        trace.push({ tool: call.name, ok: false, error: "INVALID_INPUT" });
        messages.push(toolResult(call, proposal.message));
        continue;
      }

      const tool = toolsByName.get(call.name);
      if (tool === undefined) {
        trace.push({ tool: call.name, ok: false, error: "UNKNOWN_TOOL" });
        messages.push(toolResult(call, `Unknown tool: ${call.name}.`));
        continue;
      }

      if (toolCalls >= limits.maxToolCalls) return finish("max_tool_calls");
      toolCalls += 1;
      if (tool.kind === "web_search") {
        if (webSearches >= limits.maxWebSearches) {
          return finish("max_web_searches");
        }
        webSearches += 1;
      }

      const args = parseArguments(call, tool.input);
      if (!args.ok) {
        trace.push({ tool: call.name, ok: false, error: "INVALID_INPUT" });
        messages.push(toolResult(call, args.message));
        continue;
      }

      try {
        const output = await tool.execute(args.value);
        trace.push({ tool: call.name, ok: true });
        messages.push(toolResult(call, fence.wrap(call.name, output)));
      } catch (error) {
        const code = error instanceof DomainError ? error.code : "TOOL_FAILED";
        trace.push({ tool: call.name, ok: false, error: code });
        messages.push(toolResult(call, `The tool failed (${code}).`));
      }
    }
  }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function parseArguments<T>(call: ToolCall, schema: z.ZodType<T>): Parsed<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(call.argumentsJson === "" ? "{}" : call.argumentsJson);
  } catch {
    return { ok: false, message: "The arguments are not valid JSON." };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  // Paths and rules only: enough for the model to fix its call.
  const problems = result.error.issues
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
    )
    .join("; ");
  return { ok: false, message: `Invalid arguments. ${problems}` };
}

function toolResult(call: ToolCall, content: string): ChatMessage {
  return { role: "tool", toolCallId: call.id, content };
}

/** What a run that couldn't finish recommends: a person has to look. */
function limitFallback(endedBy: RunEnd): Proposal {
  return {
    decision: "request_info",
    confidence: 0,
    rationale: `La revisión automática no pudo completarse (${endedBy}). Revísalo manualmente.`,
    findings: [],
  };
}
