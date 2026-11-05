// Checks the recording and replay of the external tools' HTTP responses: a
// recording keeps each response with the hash of its request, its origin and
// its attribution; replay serves them by hash, in any order, and a request
// with no recorded response throws a typed stale error; a repeat run adds only
// new requests to the case's file. Fakes `fetch`.
import { describe, expect, it } from "vitest";

import type { Fetch } from "../fetch.js";
import { StaleRecordingError } from "./recording.js";
import {
  createRecordingFetch,
  addNewToolCalls,
  createReplayFetch,
  hashToolRequest,
  type ToolRecording,
} from "./tool-recording.js";

const SEARCH = "https://nominatim.openstreetmap.org/search?q=Sala%2C+Lugo";
const WIKIDATA = "https://query.wikidata.org/sparql?query=x";

const upstream: Fetch = (url) =>
  Promise.resolve(
    url === SEARCH
      ? new Response(JSON.stringify([{ name: "Sala" }]), { status: 200 })
      : new Response("busy", { status: 504 }),
  );

describe("tool recordings", () => {
  it("hashes method, URL and body, so a changed request no longer matches", () => {
    const base = { method: "POST", url: WIKIDATA, body: "data=a" };
    expect(hashToolRequest(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToolRequest(base)).toBe(hashToolRequest({ ...base }));
    expect(hashToolRequest({ ...base, body: "data=b" })).not.toBe(
      hashToolRequest(base),
    );
  });

  it("records each response with its origin and attribution", async () => {
    const recorder = createRecordingFetch(upstream);
    const response = await recorder.fetch(SEARCH, { method: "GET" });
    expect(await response.json()).toEqual([{ name: "Sala" }]);
    await recorder.fetch(WIKIDATA, { method: "POST", body: "data=x" });

    const [search, wikidata] = recorder.calls();
    expect(search).toMatchObject({
      method: "GET",
      url: SEARCH,
      origin: "recorded",
      attribution: expect.stringContaining("OpenStreetMap") as string,
      response: { status: 200, json: [{ name: "Sala" }] },
    });
    expect(wikidata?.response).toEqual({ status: 504, text: "busy" });
  });

  it("replays by request hash, in any order", async () => {
    const recorder = createRecordingFetch(upstream);
    await recorder.fetch(SEARCH, { method: "GET" });
    await recorder.fetch(WIKIDATA, { method: "POST", body: "data=x" });
    const replay = createReplayFetch({ caseId: "N1", calls: recorder.calls() });

    const wikidata = await replay(WIKIDATA, { method: "POST", body: "data=x" });
    expect(wikidata.status).toBe(504);
    const search = await replay(SEARCH, { method: "GET" });
    expect(await search.json()).toEqual([{ name: "Sala" }]);
  });

  it("is stale for a request it has no response for", async () => {
    const recording: ToolRecording = { caseId: "N1", calls: [] };
    const error = await createReplayFetch(recording)(SEARCH, {
      method: "GET",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StaleRecordingError);
    expect((error as StaleRecordingError).reason).toBe("missing_tool_response");
  });

  it("is stale for every request when the case has no recording", async () => {
    await expect(
      createReplayFetch(null)(SEARCH, { method: "GET" }),
    ).rejects.toBeInstanceOf(StaleRecordingError);
  });

  it("replays a recorded timeout as a timeout", async () => {
    const timingOut: Fetch = () =>
      Promise.reject(new DOMException("timed out", "TimeoutError"));
    const recorder = createRecordingFetch(timingOut);
    await expect(recorder.fetch(SEARCH, { method: "GET" })).rejects.toThrow();
    const replay = createReplayFetch({ caseId: "N1", calls: recorder.calls() });
    await expect(replay(SEARCH, { method: "GET" })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("keeps every response a case already has when a repeat run adds its own (#42)", async () => {
    const first = createRecordingFetch(upstream);
    await first.fetch(SEARCH, { method: "GET" });
    const existing = { caseId: "N4", calls: first.calls() };

    // The repeat saw a timeout for the same search, and made one new request.
    const repeat = createRecordingFetch((url) =>
      url === SEARCH
        ? Promise.reject(
            Object.assign(new Error("t"), { name: "TimeoutError" }),
          )
        : upstream(url, { method: "POST" }),
    );
    await repeat.fetch(SEARCH, { method: "GET" }).catch(() => undefined);
    await repeat.fetch(WIKIDATA, { method: "POST", body: "data=x" });

    const merged = addNewToolCalls(existing, {
      caseId: "N4",
      calls: repeat.calls(),
    });
    expect(merged.calls.map((call) => call.url)).toEqual([SEARCH, WIKIDATA]);
    expect(merged.calls[0]).toEqual(existing.calls[0]);
    expect(addNewToolCalls(null, existing)).toEqual(existing);
  });
});
