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
} from "../providers/scripted-provider.js";
import { fixtures } from "../satella-client/fixtures.js";
import { fakeVenueFetch } from "../venue/fake-venue-fetch.js";
import type { Recording } from "./recording.js";
import { recordCase, replayCase } from "./runner.js";
import { toolRecordingSchema } from "./tool-recording.js";
import type { EvalCase } from "./types.js";

const CLOCK = new Date("2026-11-02T10:00:00.000Z");
const network = {
  fetch: fakeVenueFetch({
    latitude: 41.6523,
    longitude: -4.7245,
    capacity: 500,
  }),
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

it("derives the fence nonce from the case, so runs send the same request", async () => {
  const first = createScriptedProvider([
    callTool("submit_recommendation", request),
  ]);
  const second = createScriptedProvider([
    callTool("submit_recommendation", request),
  ]);
  await recordCase(organizerCase, first, CLOCK, network);
  await recordCase(organizerCase, second, CLOCK, network);
  expect(first.requests[0]?.messages).toEqual(second.requests[0]?.messages);
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
