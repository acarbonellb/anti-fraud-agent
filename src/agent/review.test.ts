// Checks reviewSubject end to end against the Satella mock: the context is
// read, the deterministic and venue checks run, the loop runs, the
// recommendation lands in Satella with the policy's autonomy, and a subject
// that changes during the review is re-reviewed instead of retried. Fakes
// Satella with the mock server, the model with the scripted provider and the
// venue checks with canned findings.
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
import type { SystemFinding } from "../checks/types.js";
import type { VenueChecks } from "../venue/venue-checks.js";
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

const COVERS = ["venue_exists", "venue_capacity", "capacity_far_above_venue"];
const osm = { url: "https://www.openstreetmap.org/node/1", title: "OSM" };
const venueFinding = (
  check: string,
  verdict: "pass" | "fail",
  detail: string,
): SystemFinding => ({
  certainty: "heuristic",
  finding: { check, verdict, detail, confidence: 1, sources: [osm] },
  covers: COVERS,
});
const verifiedVenue: VenueChecks = () =>
  Promise.resolve([
    venueFinding("venue_exists", "pass", "Recinto verificado."),
    venueFinding("venue_capacity", "pass", "Aforo compatible."),
  ]);

function review(provider: LlmProvider, venueChecks = verifiedVenue) {
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
    venueChecks,
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

it("shows the venue findings to the model fenced, and they win over the model's", async () => {
  const farAbove = venueFinding(
    "capacity_far_above_venue",
    "fail",
    "Señal grave de aforo: 14,3 veces el aforo.",
  );
  const provider = createScriptedProvider([
    callTool("submit_recommendation", {
      ...approval,
      findings: [
        {
          check: "venue_capacity",
          verdict: "pass",
          detail: "Cabe.",
          confidence: 0.9,
          sources: [],
        },
      ],
    }),
  ]);

  const result = await review(provider, () =>
    Promise.resolve([
      venueFinding("venue_exists", "pass", "Recinto verificado."),
      farAbove,
    ]),
  );

  const user = provider.requests[0]?.messages[1]?.content ?? "";
  const fenced = user.slice(user.indexOf('source="deterministic_checks"'));
  expect(fenced).toContain("14,3 veces el aforo");
  expect(fenced).toContain(osm.url);
  const venueChecks = result.review.findings.filter((finding) =>
    COVERS.includes(finding.check),
  );
  expect(venueChecks.map((finding) => finding.verdict)).toEqual([
    "pass",
    "fail",
  ]);
  expect(result.review.autonomy).toBe("escalated");
});

it("never runs the venue checks on an organizer, and escalates it", async () => {
  let ran = false;
  const provider = createScriptedProvider([
    callTool("submit_recommendation", approval),
  ]);
  const result = await reviewSubject({
    subject: {
      type: "organizer",
      id: fixtures.organizerContext.organizer.id,
    },
    runId: "run-2",
    satella: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve(TOKEN),
      correlationId: "run-2",
    }),
    provider,
    limits: { maxToolCalls: 10, maxTokens: 100_000, maxWebSearches: 2 },
    autoApproveThreshold: 0.85,
    venueChecks: () => {
      ran = true;
      return Promise.resolve([]);
    },
  });
  expect(ran).toBe(false);
  expect(result.review.autonomy).toBe("escalated");
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
