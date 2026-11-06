// Checks reviewSubject end to end against the Satella mock: the context is
// read, the deterministic and venue checks run, the loop runs, the
// recommendation lands in Satella with the policy's autonomy, and a subject
// that changes during the review is re-reviewed instead of retried. The
// exact-clone check asks Satella for similar events before the model, and the
// copied-text check searches the description. Fakes Satella with the mock
// server, the model with the scripted provider, the venue checks with canned
// findings and the web with the authored search.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  callTool,
  createScriptedProvider,
  lastToolResult,
} from "../test-support/scripted-provider.js";
import type { LlmProvider } from "../providers/types.js";
import {
  createSatellaClient,
  type SatellaClient,
} from "../satella-client/client.js";
import { SatellaApiError } from "../satella-client/errors.js";
import { fixtures } from "../satella-client/fixtures.js";
import {
  type MockSatella,
  startMockSatella,
} from "../satella-client/mock-server.js";
import { createAuthoredSearch } from "../search/authored.js";
import { type WebSearch, WebSearchError } from "../search/types.js";
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
  verdict: "pass" | "fail" | "unknown",
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

function firstSessionStart(): string {
  const start = fixtures.eventContext.sessions[0]?.startsAt;
  if (start === undefined) throw new Error("fixture without a session");
  return start;
}

function satellaClient() {
  return createSatellaClient({
    baseUrl: mock.baseUrl,
    getAccessToken: () => Promise.resolve(TOKEN),
    correlationId: "run-1",
  });
}

function review(
  provider: LlmProvider,
  venueChecks = verifiedVenue,
  satella: SatellaClient = satellaClient(),
  webSearch?: WebSearch,
) {
  return reviewSubject({
    subject: { type: "event", id: "evt_0001" },
    runId: "run-1",
    satella,
    provider,
    limits: { maxToolCalls: 10, maxTokens: 100_000, maxWebSearches: 2 },
    autoApproveThreshold: 0.85,
    venueChecks,
    ...(webSearch === undefined ? {} : { webSearch }),
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
  expect(lastToolResult(provider, "find_similar_events")).toContain(
    "Noche jazz Lumbre",
  );
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

it("rejects an exact clone on the code's rule, shown to the model first", async () => {
  await mock.close();
  const [original] = fixtures.similarEvents;
  if (original === undefined)
    throw new Error("fixture without a similar event");
  mock = await startMockSatella({
    fixtures: {
      events: [fixtures.eventContext],
      organizers: [fixtures.organizerContext],
      similar: {
        evt_0001: [
          {
            ...original,
            title: fixtures.eventContext.event.title,
            titleSimilarity: 1,
            firstSessionInWindow: firstSessionStart(),
          },
        ],
      },
    },
    tokens: { [TOKEN]: ["agent:read", "agent:recommend"] },
  });
  const provider = createScriptedProvider([
    callTool("submit_recommendation", { ...approval, decision: "reject" }),
  ]);

  const result = await review(provider);

  expect(result.review.findings).toContainEqual(
    expect.objectContaining({
      check: "exact_duplicate_other_organizer",
      verdict: "fail",
    }),
  );
  expect(result.review.autonomy).toBe("auto_resolved");
  expect(provider.requests[0]?.messages[1]?.content).toContain("Regla de clon");
});

it("goes on when Satella can't serve the similar events", async () => {
  const satella = satellaClient();
  const unavailable: SatellaClient = {
    ...satella,
    findSimilarEvents: () =>
      Promise.reject(
        new SatellaApiError("SATELLA_UNAVAILABLE", "findSimilarEvents", null),
      ),
  };
  const provider = createScriptedProvider([
    callTool("submit_recommendation", approval),
  ]);

  const result = await review(provider, verifiedVenue, unavailable);

  expect(result.review.decision).toBe("approve");
  expect(
    result.review.findings.filter(
      (finding) =>
        finding.check === "exact_duplicate_other_organizer" &&
        finding.verdict === "fail",
    ),
  ).toEqual([]);
});

it("holds back an approval when another site has the description word for word", async () => {
  const web = createAuthoredSearch([
    {
      url: "https://entradas-ejemplo.test/eventos/jazz",
      title: "Noche de jazz | EntradasEjemplo",
      snippet: `Otro organizador: ${fixtures.eventContext.event.description ?? ""}`,
    },
  ]);
  const provider = createScriptedProvider([
    callTool("submit_recommendation", approval),
  ]);

  const result = await review(provider, verifiedVenue, satellaClient(), web);

  expect(provider.requests[0]?.messages[1]?.content).toContain("Texto copiado");
  expect(result.review.findings).toContainEqual(
    expect.objectContaining({ check: "text_originality", verdict: "warn" }),
  );
  expect(result.review.decision).toBe("request_info");
  expect(result.review.autonomy).toBe("escalated");
});

describe("with web search down (#82)", () => {
  const down: WebSearch = {
    provider: "down",
    search: () => Promise.reject(new WebSearchError("quota_exceeded")),
  };
  // A capacity fallback that searches, as the real one does when neither
  // Wikidata nor OSM publishes the capacity.
  const venueSearchingTheWeb: VenueChecks = async (_context, search) => {
    const found = await search
      ?.search({ query: "Lumbre Madrid aforo", maxResults: 5 })
      .then(
        () => true,
        () => false,
      );
    return [
      venueFinding("venue_exists", "pass", "Recinto verificado."),
      venueFinding(
        "venue_capacity",
        found === true ? "pass" : "unknown",
        "Aforo sin publicar.",
      ),
    ];
  };

  async function reviewWithSearchDown() {
    const provider = createScriptedProvider([
      callTool("web_search", { query: "Noche jazz Lumbre organizador" }),
      callTool("submit_recommendation", approval),
    ]);
    const result = await review(
      provider,
      venueSearchingTheWeb,
      satellaClient(),
      down,
    );
    return { provider, result };
  }

  it("tells the admin the description's originality went unchecked", async () => {
    const { result } = await reviewWithSearchDown();
    expect(result.review.findings).toContainEqual(
      expect.objectContaining({
        check: "text_originality",
        verdict: "unknown",
      }),
    );
  });

  it("never lets the approval resolve on its own, and says why", async () => {
    const { result } = await reviewWithSearchDown();
    expect(result.review.decision).toBe("approve");
    expect(result.review.autonomy).toBe("escalated");
    expect(result.run.autonomy.reasons).toContain("web search unavailable");
  });

  it("tells the model search is down, and traces its search as failed", async () => {
    const { provider, result } = await reviewWithSearchDown();
    expect(lastToolResult(provider, "web_search")).toContain("quota_exceeded");
    expect(result.run.trace).toContainEqual({
      tool: "web_search",
      ok: false,
      error: "WEB_SEARCH_FAILED",
    });
  });

  it("counts every search the review ran, the code's included", async () => {
    const { result } = await reviewWithSearchDown();
    // Copied text, capacity fallback and the model's one.
    expect(result.run.searches).toEqual({ total: 3, failed: 3 });
    expect(result.run.webSearches).toBe(1);
  });
});

it("counts the searches that worked as run, none failed", async () => {
  const provider = createScriptedProvider([
    callTool("web_search", { query: "Noche jazz Lumbre organizador" }),
    callTool("submit_recommendation", approval),
  ]);
  const result = await review(
    provider,
    verifiedVenue,
    satellaClient(),
    createAuthoredSearch([]),
  );
  expect(result.run.searches).toEqual({ total: 2, failed: 0 });
  expect(result.review.autonomy).toBe("auto_resolved");
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
