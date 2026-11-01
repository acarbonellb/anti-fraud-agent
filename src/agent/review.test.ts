// Checks reviewSubject end to end against the Satella mock: the context is
// read, the loop runs, the recommendation lands in Satella with the policy's
// autonomy, and a subject that changes during the review is re-reviewed
// instead of retried. Fakes Satella with the mock server and the model with
// the scripted provider.
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  callTool,
  createScriptedProvider,
} from "../providers/scripted-provider.js";
import type { LlmProvider } from "../providers/types.js";
import { createSatellaClient } from "../satella-client/client.js";
import { fixtures } from "../satella-client/fixtures.js";
import {
  type MockSatella,
  startMockSatella,
} from "../satella-client/mock-server.js";
import { PROMPT_VERSION } from "./prompt.js";
import { reviewSubject } from "./review.js";

const TOKEN = "token";
let mock: MockSatella;

beforeEach(async () => {
  mock = await startMockSatella({
    fixtures: {
      events: [fixtures.eventContext],
      organizers: [fixtures.organizerContext],
      similar: { evt_0001: fixtures.similarEvents },
    },
    tokens: { [TOKEN]: ["agent:read", "agent:recommend"] },
  });
});

afterEach(async () => {
  await mock.close();
});

const approval = {
  decision: "approve",
  confidence: 0.92,
  rationale: "Recinto verificado y sin eventos clonados.",
  findings: [
    {
      check: "exact_duplicate_other_organizer",
      verdict: "pass",
      detail: "Ningún evento igual de otro organizador.",
      confidence: 0.9,
      sources: [],
    },
  ],
};

function review(provider: LlmProvider) {
  return reviewSubject({
    subject: { type: "event", id: "evt_0001" },
    runId: "run-1",
    satella: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve(TOKEN),
      correlationId: "run-1",
    }),
    provider,
    limits: { maxToolCalls: 10, maxTokens: 100_000, maxWebSearches: 2 },
    autoApproveThreshold: 0.85,
  });
}

it("reviews an event and submits the recommendation to Satella", async () => {
  const provider = createScriptedProvider([
    callTool("find_similar_events", { eventId: "evt_0001" }),
    callTool("submit_recommendation", approval),
  ]);

  const result = await review(provider);

  expect(result.created).toBe(true);
  expect(result.review).toMatchObject({
    subject: {
      type: "event",
      id: "evt_0001",
      version: fixtures.eventContext.version,
    },
    decision: "approve",
    autonomy: "auto_resolved",
    status: "auto_resolved",
    agentRunId: "run-1",
    promptVersion: PROMPT_VERSION,
    provider: "scripted",
  });
  const similarResult = provider.requests[1]?.messages.at(-1)?.content;
  expect(similarResult).toContain("Noche jazz Lumbre");
  // The deterministic checks ran first and their findings travel with it.
  expect(result.review.findings.map((finding) => finding.check)).toContain(
    "postal_code_province",
  );
});

it("re-reviews when the event changes during the review", async () => {
  const script = createScriptedProvider([
    callTool("submit_recommendation", approval),
    callTool("submit_recommendation", approval),
  ]);
  let calls = 0;
  const provider: LlmProvider = {
    provider: script.provider,
    model: script.model,
    complete: (request) => {
      calls += 1;
      // The organizer edits the event while the first review runs.
      if (calls === 1) mock.setSubjectVersion("event", "evt_0001", "v2-edited");
      return script.complete(request);
    },
  };

  const result = await review(provider);

  expect(result.attempts).toBe(2);
  expect(result.review.subject.version).toBe("v2-edited");
  expect(mock.reviews).toHaveLength(1);
});
