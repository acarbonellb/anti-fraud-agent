// Checks the history end to end (#21): replaying the same recordings with a
// different auto-approve threshold moves the metrics, and the check fails
// until an entry with a note is appended. Fakes the model with the scripted
// provider and the venue providers' network with a canned verified venue;
// the agent, the policy and the history functions are real.
import { expect, it } from "vitest";

import {
  callTool,
  createScriptedProvider,
} from "../providers/scripted-provider.js";
import { fixtures } from "../satella-client/fixtures.js";
import {
  historyFailures,
  measureSet,
  planHistory,
  type HistoryEntry,
} from "./history.js";
import { createAuthoredSearch } from "../search/authored.js";
import { fakeVenueFetch } from "../venue/fake-venue-fetch.js";
import { recordCase, replaySet } from "./runner.js";
import type { RecordingSet } from "./store.js";
import type { EvalCase } from "./types.js";

const CLOCK = new Date("2026-11-02T10:00:00.000Z");

const clean: EvalCase = {
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

it("fails the check on moved metrics until an entry with a note is appended", async () => {
  const { recording, toolRecording } = await recordCase(
    clean,
    createScriptedProvider([
      callTool("submit_recommendation", {
        decision: "approve",
        confidence: 0.9,
        rationale: "Sin señales de fraude.",
        findings: [],
      }),
    ]),
    CLOCK,
    {
      fetch: fakeVenueFetch({
        latitude: 41.6523,
        longitude: -4.7245,
        capacity: 500,
      }),
      search: createAuthoredSearch([]),
    },
  );
  if (recording === null || toolRecording === null) {
    throw new Error("the scripted run failed");
  }
  const tools = new Map([[clean.id, toolRecording]]);
  const set: RecordingSet = {
    provider: recording.provider,
    model: recording.model,
    recordings: new Map([[clean.id, recording]]),
  };

  const before = measureSet(await replaySet([clean], set, tools));
  const first = planHistory({
    history: [],
    current: [before],
    note: "Baseline.",
    date: "2026-11-02",
  });
  if (!("append" in first)) throw new Error("expected an entry");
  const history: HistoryEntry[] = first.append;
  expect(history).toMatchObject([
    { id: "E001", gated: { autonomyAccuracy: 1 } },
  ]);
  expect(
    historyFailures({ history, current: [before], experimentIds: ["E001"] }),
  ).toEqual([]);

  // Same recordings; a stricter threshold escalates the 0.9 approval.
  const after = measureSet(
    await replaySet([clean], set, tools, { autoApproveThreshold: 0.95 }),
  );
  expect(
    historyFailures({ history, current: [after], experimentIds: ["E001"] }),
  ).toEqual([expect.stringContaining("differs from its latest entry, E001")]);
  expect(
    planHistory({ history, current: [after], date: "2026-11-03" }),
  ).toEqual({ noteMissing: ["scripted/scripted-model"] });

  const second = planHistory({
    history,
    current: [after],
    note: "Threshold 0.95.",
    date: "2026-11-03",
  });
  if (!("append" in second)) throw new Error("expected an entry");
  history.push(...second.append);
  expect(history[1]).toMatchObject({
    id: "E002",
    note: "Threshold 0.95.",
    gated: { autonomyAccuracy: 0, escalationRate: 1 },
  });
  expect(
    historyFailures({
      history,
      current: [after],
      experimentIds: ["E001", "E002"],
    }),
  ).toEqual([]);
});
