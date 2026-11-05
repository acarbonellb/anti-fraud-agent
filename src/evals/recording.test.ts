// Checks the recording and replay providers: a recording keeps every model
// response with the hash of the request that produced it, and replay returns
// them in order while the requests match, and throws a typed stale error the
// moment one doesn't. Fakes the model with the scripted provider.
import { describe, expect, it } from "vitest";

import {
  callTool,
  createScriptedProvider,
  sayText,
} from "../test-support/scripted-provider.js";
import type { CompletionRequest } from "../providers/types.js";
import {
  createRecordingProvider,
  createReplayProvider,
  hashRequest,
  type Recording,
  StaleRecordingError,
} from "./recording.js";

const request = (text: string): CompletionRequest => ({
  messages: [{ role: "user", content: text }],
  tools: [],
  maxOutputTokens: 100,
});

function recordingOf(...steps: [CompletionRequest, string][]): Recording {
  return {
    caseId: "03",
    provider: "scripted",
    model: "scripted-model",
    promptVersion: "review-v2",
    clock: "2026-11-02T10:00:00.000Z",
    searches: [],
    calls: steps.map(([req, text]) => ({
      requestHash: hashRequest(req),
      latencyMs: 10,
      response: sayText(text),
    })),
  };
}

describe("hashRequest", () => {
  it("ignores key order but not content", () => {
    const a = hashRequest(request("hola"));
    const reordered = hashRequest({
      maxOutputTokens: 100,
      tools: [],
      messages: [{ content: "hola", role: "user" }],
    });
    expect(reordered).toBe(a);
    expect(hashRequest(request("adiós"))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("replay provider", () => {
  it("returns the recorded responses in order", async () => {
    const replay = createReplayProvider(
      recordingOf([request("uno"), "1"], [request("dos"), "2"]),
    );
    expect(replay.provider).toBe("scripted");
    expect(replay.model).toBe("scripted-model");
    expect((await replay.complete(request("uno"))).message.content).toBe("1");
    expect((await replay.complete(request("dos"))).message.content).toBe("2");
  });

  it("is stale when a request differs from the recorded one", async () => {
    const replay = createReplayProvider(recordingOf([request("uno"), "1"]));
    const error = await replay
      .complete(request("otro"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StaleRecordingError);
    expect(error).toMatchObject({
      code: "EVAL_STALE",
      reason: "request_changed",
    });
  });

  it("is stale when the run asks for more calls than were recorded", async () => {
    const replay = createReplayProvider(recordingOf([request("uno"), "1"]));
    await replay.complete(request("uno"));
    await expect(replay.complete(request("dos"))).rejects.toMatchObject({
      reason: "missing_step",
    });
  });
});

describe("recording provider", () => {
  it("records each response with its request hash, and replays it", async () => {
    const first = callTool("lookup", { q: 1 });
    const second = sayText("fin");
    const recorder = createRecordingProvider(
      createScriptedProvider([first, second]),
    );
    expect(recorder.provider).toBe("scripted");
    await recorder.complete(request("uno"));
    await recorder.complete(request("dos"));

    expect(recorder.calls.map((call) => call.requestHash)).toEqual([
      hashRequest(request("uno")),
      hashRequest(request("dos")),
    ]);
    const replay = createReplayProvider({
      ...recordingOf(),
      calls: recorder.calls,
    });
    expect(await replay.complete(request("uno"))).toEqual(first);
    expect(await replay.complete(request("dos"))).toEqual(second);
  });
});
