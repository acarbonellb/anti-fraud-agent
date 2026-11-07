// Checks the scheduled pass end to end (#45): it reads the feed from the
// stored cursor, reviews each reviewable subject once per page, stores a run
// for each, advances the cursor, stops at the day's budget, stores a failed
// run and moves on, tries a review that failed for a passing reason again on
// later passes, a bounded number of times, and records an admin's resolution next to its run. Fakes
// Satella with the mock server, the model with the scripted provider (named
// as Haiku 5.5, so its real prices apply), the store with the in-memory one
// and the venue checks with canned findings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SystemFinding } from "../checks/types.js";
import {
  callTool,
  createScriptedProvider,
} from "../test-support/scripted-provider.js";
import {
  type CompletionResponse,
  type LlmProvider,
  ProviderError,
} from "../providers/types.js";
import { createSatellaClient } from "../satella-client/client.js";
import { fixtures } from "../satella-client/fixtures.js";
import {
  type MockSatella,
  startMockSatella,
} from "../satella-client/mock-server.js";
import type { FeedItem, Subject } from "../satella-client/schemas.js";
import { type WebSearch, WebSearchError } from "../search/types.js";
import { createMemoryStore } from "../store/memory-store.js";
import type { AgentStore } from "../store/types.js";
import type { VenueChecks } from "../venue/venue-checks.js";
import { type PassLogLine, type PassOptions, runPass } from "./pass.js";

const TOKEN = "token";
const HAIKU = { provider: "anthropic", model: "claude-haiku-5-5" };
// 10,000 tokens at Haiku 5.5's dearest rate ($2.50 per million output
// tokens on the long-prompt card), twice: the review and its re-review after
// a stale subject. The hold each run reserves.
const WORST_CASE = 50_000;
// One scripted call: 100 input × $0.10 + 20 output × $0.50, per million.
const ONE_CALL = 20;

const secondEvent = {
  ...fixtures.eventContext,
  version: "v1-evt2",
  event: { ...fixtures.eventContext.event, id: "evt_0002" },
};

let mock: MockSatella;
let store: AgentStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date("2026-11-05T10:00:00.000Z");
  store = createMemoryStore({ now: () => clock });
  mock = await startMockSatella({
    fixtures: {
      events: [fixtures.eventContext, secondEvent],
      organizers: [fixtures.organizerContext],
    },
    tokens: { [TOKEN]: ["agent:read", "agent:recommend"] },
  });
});

afterEach(async () => {
  await mock.close();
});

let itemCount = 0;
function feedItem(
  type: FeedItem["type"],
  subject: Subject,
  extra: Partial<FeedItem> = {},
): FeedItem {
  itemCount += 1;
  return {
    id: `fe_${String(itemCount)}`,
    type,
    subject,
    occurredAt: "2026-11-05T09:00:00.000Z",
    ...extra,
  };
}

const evt1 = { type: "event", id: "evt_0001" } as const;
const evt2 = { type: "event", id: "evt_0002" } as const;
const org1 = { type: "organizer", id: "org_0001" } as const;

const approval = {
  decision: "approve",
  confidence: 0.92,
  rationale: "Recinto verificado y sin señales de fraude.",
  findings: [],
};
const submits = (count: number): CompletionResponse[] =>
  Array.from({ length: count }, () =>
    callTool("submit_recommendation", approval),
  );

const verifiedVenue: VenueChecks = () =>
  Promise.resolve<SystemFinding[]>([
    {
      certainty: "heuristic",
      finding: {
        check: "venue_exists",
        verdict: "pass",
        detail: "Recinto verificado.",
        confidence: 1,
        sources: [
          { url: "https://www.openstreetmap.org/node/1", title: "OSM" },
        ],
      },
      covers: ["venue_exists", "venue_capacity", "capacity_far_above_venue"],
    },
  ]);

let runCount = 0;
function pass(
  provider: LlmProvider,
  overrides: Partial<PassOptions> = {},
): ReturnType<typeof runPass> {
  return runPass({
    satella: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve(TOKEN),
      correlationId: "pass-1",
    }),
    correlationId: "pass-1",
    provider,
    store,
    now: () => clock,
    newRunId: () => `run_${String((runCount += 1))}`,
    limits: { maxToolCalls: 10, maxTokens: 10_000, maxWebSearches: 2 },
    autoApproveThreshold: 0.85,
    dailyBudgetMicros: 1_000_000,
    effort: "medium",
    venueChecks: verifiedVenue,
    ...overrides,
  });
}

async function storedRuns() {
  return (await store.listRuns({ limit: 50 })).runs;
}

describe("a pass over a page of the feed", () => {
  it("reviews each reviewable subject once and stores a run for each", async () => {
    for (const item of [
      feedItem("organizer.registered", org1),
      feedItem("event.published", evt1),
      feedItem("event.content_updated", evt1, { changedFields: ["title"] }),
      feedItem("event.minor_change", evt2, { kind: "minor" }),
    ]) {
      mock.appendFeedItem(item);
    }
    const log: PassLogLine[] = [];

    const report = await pass(createScriptedProvider(submits(2), HAIKU), {
      log: (line) => log.push(line),
    });

    expect(report.stoppedBy).toBe("end_of_page");
    const runs = await storedRuns();
    expect(
      runs.map((run) => [run.outcome, run.subject.type, run.subject.id]),
    ).toEqual(
      expect.arrayContaining([
        ["completed", "organizer", "org_0001"],
        ["completed", "event", "evt_0001"],
      ]),
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      trigger: "scheduled",
      provider: "anthropic",
      effort: "medium",
      costMicros: ONE_CALL,
    });
    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "org_0001",
      "evt_0001",
    ]);
    // The day's spend is what the runs cost, with no hold left open.
    expect(await store.daySpend()).toMatchObject({
      settledMicros: 2 * ONE_CALL,
      heldMicros: 0,
    });
    expect(log.length).toBeGreaterThan(0);
    for (const line of log) expect(line.correlationId).toBe("pass-1");
    expect(log.filter((line) => line.runId !== undefined)).not.toHaveLength(0);
  });

  it("reports the web searches its reviews ran and how many failed (#82)", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    mock.appendFeedItem(feedItem("event.published", evt2));
    // Down for the first review's search, back for the second's.
    let calls = 0;
    const flaky: WebSearch = {
      provider: "flaky",
      search: () =>
        (calls += 1) === 1
          ? Promise.reject(new WebSearchError("quota_exceeded"))
          : Promise.resolve([]),
    };

    const report = await pass(createScriptedProvider(submits(2), HAIKU), {
      webSearch: flaky,
    });

    expect(report.searches).toEqual({ total: 2, failed: 1 });
    expect(
      (await storedRuns()).map((run) =>
        run.outcome === "completed" ? run.searches : null,
      ),
    ).toEqual(
      expect.arrayContaining([
        { total: 1, failed: 1 },
        { total: 1, failed: 0 },
      ]),
    );
  });

  it("reports the searches of a review that failed, which spent them too (#82)", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    const down: WebSearch = {
      provider: "down",
      search: () => Promise.reject(new WebSearchError("quota_exceeded")),
    };

    const report = await pass(
      {
        ...HAIKU,
        complete: () =>
          Promise.reject(new ProviderError("LLM_UNAVAILABLE", "anthropic")),
      },
      { webSearch: down },
    );

    expect(report.runs).toEqual([
      expect.objectContaining({ subject: evt1, outcome: "failed" }),
    ]);
    // The copied-text check searched before the model failed.
    expect(report.searches).toEqual({ total: 1, failed: 1 });
  });

  it("resumes from the stored cursor", async () => {
    mock.appendFeedItem(feedItem("organizer.registered", org1));
    await pass(createScriptedProvider(submits(1), HAIKU));
    mock.appendFeedItem(feedItem("event.published", evt1));

    await pass(createScriptedProvider(submits(1), HAIKU));

    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "org_0001",
      "evt_0001",
    ]);
    expect(await storedRuns()).toHaveLength(2);
  });

  it("asks the feed for at most a page of items", async () => {
    for (const subject of [org1, evt1, evt2]) {
      mock.appendFeedItem(feedItem("event.published", subject));
    }

    await pass(createScriptedProvider(submits(2), HAIKU), { pageSize: 2 });

    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "org_0001",
      "evt_0001",
    ]);
  });
});

describe("the day's budget", () => {
  it("stops before the feed when the day can't take one more run", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));

    const report = await pass(createScriptedProvider([], HAIKU), {
      dailyBudgetMicros: WORST_CASE - 1,
    });

    expect(report.stoppedBy).toBe("budget");
    expect(mock.requests).toHaveLength(0);
    expect(await store.readFeedCursor()).toBeNull();
  });

  it("reviews only what the day can take and leaves the rest for later", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    mock.appendFeedItem(feedItem("event.published", evt2));
    // Room for one worst-case run: the first costs 20 µ$, so a second won't fit.
    const budget = WORST_CASE + ONE_CALL - 1;

    const first = await pass(createScriptedProvider(submits(1), HAIKU), {
      dailyBudgetMicros: budget,
    });
    const second = await pass(createScriptedProvider([], HAIKU), {
      dailyBudgetMicros: budget,
    });

    expect(first.stoppedBy).toBe("end_of_page");
    expect(second.stoppedBy).toBe("budget");
    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "evt_0001",
    ]);

    // The next day, the pass picks up the item it left.
    clock = new Date("2026-11-06T00:05:00.000Z");
    await pass(createScriptedProvider(submits(1), HAIKU), {
      dailyBudgetMicros: budget,
    });
    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "evt_0001",
      "evt_0002",
    ]);
  });

  it("stops mid-page when another run took the budget, leaving the cursor", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    mock.appendFeedItem(feedItem("event.published", evt2));
    const budget = 2 * WORST_CASE;
    // Another run (an on-demand review) reserves once this pass has read the page.
    const busy: AgentStore = {
      ...store,
      async reserveSpend(input) {
        const reservation = await store.reserveSpend(input);
        await store.reserveSpend({
          runId: "run_on_demand",
          micros: WORST_CASE,
          budgetMicros: budget,
        });
        return reservation;
      },
    };

    const report = await pass(createScriptedProvider(submits(1), HAIKU), {
      store: busy,
      dailyBudgetMicros: budget,
    });

    expect(report.stoppedBy).toBe("budget");
    expect(report.runs.map((run) => run.subject.id)).toEqual(["evt_0001"]);
    expect(await store.readFeedCursor()).toBeNull();
  });

  it("still counts the page's skipped items when it stops mid-page", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    mock.appendFeedItem(
      feedItem("event.minor_change", evt1, { kind: "minor" }),
    );
    mock.appendFeedItem(feedItem("event.published", evt2));
    // Room for a page of three; the other run then takes what the second needs.
    const budget = 3 * WORST_CASE;
    const busy: AgentStore = {
      ...store,
      async reserveSpend(input) {
        const reservation = await store.reserveSpend(input);
        await store.reserveSpend({
          runId: "run_on_demand",
          micros: 2 * WORST_CASE,
          budgetMicros: budget,
        });
        return reservation;
      },
    };

    const report = await pass(createScriptedProvider(submits(1), HAIKU), {
      store: busy,
      dailyBudgetMicros: budget,
    });

    expect(report.stoppedBy).toBe("budget");
    expect(report.skippedItems).toBe(1);
  });

  it("refuses to run a model it can't price", async () => {
    await expect(pass(createScriptedProvider([]))).rejects.toMatchObject({
      code: "PASS_UNPRICED_MODEL",
    });
    expect(mock.requests).toHaveLength(0);
  });
});

describe("a review that fails", () => {
  it("is stored as failed with its code, and the pass moves on", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    mock.appendFeedItem(feedItem("event.published", evt2));
    const scripted = createScriptedProvider(submits(1), HAIKU);
    let calls = 0;
    const unreachableFirst: LlmProvider = {
      ...HAIKU,
      complete(request) {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(
            new ProviderError("LLM_UNAVAILABLE", "anthropic"),
          );
        }
        return scripted.complete(request);
      },
    };

    const report = await pass(unreachableFirst);

    expect(report.stoppedBy).toBe("end_of_page");
    const runs = await storedRuns();
    expect(runs.find((run) => run.subject.id === "evt_0001")).toMatchObject({
      outcome: "failed",
      error: { code: "LLM_UNAVAILABLE" },
      costMicros: 0,
    });
    expect(runs.find((run) => run.subject.id === "evt_0002")).toMatchObject({
      outcome: "completed",
    });
    expect(await store.readFeedCursor()).not.toBeNull();
    expect(await store.daySpend()).toMatchObject({
      settledMicros: ONE_CALL,
      heldMicros: 0,
    });
  });
});

describe("a review that fails for a reason that can pass", () => {
  const unavailable = () =>
    Promise.reject(new ProviderError("LLM_UNAVAILABLE", "anthropic"));

  it("is tried again on the next pass, and leaves the queue once it completes", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));

    const first = await pass({ ...HAIKU, complete: unavailable });
    const second = await pass(createScriptedProvider(submits(1), HAIKU));

    expect(first.retriesQueued).toBe(1);
    expect(second.runs).toEqual([
      expect.objectContaining({ subject: evt1, outcome: "completed" }),
    ]);
    expect(second.retriesQueued).toBe(0);
    expect(await store.readRetryQueue()).toEqual([]);
    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "evt_0001",
    ]);
  });

  it("is given up after three failed reviews, with a line to alert on", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    const log: PassLogLine[] = [];
    const down = { ...HAIKU, complete: unavailable };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await pass(down, { log: (line) => log.push(line) });
    }

    expect(await storedRuns()).toHaveLength(3);
    expect(await store.readRetryQueue()).toEqual([]);
    expect(log.filter((line) => line.event === "run.abandoned")).toEqual([
      expect.objectContaining({
        level: "warn",
        subject: evt1,
        code: "LLM_UNAVAILABLE",
        failures: 3,
      }),
    ]);
  });

  it("isn't queued when another try would fail the same way", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    const badRequest = () =>
      Promise.reject(new ProviderError("LLM_HTTP_ERROR", "anthropic", 400));

    const report = await pass({ ...HAIKU, complete: badRequest });

    expect(report.retriesQueued).toBe(0);
    expect(await store.readRetryQueue()).toEqual([]);
  });

  it("takes at most half a pass, so the feed still moves", async () => {
    await store.replaceRetryQueue(
      [evt1, org1].map((subject) => ({
        subject,
        failures: 1,
        code: "SATELLA_UNAVAILABLE",
      })),
    );
    mock.appendFeedItem(feedItem("event.published", evt2));

    const report = await pass(createScriptedProvider(submits(2), HAIKU), {
      pageSize: 2,
    });

    expect(mock.reviews.map((review) => review.subject.id)).toEqual([
      "evt_0001",
      "evt_0002",
    ]);
    expect(await store.readRetryQueue()).toEqual([
      expect.objectContaining({ subject: org1 }),
    ]);
    expect(report.retriesQueued).toBe(1);
  });
});

describe("a subject that changes during its review", () => {
  it("is reviewed again in the same run, which records the attempts", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    const scripted = createScriptedProvider(submits(2), HAIKU);
    let calls = 0;
    const editedMidReview: LlmProvider = {
      ...HAIKU,
      complete(request) {
        calls += 1;
        if (calls === 1) mock.setSubjectVersion("event", "evt_0001", "v2");
        return scripted.complete(request);
      },
    };

    await pass(editedMidReview);

    expect(await storedRuns()).toEqual([
      expect.objectContaining({
        outcome: "completed",
        subject: expect.objectContaining({ version: "v2" }) as unknown,
        review: expect.objectContaining({ attempts: 2 }) as unknown,
        costMicros: 2 * ONE_CALL,
      }),
    ]);
  });
});

describe("an admin's resolution", () => {
  it("is recorded next to the run that made the recommendation", async () => {
    mock.appendFeedItem(feedItem("event.published", evt1));
    await pass(createScriptedProvider(submits(1), HAIKU));
    const review = mock.reviews[0];
    if (review === undefined) throw new Error("no review submitted");
    mock.resolveReview(review.id, "dismissed");
    mock.appendFeedItem(
      feedItem("agent_review.resolved", evt1, { reviewId: review.id }),
    );

    const report = await pass(createScriptedProvider([], HAIKU));

    expect(report.resolutions).toBe(1);
    expect(await store.getResolution(review.agentRunId)).toMatchObject({
      runId: review.agentRunId,
      reviewId: review.id,
      outcome: "dismissed",
    });
    // A resolution starts no review.
    expect(mock.reviews).toHaveLength(1);
  });
});
