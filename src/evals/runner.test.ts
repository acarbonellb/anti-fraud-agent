// Checks the eval runner end to end: recording two cases through the real
// agent (Satella mock, deterministic checks, loop, policy) and replaying the
// recordings gives identical outcomes; a changed prompt, a missing recording
// or a venue response that wasn't recorded marks a case stale instead of
// scoring it. Fakes the model with the scripted provider and the venue
// providers' network with canned responses; everything else is real.
import { describe, expect, it } from "vitest";

import { REVIEW_PROMPT } from "../agent/prompt.js";
import {
  callTool,
  createScriptedProvider,
} from "../test-support/scripted-provider.js";
import { fixtures } from "../satella-client/fixtures.js";
import { createAuthoredSearch } from "../search/authored.js";
import { fakeVenueFetch } from "../test-support/fake-venue-fetch.js";
import type { Recording } from "./recording.js";
import { recordCase, replayCase, replaySet } from "./runner.js";
import { toolRecordingSchema } from "./tool-recording.js";
import type { EvalCase } from "./types.js";

const CLOCK = new Date("2026-11-02T10:00:00.000Z");
const network = {
  fetch: fakeVenueFetch({
    latitude: 41.6523,
    longitude: -4.7245,
    capacity: 500,
  }),
  // An empty web: no case here searches.
  search: createAuthoredSearch([]),
};

const eventCase: EvalCase = {
  id: "N1",
  slug: "clean-event",
  title: "A clean event",
  subject: "event",
  expected: { decisions: ["approve"], autonomy: "auto_resolved" },
  build: () => ({
    event: fixtures.eventContext,
    organizer: fixtures.organizerContext,
    similar: fixtures.similarEvents,
  }),
};

const organizerCase: EvalCase = {
  id: "22",
  slug: "organizer",
  title: "An organizer",
  subject: "organizer",
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  build: () => ({ organizer: fixtures.organizerContext }),
};

const approval = {
  decision: "approve",
  confidence: 0.9,
  rationale: "Sin señales de fraude.",
  findings: [],
};

const request = {
  decision: "request_info",
  confidence: 0.7,
  rationale: "Faltan datos.",
  findings: [],
  infoRequest: { questions: ["¿Puede confirmar su CIF?"], draft: "Hola." },
};

async function recordBoth() {
  const event = await recordCase(
    eventCase,
    createScriptedProvider([
      callTool("find_similar_events", { eventId: "evt_0001" }),
      callTool("submit_recommendation", approval),
    ]),
    CLOCK,
    network,
  );
  const organizer = await recordCase(
    organizerCase,
    createScriptedProvider([callTool("submit_recommendation", request)]),
    CLOCK,
    network,
  );
  return { event, organizer };
}

describe("record then replay", () => {
  it("gives identical outcomes", async () => {
    const { event, organizer } = await recordBoth();

    expect(event.result.outcome).toMatchObject({
      decision: "approve",
      endedBy: "submitted",
      inputTokens: 200,
    });
    expect(organizer.result.outcome?.decision).toBe("request_info");
    // The model's number is kept next to the derived one (#77).
    expect(organizer.result.outcome?.modelConfidence).toBe(0.7);
    expect(event.recording).toMatchObject({
      caseId: "N1",
      provider: "scripted",
      promptVersion: REVIEW_PROMPT.version,
      clock: CLOCK.toISOString(),
    });
    expect(event.recording?.calls).toHaveLength(2);

    expect(
      await replayCase(eventCase, event.recording, event.toolRecording),
    ).toEqual(event.result);
    expect(
      await replayCase(
        organizerCase,
        organizer.recording,
        organizer.toolRecording,
      ),
    ).toEqual(organizer.result);
  });

  it("replays with the clock the recording ran with", async () => {
    const { event } = await recordBoth();
    const built: Date[] = [];
    const clocked: EvalCase = {
      ...eventCase,
      build: (clock) => {
        built.push(clock);
        return eventCase.build(clock);
      },
    };
    await replayCase(clocked, event.recording, event.toolRecording);
    expect(built).toEqual([CLOCK]);
  });
});

describe("stale recordings", () => {
  it("marks every case stale when the prompt changed", async () => {
    const { event, organizer } = await recordBoth();
    // Same version, other words: only the request hash can tell.
    const reworded = { ...REVIEW_PROMPT, system: () => "Otro prompt." };
    const bumped = { ...REVIEW_PROMPT, version: "review-v99" };

    for (const recorded of [
      [eventCase, event],
      [organizerCase, organizer],
    ] as const) {
      const [evalCase, { recording, toolRecording }] = recorded;
      expect(
        await replayCase(evalCase, recording, toolRecording, {
          prompt: reworded,
        }),
      ).toMatchObject({ outcome: null, failure: "stale: request_changed" });
      expect(
        await replayCase(evalCase, recording, toolRecording, {
          prompt: bumped,
        }),
      ).toMatchObject({ outcome: null, failure: "stale: prompt_version" });
    }
  });

  it("marks a missing recording stale", async () => {
    expect(await replayCase(eventCase, null, null)).toMatchObject({
      outcome: null,
      failure: "stale: missing_recording",
    });
  });

  it("marks a venue request with no recorded response stale", async () => {
    const { event } = await recordBoth();
    expect(event.toolRecording?.calls).toHaveLength(1);
    expect(
      await replayCase(eventCase, event.recording, {
        caseId: eventCase.id,
        calls: [],
      }),
    ).toMatchObject({ outcome: null, failure: "stale: missing_tool_response" });
  });

  it("records nothing when the model fails", async () => {
    const recorded = await recordCase(
      eventCase,
      createScriptedProvider([]),
      CLOCK,
      network,
    );
    expect(recorded.recording).toBeNull();
    expect(recorded.result).toMatchObject({
      outcome: null,
      failure: "error: UNEXPECTED",
    });
  });
});

describe("repeated runs", () => {
  const submit = () =>
    createScriptedProvider([callTool("submit_recommendation", request)]);

  it("derives the fence nonce from the case, so the same run sends the same request", async () => {
    const [first, second] = [submit(), submit()];
    await recordCase(organizerCase, first, CLOCK, network);
    await recordCase(organizerCase, second, CLOCK, network);
    expect(first.requests[0]?.messages).toEqual(second.requests[0]?.messages);
  });

  it("gives each run its own nonce, and keeps run 1's as it was", async () => {
    const [unnumbered, one, two] = [submit(), submit(), submit()];
    await recordCase(organizerCase, unnumbered, CLOCK, network);
    await recordCase(organizerCase, one, CLOCK, { ...network, run: 1 });
    const second = await recordCase(organizerCase, two, CLOCK, {
      ...network,
      run: 2,
    });

    // Run 1 is the recording every set already has: its request can't move.
    expect(one.requests[0]?.messages).toEqual(unnumbered.requests[0]?.messages);
    expect(two.requests[0]?.messages).not.toEqual(one.requests[0]?.messages);
    expect(second.recording?.run).toBe(2);
    expect(
      await replayCase(organizerCase, second.recording, second.toolRecording),
    ).toEqual(second.result);
  });

  it("replays every run of a set, and a case missing from a run as stale", async () => {
    const recordRun = async (evalCase: EvalCase, run: number) => {
      const steps =
        evalCase === eventCase
          ? [callTool("submit_recommendation", approval)]
          : [callTool("submit_recommendation", request)];
      return recordCase(evalCase, createScriptedProvider(steps), CLOCK, {
        ...network,
        run,
      });
    };
    const event1 = await recordRun(eventCase, 1);
    const event2 = await recordRun(eventCase, 2);
    const organizer1 = await recordRun(organizerCase, 1);
    const recorded = (r: Awaited<ReturnType<typeof recordRun>>) => {
      if (r.recording === null) throw new Error("the scripted run failed");
      return r.recording;
    };

    const set = await replaySet(
      [eventCase, organizerCase],
      {
        provider: "scripted",
        model: "scripted-model",
        runs: [
          new Map([
            ["N1", recorded(event1)],
            ["22", recorded(organizer1)],
          ]),
          new Map([["N1", recorded(event2)]]),
        ],
      },
      new Map([
        ["N1", event1.toolRecording ?? { caseId: "N1", calls: [] }],
        ["22", organizer1.toolRecording ?? { caseId: "22", calls: [] }],
      ]),
    );

    expect(set.runs).toEqual([
      [event1.result, organizer1.result],
      [
        event2.result,
        expect.objectContaining({
          caseId: "22",
          failure: "stale: missing_recording",
        }),
      ],
    ]);
  });
});

// Keeps the shape the CLI writes honest: a recording is plain JSON.
it("produces recordings that survive a JSON round trip", async () => {
  const { event } = await recordBoth();
  const parsed = JSON.parse(JSON.stringify(event.recording)) as Recording;
  const tools = toolRecordingSchema.parse(
    JSON.parse(JSON.stringify(event.toolRecording)),
  );
  expect(await replayCase(eventCase, parsed, tools)).toEqual(event.result);
});
