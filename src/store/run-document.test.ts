// Checks the run document a reviewed subject becomes: the recommendation, its
// autonomy, usage, cost and trace as the dashboard shows them (brief §6.1),
// and that nothing beyond them reaches the store: no tool response, nothing
// else from Satella's review (CLAUDE.md §4, minimal logs). Fakes the review
// result by hand.
import { describe, expect, it } from "vitest";

import type { ReviewSubjectResult } from "../agent/review.js";
import { runDocumentSchema, toRunDocument } from "./run-document.js";

const finding = {
  check: "venue_exists",
  verdict: "pass" as const,
  detail: "Recinto verificado.",
  confidence: 1,
  sources: [{ url: "https://www.openstreetmap.org/node/1", title: "OSM" }],
};

function reviewed(): ReviewSubjectResult {
  return {
    run: {
      promptVersion: "review-v7",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      endedBy: "submitted",
      recommendation: {
        decision: "request_info",
        confidence: 0.84,
        rationale: "Falta el aforo del recinto.",
        findings: [finding],
        infoRequest: {
          questions: ["¿Cuál es el aforo?"],
          draft: "Hola, ¿nos indicas el aforo?",
        },
      },
      systemFindings: [finding],
      autonomy: {
        autonomy: "escalated",
        reasons: ["needs judgement"],
        confidence: 0.84,
      },
      modelConfidence: 0.9,
      usage: {
        inputTokens: 12_000,
        outputTokens: 800,
        cacheReadInputTokens: 9_000,
        cacheWriteInputTokens: 1_000,
      },
      toolCalls: 3,
      webSearches: 1,
      searches: { total: 3, failed: 1 },
      trace: [
        { tool: "get_event_context", ok: true },
        { tool: "web_search", ok: false, error: "BUDGET_SPENT" },
      ],
    },
    review: {
      id: "rev_1",
      subject: { type: "event", id: "evt_1", version: "v42" },
      decision: "request_info",
      autonomy: "escalated",
      confidence: 0.84,
      rationale: "Falta el aforo del recinto.",
      findings: [finding],
      infoRequest: null,
      agentRunId: "run_1",
      promptVersion: "review-v7",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      status: "pending_admin",
      createdAt: "2026-11-05T10:00:03.000Z",
      resolution: null,
    },
    created: true,
    attempts: 1,
  };
}

const metadata = {
  runId: "run_1",
  trigger: "scheduled" as const,
  effort: "medium",
  startedAt: new Date("2026-11-05T10:00:00.000Z"),
  finishedAt: new Date("2026-11-05T10:00:04.250Z"),
  costMicros: 1_590,
};

describe("toRunDocument", () => {
  it("records the run as the dashboard shows it", () => {
    expect(toRunDocument(reviewed(), metadata)).toEqual({
      runId: "run_1",
      outcome: "completed",
      trigger: "scheduled",
      startedAt: "2026-11-05T10:00:00.000Z",
      finishedAt: "2026-11-05T10:00:04.250Z",
      latencyMs: 4_250,
      subject: { type: "event", id: "evt_1", version: "v42" },
      provider: "anthropic",
      model: "claude-haiku-5-5",
      effort: "medium",
      promptVersion: "review-v7",
      decision: "request_info",
      autonomy: "escalated",
      autonomyReasons: ["needs judgement"],
      confidence: 0.84,
      modelConfidence: 0.9,
      findings: [finding],
      rationale: "Falta el aforo del recinto.",
      infoRequest: {
        questions: ["¿Cuál es el aforo?"],
        draft: "Hola, ¿nos indicas el aforo?",
      },
      endedBy: "submitted",
      usage: {
        inputTokens: 12_000,
        outputTokens: 800,
        cacheReadInputTokens: 9_000,
        cacheWriteInputTokens: 1_000,
      },
      costMicros: 1_590,
      toolCalls: 3,
      webSearches: 1,
      searches: { total: 3, failed: 1 },
      trace: [
        { tool: "get_event_context", ok: true },
        { tool: "web_search", ok: false, error: "BUDGET_SPENT" },
      ],
      review: { id: "rev_1", created: true, attempts: 1 },
    });
  });

  it("keeps an unknown cost unknown and a missing cache count at zero", () => {
    const result = reviewed();
    result.run.usage = { inputTokens: 10, outputTokens: 5 };
    delete result.run.recommendation.infoRequest;

    const document = toRunDocument(result, {
      ...metadata,
      effort: null,
      costMicros: null,
    });

    expect(document.costMicros).toBeNull();
    expect(document.effort).toBeNull();
    expect(document.infoRequest).toBeNull();
    expect(document.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });

  it("carries no tool response and nothing else of Satella's review", () => {
    const result = reviewed();
    // What a future trace entry or tool might drag along must not reach it.
    Object.assign(result.run.trace[0] ?? {}, {
      output: { organizerEmail: "secret@example.org" },
    });

    const stored = JSON.stringify(toRunDocument(result, metadata));

    expect(stored).not.toContain("secret@example.org");
    expect(stored).not.toContain("pending_admin");
    expect(stored).not.toContain("createdAt");
  });

  it("is what the store validates when it reads one back", () => {
    const document = toRunDocument(reviewed(), metadata);

    expect(runDocumentSchema.parse(document)).toEqual(document);
  });
});
