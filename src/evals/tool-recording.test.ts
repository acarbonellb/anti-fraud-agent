// Checks the recording and replay of the external tools' HTTP responses: a
// recording keeps each response with the hash of its request, its origin and
// its attribution; replay serves them by hash, in any order, and a request
// with no recorded response throws a typed stale error; a repeat run adds only
// new requests to the case's file; a Nominatim response is recorded with only
// the fields the venue checks read (#85). Fakes `fetch`.
import { describe, expect, it } from "vitest";

import type { Fetch } from "../fetch.js";
import { StaleRecordingError } from "./recording.js";
import {
  createRecordingFetch,
  addNewToolCalls,
  createReplayFetch,
  hashToolRequest,
  reduceToolRecording,
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

  it("keeps only the fields the scorer reads from a venue search (#85)", async () => {
    const raw = {
      place_id: 1,
      licence: "Data © OpenStreetMap contributors",
      osm_type: "way",
      osm_id: 42,
      lat: "43.01",
      lon: "-7.55",
      category: "amenity",
      type: "theatre",
      place_rank: 30,
      importance: 0.2,
      addresstype: "amenity",
      name: "Sala",
      display_name: "Sala, Lugo, España",
      boundingbox: ["43.0", "43.1", "-7.6", "-7.5"],
      extratags: {
        wikidata: "Q1",
        capacity: "400",
        email: "info@sala.example",
        phone: "+34 600 000 000",
        opening_hours: "Mo-Su 20:00-03:00",
      },
    };
    const recorder = createRecordingFetch(() =>
      Promise.resolve(new Response(JSON.stringify([raw]), { status: 200 })),
    );
    const response = await recorder.fetch(SEARCH, { method: "GET" });

    expect(recorder.calls()[0]?.response).toEqual({
      status: 200,
      json: [
        {
          osm_type: "way",
          osm_id: 42,
          lat: "43.01",
          lon: "-7.55",
          category: "amenity",
          type: "theatre",
          name: "Sala",
          display_name: "Sala, Lugo, España",
          extratags: { wikidata: "Q1", capacity: "400" },
        },
      ],
    });
    // The live run reads the response as the provider sent it.
    expect(await response.json()).toEqual([raw]);
  });

  it("records a venue without those fields without them (#85)", async () => {
    const bare = {
      osm_type: "node",
      osm_id: 8,
      lat: "1",
      lon: "2",
      category: "shop",
      type: "kiosk",
      extratags: null,
    };
    const recorder = createRecordingFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              osm_type: "node",
              osm_id: 7,
              lat: "43.01",
              lon: "-7.55",
              category: "amenity",
              type: "bar",
              importance: 0.1,
              extratags: { website: "https://bar.example" },
            },
            bare,
          ]),
          { status: 200 },
        ),
      ),
    );
    await recorder.fetch(SEARCH, { method: "GET" });

    expect(recorder.calls()[0]?.response).toEqual({
      status: 200,
      json: [
        {
          osm_type: "node",
          osm_id: 7,
          lat: "43.01",
          lon: "-7.55",
          category: "amenity",
          type: "bar",
          extratags: {},
        },
        bare,
      ],
    });
  });

  it("keeps a reverse lookup's address, which the locality is read from (#85)", async () => {
    const reverse =
      "https://nominatim.openstreetmap.org/reverse?lat=43&lon=-7&format=jsonv2";
    const recorder = createRecordingFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            place_id: 3,
            licence: "x",
            osm_type: "way",
            osm_id: 9,
            lat: "43",
            lon: "-7",
            category: "building",
            type: "residential",
            importance: 0,
            address: { city: "Lugo", country: "España" },
            boundingbox: ["1", "2", "3", "4"],
          }),
          { status: 200 },
        ),
      ),
    );
    await recorder.fetch(reverse, { method: "GET" });

    expect(recorder.calls()[0]?.response).toEqual({
      status: 200,
      json: {
        osm_type: "way",
        osm_id: 9,
        lat: "43",
        lon: "-7",
        category: "building",
        type: "residential",
        address: { city: "Lugo", country: "España" },
      },
    });
  });

  it("reduces a committed recording the way recording does, keeping its keys (#85)", () => {
    const call = {
      requestHash: hashToolRequest({ method: "GET", url: SEARCH }),
      method: "GET",
      url: SEARCH,
      origin: "recorded" as const,
      attribution: "OSM",
      response: {
        status: 200,
        json: [{ osm_id: 1, place_rank: 30, extratags: { email: "a@b.c" } }],
      },
    };
    const other = {
      ...call,
      url: WIKIDATA,
      response: { status: 504, text: "busy" },
    };
    const reduced = reduceToolRecording({ caseId: "N1", calls: [call, other] });

    expect(reduced).toEqual({
      caseId: "N1",
      calls: [
        {
          ...call,
          response: { status: 200, json: [{ osm_id: 1, extratags: {} }] },
        },
        other,
      ],
    });
    expect(reduceToolRecording(reduced)).toEqual(reduced);
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
