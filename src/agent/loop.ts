/**
 * The agent loop: model ↔ tools until the model submits a recommendation or a
 * run limit is reached (brief §4.2). Limits are enforced here, not in the
 * prompt; reaching one escalates with the reason recorded. The web-search
 * budget is the soft one: a search past it isn't run, and the model still
 * decides with what it found (#31).
 */
import type { z } from "zod";

import type { SystemFinding } from "../checks/types.js";
import { DomainError } from "../errors.js";
import type {
  ChatMessage,
  LlmProvider,
  TokenUsage,
  ToolCall,
} from "../providers/types.js";
import {
  type Finding,
  REVIEW_MAX_FINDINGS,
} from "../satella-client/schemas.js";
import {
  type AutonomySubject,
  type AutonomyVerdict,
  decideAutonomy,
  escalated,
  holdBackApproval,
} from "./policy.js";
import { type Prompt, REVIEW_PROMPT } from "./prompt.js";
import { type Proposal, SUBMIT_TOOL } from "./recommendation.js";
import {
  type AnyAgentTool,
  type BoundCall,
  toToolDefinition,
} from "./tools.js";
import { createUntrustedFence, type UntrustedFence } from "./untrusted.js";

export interface RunLimits {
  maxToolCalls: number;
  maxTokens: number;
  maxWebSearches: number;
}

export type RunEnd =
  "submitted" | "max_tool_calls" | "max_tokens" | "no_submission";

export interface TraceEntry {
  tool: string;
  ok: boolean;
  /** A stable code, never the error's text. */
  error?: string;
  /**
   * Something the run did to a call that worked. `FINDINGS_TRUNCATED`: Satella's
   * limit cut some of the model's findings from the submission.
   */
  note?: "FINDINGS_TRUNCATED";
}

/** What a run recommends: the model's proposal with the system findings first. */
export type Recommendation = Omit<Proposal, "findings"> & {
  findings: Finding[];
};

export interface RunResult {
  promptVersion: string;
  provider: string;
  model: string;
  endedBy: RunEnd;
  /** Carries the policy's confidence, derived from the evidence (#77). */
  recommendation: Recommendation;
  autonomy: AutonomyVerdict;
  /** The number the model proposed: kept to compare with the derived one. */
  modelConfidence: number;
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
  /** What the policy weighs beyond the findings (ADR 0015). */
  subject: AutonomySubject;
  /** The subject's review context: reaches the model fenced as untrusted. */
  context: unknown;
  /**
   * Findings of the deterministic and venue checks, computed before the run.
   * The model sees them; they win over any model finding for the same check
   * (ADR 0012, ADR 0015).
   */
  systemFindings?: readonly SystemFinding[];
  fence?: UntrustedFence;
  /** Defaults to the active prompt; the evals swap it to compare versions. */
  prompt?: Prompt;
}

/** Output tokens asked for per call; the run's token budget caps it further. */
const MAX_OUTPUT_TOKENS_PER_CALL = 4096;
/** Reminders to submit before giving up on a model that only talks. */
const MAX_NUDGES = 2;

export async function runReview(input: RunReviewInput): Promise<RunResult> {
  const { provider, tools, limits } = input;
  const fence = input.fence ?? createUntrustedFence();
  const prompt = input.prompt ?? REVIEW_PROMPT;
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = [...tools, SUBMIT_TOOL].map(toToolDefinition);
  const systemFindings = input.systemFindings ?? [];
  // Each check the code ran, and whether it only passed there.
  const systemChecks = new Map<string, boolean>();
  for (const item of systemFindings) {
    const passed = item.finding.verdict === "pass";
    for (const check of [item.finding.check, ...(item.covers ?? [])]) {
      systemChecks.set(check, (systemChecks.get(check) ?? true) && passed);
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: prompt.system(fence.nonce) },
    {
      role: "user",
      content: [
        `Review ${input.task}. Its review context follows.`,
        fence.wrap("review_context", input.context),
        "The deterministic and venue checks already ran on that context. Their findings follow; they are authoritative and already part of the recommendation, so don't repeat them.",
        // Their details quote organizer text, so they travel fenced too.
        fence.wrap(
          "deterministic_checks",
          systemFindings.map(({ finding }) => ({
            check: finding.check,
            verdict: finding.verdict,
            detail: finding.detail,
            ...(finding.sources.length === 0
              ? {}
              : { sources: finding.sources }),
          })),
        ),
      ].join("\n"),
    },
  ];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const trace: TraceEntry[] = [];
  let toolCalls = 0;
  let webSearches = 0;
  // What the tools retrieved in this run: the only URLs a model finding may
  // cite as a source and have the policy count (ADR 0015 point 6).
  const retrievedUrls = new Set<string>();
  let nudges = 0;
  // A search past the budget means the model wanted more evidence than it
  // got: its decision stands, but an approval can't rest on it (#31).
  let searchBudgetSpent = false;
  const askedBefore = new Set<string>();

  const finish = (endedBy: RunEnd, proposal?: Proposal): RunResult => {
    const base = holdBackApproval(
      proposal ?? limitFallback(endedBy),
      systemFindings,
    );
    const modelFindings = base.findings.filter((finding) =>
      keepsModelFinding(finding, systemChecks.get(finding.check)),
    );
    // System findings go first, so a cut drops the model's first; it would
    // reach the system's only if they alone passed Satella's limit. The trace
    // keeps that it happened.
    const findings = [
      ...systemFindings.map((item) => item.finding),
      ...modelFindings,
    ];
    if (findings.length > REVIEW_MAX_FINDINGS) {
      trace.push({
        tool: SUBMIT_TOOL.name,
        ok: true,
        note: "FINDINGS_TRUNCATED",
      });
    }
    // A run that didn't finish never resolves on its own.
    const autonomy: AutonomyVerdict =
      endedBy === "submitted"
        ? decideAutonomy({
            subject: input.subject,
            decision: base.decision,
            modelConfidence: base.confidence,
            systemFindings,
            modelFindings,
            retrievedUrls,
            autoApproveThreshold: input.autoApproveThreshold,
            searchBudgetSpent,
          })
        : escalated([`run ended by ${endedBy}`], base.confidence);
    const recommendation: Recommendation = {
      ...base,
      confidence: autonomy.confidence,
      findings: findings.slice(0, REVIEW_MAX_FINDINGS),
    };
    return {
      promptVersion: prompt.version,
      provider: provider.provider,
      model: provider.model,
      endedBy,
      recommendation,
      autonomy,
      modelConfidence: base.confidence,
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
    // Only when reported, so a provider without a cache shows none.
    const { cacheReadInputTokens, cacheWriteInputTokens } = response.usage;
    if (cacheReadInputTokens !== undefined) {
      usage.cacheReadInputTokens =
        (usage.cacheReadInputTokens ?? 0) + cacheReadInputTokens;
    }
    if (cacheWriteInputTokens !== undefined) {
      usage.cacheWriteInputTokens =
        (usage.cacheWriteInputTokens ?? 0) + cacheWriteInputTokens;
    }
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
      // A valid submission ends the run even at the limit; every other call,
      // a wasted one included, counts toward it.
      const proposal =
        call.name === SUBMIT_TOOL.name
          ? parseArguments(call, SUBMIT_TOOL.input)
          : null;
      if (proposal?.ok === true) return finish("submitted", proposal.value);
      if (toolCalls >= limits.maxToolCalls) return finish("max_tool_calls");
      toolCalls += 1;

      if (proposal !== null) {
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

      const bound = bindArguments(call, tool);
      if (!bound.ok) {
        trace.push({ tool: call.name, ok: false, error: "INVALID_INPUT" });
        messages.push(toolResult(call, bound.message));
        continue;
      }

      const { repeatKey } = bound.value;
      const askedKey =
        repeatKey === undefined ? undefined : `${tool.name}:${repeatKey}`;
      if (askedKey !== undefined && askedBefore.has(askedKey)) {
        trace.push({ tool: call.name, ok: false, error: "REPEATED_CALL" });
        messages.push(toolResult(call, REPEATED_CALL));
        continue;
      }

      if (tool.kind === "web_search") {
        if (webSearches >= limits.maxWebSearches) {
          searchBudgetSpent = true;
          trace.push({ tool: call.name, ok: false, error: "BUDGET_SPENT" });
          messages.push(toolResult(call, BUDGET_SPENT));
          continue;
        }
        webSearches += 1;
      }

      try {
        const { output, sources } = await bound.value.run();
        // Only a call that ran has an answer above to point a repeat to.
        if (askedKey !== undefined) askedBefore.add(askedKey);
        for (const url of sources) retrievedUrls.add(url);
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

const REPEATED_CALL =
  "Already searched with these words in this review; its results are above. Search for something else or decide.";
const BUDGET_SPENT = `No searches left in this review. Decide with the evidence you have and call ${SUBMIT_TOOL.name}.`;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function readArguments(call: ToolCall): Parsed<unknown> {
  try {
    return {
      ok: true,
      value: JSON.parse(call.argumentsJson === "" ? "{}" : call.argumentsJson),
    };
  } catch {
    return { ok: false, message: "The arguments are not valid JSON." };
  }
}

function bindArguments(call: ToolCall, tool: AnyAgentTool): Parsed<BoundCall> {
  const raw = readArguments(call);
  if (!raw.ok) return raw;
  const bound = tool.bind(raw.value);
  return bound.ok
    ? { ok: true, value: bound.call }
    : { ok: false, message: invalid(bound.error) };
}

function parseArguments<T>(call: ToolCall, schema: z.ZodType<T>): Parsed<T> {
  const raw = readArguments(call);
  if (!raw.ok) return raw;
  const result = schema.safeParse(raw.value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: invalid(result.error) };
}

/** Paths and rules only: enough for the model to fix its call. */
function invalid(error: z.ZodError): string {
  const problems = error.issues
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
    )
    .join("; ");
  return `Invalid arguments. ${problems}`;
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

/**
 * System findings win over the model's on a check the code ran, with one
 * exception: a system `pass` can't silence a model `fail` or `warn`. A pass
 * only means a pattern didn't match ("B1zum" slips past the Bizum rule), so
 * it is no evidence against what the model caught (#57). `systemPassed` is
 * undefined when the code didn't run the check.
 */
function keepsModelFinding(
  finding: Finding,
  systemPassed: boolean | undefined,
): boolean {
  if (systemPassed === undefined) return true;
  return (
    systemPassed && (finding.verdict === "fail" || finding.verdict === "warn")
  );
}
