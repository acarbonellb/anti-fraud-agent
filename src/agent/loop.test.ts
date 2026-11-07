// Checks the agent loop through runReview: tools are called and their results
// fed back fenced as untrusted, a valid submission ends the run with the
// policy's autonomy (never the model's), invalid calls get a correctable
// error, every run limit escalates with its reason, a search past the
// budget or repeated is answered without running it, and an approval against
// a negative system finding becomes a request. Fakes the model with
// the scripted provider and tools with in-memory ones.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  callTool,
  createScriptedProvider,
  lastToolResult,
  sayText,
  toolResults,
} from "../test-support/scripted-provider.js";
import type { CompletionResponse } from "../providers/types.js";
import { type SystemFinding, systemFinding } from "../checks/types.js";
import { runReview, type RunReviewInput } from "./loop.js";
import { infoRequestSchema } from "../satella-client/schemas.js";
import { createAuthoredSearch } from "../search/authored.js";
import { webSearchTool } from "../agent/web-search-tool.js";
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

/** What the venue checks find for a verified venue of unknown capacity. */
const venueVerified: SystemFinding[] = [
  {
    ...systemFinding(
      "heuristic",
      "venue_exists",
      "pass",
      "Recinto verificado.",
    ),
    covers: ["venue_exists", "venue_capacity", "capacity_far_above_venue"],
  },
  {
    ...systemFinding("heuristic", "venue_capacity", "unknown", "Sin aforo."),
    covers: ["venue_exists", "venue_capacity", "capacity_far_above_venue"],
  },
];

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
    subject: {
      type: "event",
      maxTicketsOnSale: 100,
      moneyOnSaleCents: 150_000,
    },
    context: { event: { title: "Noche de jazz" } },
    systemFindings: venueVerified,
    fence: createUntrustedFence("n0nce"),
    ...overrides,
  });
  return { provider, result };
}

describe("a run that ends in a submission", () => {
  it("sums the prompt-cache tokens the provider reports", async () => {
    const cached = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 60,
      cacheWriteInputTokens: 30,
    };
    const { result } = run([
      callTool("lookup_venue", { name: "Sala Lumbre" }, cached),
      callTool("submit_recommendation", approval, cached),
    ]);

    expect((await result).usage).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheReadInputTokens: 120,
      cacheWriteInputTokens: 60,
    });
  });

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
    expect(lastToolResult(provider, "lookup_venue")).toContain(
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
    const { result } = run(
      [
        callTool("submit_recommendation", {
          ...approval,
          autonomy: "auto_resolved",
        }),
      ],
      // No venue checks: an approval without venue evidence escalates.
      { systemFindings: [] },
    );

    expect((await result).autonomy.autonomy).toBe("escalated");
  });

  it("shows the evidence tier as the confidence and keeps the model's number (#77)", async () => {
    const { result } = run([
      callTool("submit_recommendation", { ...approval, confidence: 0.7 }),
    ]);

    const outcome = await result;
    // A verified venue of unknown capacity under the exposure cap.
    expect(outcome.recommendation.confidence).toBe(0.85);
    expect(outcome.autonomy.confidence).toBe(0.85);
    expect(outcome.modelConfidence).toBe(0.7);
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
    expect(lastToolResult(provider, "submit_recommendation")).toContain(
      "decision",
    );
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
    expect(lastToolResult(provider, "submit_recommendation")).toContain(
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

describe("deterministic findings", () => {
  const postalCodeFail = systemFinding(
    "rule",
    "postal_code_province",
    "fail",
    "Regla CP↔provincia: el 28013 es de Madrid, no de Sevilla.",
  );

  it("shows them to the model fenced, and puts them first in the recommendation", async () => {
    const { provider, result } = run(
      [
        callTool("submit_recommendation", {
          ...approval,
          decision: "request_info",
          infoRequest: { questions: ["¿Provincia?"], draft: "Hola" },
        }),
      ],
      { systemFindings: [postalCodeFail] },
    );

    const outcome = await result;

    const user = provider.requests[0]?.messages[1]?.content ?? "";
    expect(user).toContain(
      '<untrusted_data source="deterministic_checks" nonce="n0nce">',
    );
    expect(user).toContain("28013 es de Madrid");
    expect(outcome.recommendation.findings[0]).toEqual(postalCodeFail.finding);
    expect(outcome.autonomy).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["mechanical request: postal_code_province"],
    });
  });

  it("drops a model finding that contradicts a check the code ran", async () => {
    const { result } = run(
      [
        callTool("submit_recommendation", {
          ...approval,
          findings: [
            {
              check: "postal_code_province",
              verdict: "pass",
              detail: "Todo bien.",
              confidence: 1,
              sources: [],
            },
          ],
        }),
      ],
      { systemFindings: [postalCodeFail] },
    );

    const outcome = await result;

    expect(
      outcome.recommendation.findings.filter(
        (finding) => finding.check === "postal_code_province",
      ),
    ).toEqual([postalCodeFail.finding]);
    // The code's fail stands, so the approval can't: with only a rule
    // flagged, it is a mechanical request (#33).
    expect(outcome.recommendation.decision).toBe("request_info");
  });

  it("keeps a model fail where the code's check only passed", async () => {
    // A regex miss ("B1zum") gives a system pass: it must not erase what the
    // model caught on the same check (#57).
    const paymentPass = systemFinding(
      "rule",
      "off_platform_payment",
      "pass",
      "Los textos no piden pagar fuera de la plataforma.",
    );
    const modelFail = {
      check: "off_platform_payment",
      verdict: "fail",
      detail: "Pide pagar por B1zum al 600…",
      confidence: 0.8,
      sources: [],
    } as const;
    const { result } = run(
      [
        callTool("submit_recommendation", {
          ...approval,
          decision: "reject",
          findings: [
            modelFail,
            { ...modelFail, verdict: "pass", detail: "Nada raro." },
          ],
        }),
      ],
      { systemFindings: [paymentPass] },
    );

    const outcome = await result;

    expect(
      outcome.recommendation.findings.filter(
        (finding) => finding.check === "off_platform_payment",
      ),
    ).toEqual([paymentPass.finding, modelFail]);
  });

  it("drops a model finding on any check a system finding covers, and shows its sources", async () => {
    const farAbove: SystemFinding = {
      certainty: "heuristic",
      finding: {
        check: "capacity_far_above_venue",
        verdict: "fail",
        detail: "Señal grave de aforo.",
        confidence: 1,
        sources: [
          { url: "https://www.openstreetmap.org/node/1", title: "OSM" },
        ],
      },
      covers: ["venue_exists", "venue_capacity", "capacity_far_above_venue"],
    };
    const { provider, result } = run(
      [
        callTool("submit_recommendation", {
          ...approval,
          decision: "reject",
          findings: [
            {
              check: "venue_capacity",
              verdict: "pass",
              detail: "Cabe todo el mundo.",
              confidence: 1,
              sources: [],
            },
          ],
        }),
      ],
      { systemFindings: [farAbove] },
    );

    const outcome = await result;

    expect(outcome.recommendation.findings).toEqual([farAbove.finding]);
    expect(outcome.autonomy).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["hard signals: capacity_far_above_venue"],
    });
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "https://www.openstreetmap.org/node/1",
    );
  });

  it("keeps them in the fallback when a limit ends the run", async () => {
    const { result } = run([callTool("lookup_venue", { name: "A" })], {
      systemFindings: [postalCodeFail],
      limits: { ...LIMITS, maxToolCalls: 0 },
    });

    expect((await result).recommendation.findings).toEqual([
      postalCodeFail.finding,
    ]);
  });
});

describe("Satella's findings limit", () => {
  it("keeps the system findings first and records that model findings were cut", async () => {
    const systemFindings = Array.from({ length: 29 }, (_, index) =>
      systemFinding(
        "rule",
        "postal_code_province",
        "pass",
        `Regla ${String(index)}.`,
      ),
    );
    const modelFindings = ["organizer_web_presence", "artist_availability"].map(
      (check) => ({
        check,
        verdict: "warn",
        detail: "Sin rastro en la web.",
        confidence: 0.6,
        sources: [],
      }),
    );
    const { result } = run(
      [
        callTool("submit_recommendation", {
          ...approval,
          findings: modelFindings,
        }),
      ],
      { systemFindings },
    );

    const outcome = await result;

    expect(outcome.recommendation.findings).toHaveLength(30);
    expect(outcome.recommendation.findings[29]?.check).toBe(
      "organizer_web_presence",
    );
    expect(outcome.trace).toContainEqual({
      tool: "submit_recommendation",
      ok: true,
      note: "FINDINGS_TRUNCATED",
    });
  });
});

describe("an approval against a negative system finding (#33)", () => {
  const highFee = systemFinding(
    "heuristic",
    "service_fee",
    "warn",
    "Los gastos de gestión de «General» son el 45 % del precio (umbral: 30 %).",
  );
  const wrongProvince = systemFinding(
    "rule",
    "postal_code_province",
    "fail",
    "El código postal 08001 no es de Madrid.",
  );

  it("becomes a request that asks about each flagged finding", async () => {
    const { result } = run([callTool("submit_recommendation", approval)], {
      systemFindings: [...venueVerified, highFee],
    });
    const outcome = await result;
    expect(outcome.recommendation.decision).toBe("request_info");
    expect(outcome.recommendation.infoRequest?.questions).toEqual([
      expect.stringContaining(highFee.finding.detail),
    ]);
    expect(outcome.recommendation.rationale).toContain("Todo en orden.");
    expect(outcome.autonomy).toMatchObject({
      autonomy: "escalated",
      reasons: [
        "no rule-based finding to ask about",
        "needs judgement: service_fee",
      ],
    });
  });

  it("resolves as a mechanical request when only rules flagged it", async () => {
    const { result } = run([callTool("submit_recommendation", approval)], {
      systemFindings: [...venueVerified, wrongProvince],
    });
    const outcome = await result;
    expect(outcome.recommendation.decision).toBe("request_info");
    expect(outcome.autonomy).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["mechanical request: postal_code_province"],
    });
  });

  it("stays within Satella's limits and points to the flags it can't list", async () => {
    const many = Array.from({ length: 12 }, () =>
      systemFinding("heuristic", "session_timing", "warn", "😀".repeat(500)),
    );
    const { result } = run([callTool("submit_recommendation", approval)], {
      systemFindings: [...venueVerified, ...many],
    });
    const { recommendation } = await result;
    expect(
      infoRequestSchema.safeParse(recommendation.infoRequest).success,
    ).toBe(true);
    expect(recommendation.infoRequest?.questions.at(-1)).toContain(
      "otros 3 puntos",
    );
    expect(recommendation.rationale.length).toBeLessThanOrEqual(4000);
  });

  it("leaves an approval that only the model doubts, and a rejection, alone", async () => {
    const doubted = run([
      callTool("submit_recommendation", {
        ...approval,
        findings: [
          {
            check: "organizer_web_presence",
            verdict: "warn",
            detail: "Poca presencia en la web.",
            confidence: 0.6,
            sources: [],
          },
        ],
      }),
    ]);
    expect((await doubted.result).recommendation.decision).toBe("approve");
    const rejected = run(
      [callTool("submit_recommendation", { ...approval, decision: "reject" })],
      { systemFindings: [...venueVerified, highFee] },
    );
    expect((await rejected.result).recommendation.decision).toBe("reject");
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
    const [answer] = toolResults(provider, outcome.trace[0]?.tool ?? "");
    expect(answer).toBeDefined();
    expect(answer).not.toContain("10.0.0.1");
  });
});

describe("sources from web search (ADR 0015)", () => {
  const page = {
    url: "https://entradas-ejemplo.test/evento/original",
    title: "Evento original",
    snippet: "El mismo evento, en otra ticketera.",
  };
  const search = webSearchTool(createAuthoredSearch([page]));
  const rejection = (url: string) => ({
    ...approval,
    decision: "reject",
    findings: [
      {
        check: "exact_duplicate_other_organizer",
        verdict: "fail",
        detail: "Es un clon.",
        confidence: 0.9,
        sources: [{ url, title: "Fuente" }],
      },
    ],
  });

  it("counts a source a search retrieved in this run", async () => {
    const { provider, result } = run(
      [
        callTool("web_search", { query: "evento original ticketera" }),
        callTool("submit_recommendation", rejection(page.url)),
      ],
      { tools: [search] },
    );
    const outcome = await result;
    expect(outcome.webSearches).toBe(1);
    expect(outcome.autonomy.autonomy).toBe("auto_resolved");
    expect(lastToolResult(provider, "web_search")).toContain(
      '<untrusted_data source="web_search" nonce="n0nce">',
    );
  });

  it("doesn't count a source no tool retrieved", async () => {
    const { result } = run(
      [
        callTool("web_search", { query: "evento original ticketera" }),
        callTool(
          "submit_recommendation",
          rejection("https://entradas-ejemplo.test/inventada"),
        ),
      ],
      { tools: [search] },
    );
    expect((await result).autonomy.autonomy).toBe("escalated");
  });

  it("doesn't take a refused search for one already answered", async () => {
    const { provider, result } = run(
      [
        callTool("web_search", { query: "evento original ticketera" }),
        callTool("web_search", { query: "noche de jazz" }),
        callTool("web_search", { query: "noche de jazz" }),
        callTool("submit_recommendation", approval),
      ],
      { tools: [search] },
    );
    await result;
    expect(lastToolResult(provider, "web_search")).toContain(
      "No searches left",
    );
  });

  it("answers a repeated search without running it or spending the budget", async () => {
    const { provider, result } = run(
      [
        callTool("web_search", { query: "Evento original ticketera" }),
        callTool("web_search", { query: '"evento original" ticketera' }),
        callTool("submit_recommendation", rejection(page.url)),
      ],
      { tools: [search] },
    );
    const outcome = await result;
    expect(outcome.webSearches).toBe(1);
    expect(outcome.toolCalls).toBe(2);
    expect(outcome.autonomy.autonomy).toBe("auto_resolved");
    expect(lastToolResult(provider, "web_search")).toContain(
      "Already searched",
    );
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
    expect(outcome.autonomy).toMatchObject({
      autonomy: "escalated",
      reasons: ["run ended by max_tool_calls"],
    });
    expect(outcome.recommendation.decision).toBe("request_info");
    expect(outcome.recommendation.rationale).toContain("max_tool_calls");
  });

  it.each([
    ["an unknown tool", callTool("delete_event", {})],
    [
      "an invalid submission",
      callTool("submit_recommendation", { decision: "approve" }),
    ],
  ])("counts %s toward the tool-call limit", async (_, badCall) => {
    const { result } = run([badCall, badCall, badCall], {
      limits: { ...LIMITS, maxToolCalls: 2 },
    });

    const outcome = await result;

    expect(outcome.endedBy).toBe("max_tool_calls");
    expect(outcome.toolCalls).toBe(2);
  });

  it("still takes a valid submission at the tool-call limit", async () => {
    const { result } = run(
      [
        callTool("lookup_venue", { name: "A" }),
        callTool("submit_recommendation", approval),
      ],
      { limits: { ...LIMITS, maxToolCalls: 1 } },
    );

    expect((await result).endedBy).toBe("submitted");
  });

  it("refuses a search past the budget, lets the model decide, and escalates", async () => {
    const queries: string[] = [];
    const counted = defineTool({
      ...webSearch,
      execute: ({ query }: { query: string }) => {
        queries.push(query);
        return Promise.resolve({ results: [] });
      },
    });
    const { provider, result } = run(
      [
        callTool("web_search", { query: "sala lumbre" }),
        callTool("web_search", { query: "noche de jazz" }),
        callTool("submit_recommendation", approval),
      ],
      { tools: [counted] },
    );

    const outcome = await result;

    expect(queries).toEqual(["sala lumbre"]);
    expect(outcome.endedBy).toBe("submitted");
    expect(outcome.webSearches).toBe(1);
    expect(outcome.recommendation.decision).toBe("approve");
    expect(outcome.autonomy).toMatchObject({
      autonomy: "escalated",
      reasons: ["web search budget spent"],
    });
    expect(lastToolResult(provider, "web_search")).toContain(
      "No searches left",
    );
  });

  it("lets a rejection on a hard signal resolve though the search budget was spent", async () => {
    const offPlatform = systemFinding(
      "rule",
      "off_platform_payment",
      "fail",
      "Pide el pago por Bizum.",
    );
    const { result } = run(
      [
        callTool("web_search", { query: "sala lumbre" }),
        callTool("web_search", { query: "noche de jazz" }),
        callTool("submit_recommendation", {
          ...approval,
          decision: "reject",
          findings: [],
        }),
      ],
      { systemFindings: [...venueVerified, offPlatform] },
    );

    expect((await result).autonomy).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["hard signals: off_platform_payment"],
    });
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
