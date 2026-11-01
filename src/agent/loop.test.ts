// Checks the agent loop through runReview: tools are called and their results
// fed back fenced as untrusted, a valid submission ends the run with the
// policy's autonomy (never the model's), invalid calls get a correctable
// error, and every run limit escalates with its reason. Fakes the model with
// the scripted provider and tools with in-memory ones.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  callTool,
  createScriptedProvider,
  sayText,
} from "../providers/scripted-provider.js";
import type { CompletionResponse } from "../providers/types.js";
import { runReview, type RunReviewInput } from "./loop.js";
import { defineTool } from "./tools.js";
import { createUntrustedFence } from "./untrusted.js";

const LIMITS = { maxToolCalls: 5, maxTokens: 10_000, maxWebSearches: 1 };

const executed: string[] = [];

const lookupVenue = defineTool({
  name: "lookup_venue",
  description: "Looks up a venue.",
  kind: "deterministic",
  input: z.object({ name: z.string() }),
  execute: ({ name }) => {
    executed.push(`lookup_venue:${name}`);
    return Promise.resolve({ found: true, name });
  },
});

const webSearch = defineTool({
  name: "web_search",
  description: "Searches the web.",
  kind: "web_search",
  input: z.object({ query: z.string() }),
  execute: () => Promise.resolve({ results: [] }),
});

const brokenTool = defineTool({
  name: "broken",
  description: "Always fails.",
  kind: "external",
  input: z.object({}),
  execute: () => Promise.reject(new Error("socket hang up at 10.0.0.1")),
});

const approval = {
  decision: "approve",
  confidence: 0.95,
  rationale: "Todo en orden.",
  findings: [
    {
      check: "venue_exists",
      verdict: "pass",
      detail: "El recinto existe.",
      confidence: 0.9,
      sources: [],
    },
  ],
};

function run(
  script: CompletionResponse[],
  overrides: Partial<RunReviewInput> = {},
) {
  const provider = createScriptedProvider(script);
  const result = runReview({
    provider,
    tools: [lookupVenue, webSearch, brokenTool],
    limits: LIMITS,
    autoApproveThreshold: 0.85,
    task: "event evt_0001",
    context: { event: { title: "Noche de jazz" } },
    fence: createUntrustedFence("n0nce"),
    ...overrides,
  });
  return { provider, result };
}

describe("a run that ends in a submission", () => {
  it("calls tools, feeds results back fenced, and ends on submission", async () => {
    const { provider, result } = run([
      callTool("lookup_venue", { name: "Sala Lumbre" }),
      callTool("submit_recommendation", approval),
    ]);

    const outcome = await result;

    expect(outcome.endedBy).toBe("submitted");
    expect(outcome.recommendation.decision).toBe("approve");
    expect(outcome.autonomy.autonomy).toBe("auto_resolved");
    expect(outcome.toolCalls).toBe(1);
    expect(outcome.trace).toEqual([{ tool: "lookup_venue", ok: true }]);
    expect(outcome.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
    const toolMessage = provider.requests[1]?.messages.at(-1);
    expect(toolMessage).toMatchObject({ role: "tool" });
    expect(toolMessage?.role === "tool" && toolMessage.content).toContain(
      '<untrusted_data source="lookup_venue" nonce="n0nce">',
    );
  });

  it("fences the review context and offers every tool plus submit", async () => {
    const { provider, result } = run([
      callTool("submit_recommendation", approval),
    ]);
    await result;

    const [system, user] = provider.requests[0]?.messages ?? [];
    expect(system?.content).toContain('nonce="n0nce"');
    expect(user?.content).toContain(
      '<untrusted_data source="review_context" nonce="n0nce">',
    );
    expect(provider.requests[0]?.tools.map((tool) => tool.name)).toEqual([
      "lookup_venue",
      "web_search",
      "broken",
      "submit_recommendation",
    ]);
  });

  it("takes autonomy from the policy, not from anything the model says", async () => {
    const { result } = run([
      callTool("submit_recommendation", {
        ...approval,
        confidence: 0.5,
        autonomy: "auto_resolved",
      }),
    ]);

    expect((await result).autonomy.autonomy).toBe("escalated");
  });

  it("lets the model fix an invalid submission", async () => {
    const { provider, result } = run([
      callTool("submit_recommendation", { ...approval, decision: "maybe" }),
      callTool("submit_recommendation", approval),
    ]);

    const outcome = await result;

    expect(outcome.endedBy).toBe("submitted");
    expect(outcome.trace[0]).toEqual({
      tool: "submit_recommendation",
      ok: false,
      error: "INVALID_INPUT",
    });
    const correction = provider.requests[1]?.messages.at(-1);
    expect(correction?.content).toContain("decision");
  });

  it("rejects a check name outside the vocabulary, so the policy reads real names", async () => {
    const invented = {
      ...approval,
      findings: [{ ...approval.findings[0], check: "Posible clon" }],
    };
    const { provider, result } = run([
      callTool("submit_recommendation", invented),
      callTool("submit_recommendation", approval),
    ]);

    const outcome = await result;

    expect(outcome.trace[0]?.error).toBe("INVALID_INPUT");
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      "findings.0.check",
    );
  });

  it("requires an info request when asking for information", async () => {
    const { result } = run([
      callTool("submit_recommendation", {
        ...approval,
        decision: "request_info",
      }),
      callTool("submit_recommendation", {
        ...approval,
        decision: "request_info",
        infoRequest: { questions: ["¿Aforo?"], draft: "Hola" },
      }),
    ]);

    const outcome = await result;

    expect(outcome.trace[0]?.error).toBe("INVALID_INPUT");
    expect(outcome.recommendation.infoRequest?.questions).toEqual(["¿Aforo?"]);
  });
});

describe("tool errors the model can recover from", () => {
  it.each([
    ["an unknown tool", callTool("delete_event", {}), "UNKNOWN_TOOL"],
    [
      "arguments that aren't JSON",
      callTool("lookup_venue", "{oops"),
      "INVALID_INPUT",
    ],
    [
      "arguments outside the schema",
      callTool("lookup_venue", { name: 3 }),
      "INVALID_INPUT",
    ],
    ["a tool that throws", callTool("broken", {}), "TOOL_FAILED"],
  ])("reports %s and carries on", async (_, badCall, code) => {
    const { provider, result } = run([
      badCall,
      callTool("submit_recommendation", approval),
    ]);

    const outcome = await result;

    expect(outcome.endedBy).toBe("submitted");
    expect(outcome.trace[0]?.error).toBe(code);
    const errorMessage = provider.requests[1]?.messages.at(-1)?.content ?? "";
    expect(errorMessage).not.toContain("10.0.0.1");
  });
});

describe("run limits", () => {
  it("escalates when the tool-call limit is reached, without running the extra call", async () => {
    executed.length = 0;
    const { result } = run(
      [
        callTool("lookup_venue", { name: "A" }),
        callTool("lookup_venue", { name: "B" }),
        callTool("lookup_venue", { name: "C" }),
      ],
      { limits: { ...LIMITS, maxToolCalls: 2 } },
    );

    const outcome = await result;

    expect(outcome.endedBy).toBe("max_tool_calls");
    expect(executed).toEqual(["lookup_venue:A", "lookup_venue:B"]);
    expect(outcome.autonomy).toEqual({
      autonomy: "escalated",
      reasons: ["run ended by max_tool_calls"],
    });
    expect(outcome.recommendation.decision).toBe("request_info");
    expect(outcome.recommendation.rationale).toContain("max_tool_calls");
  });

  it("escalates when the web-search limit is reached", async () => {
    const { result } = run([
      callTool("web_search", { query: "a" }),
      callTool("web_search", { query: "b" }),
    ]);

    const outcome = await result;

    expect(outcome.endedBy).toBe("max_web_searches");
    expect(outcome.webSearches).toBe(1);
  });

  it("escalates when the token budget is spent, even on a submission", async () => {
    const { result } = run(
      [
        callTool(
          "lookup_venue",
          { name: "A" },
          { inputTokens: 600, outputTokens: 100 },
        ),
        callTool("submit_recommendation", approval, {
          inputTokens: 600,
          outputTokens: 100,
        }),
      ],
      { limits: { ...LIMITS, maxTokens: 1000 } },
    );

    const outcome = await result;

    expect(outcome.endedBy).toBe("max_tokens");
    expect(outcome.recommendation.decision).toBe("request_info");
  });

  it("caps each call's output at the tokens left in the budget", async () => {
    const { provider, result } = run(
      [
        callTool(
          "lookup_venue",
          { name: "A" },
          { inputTokens: 700, outputTokens: 100 },
        ),
        callTool("submit_recommendation", approval, {
          inputTokens: 50,
          outputTokens: 50,
        }),
      ],
      { limits: { ...LIMITS, maxTokens: 1000 } },
    );
    await result;

    expect(provider.requests.map((request) => request.maxOutputTokens)).toEqual(
      [1000, 200],
    );
  });

  it("nudges a model that only talks, then escalates", async () => {
    const { provider, result } = run([
      sayText("Creo que está bien."),
      sayText("Sí, está bien."),
      sayText("De verdad."),
    ]);

    const outcome = await result;

    expect(outcome.endedBy).toBe("no_submission");
    expect(provider.requests[1]?.messages.at(-1)).toEqual({
      role: "user",
      content: "End the review by calling submit_recommendation.",
    });
  });
});
