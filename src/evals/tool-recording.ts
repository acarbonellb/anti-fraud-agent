/**
 * Recordings of the external tools' HTTP responses, taken at the provider
 * boundary (`fetch`), so replay runs the code that reads and scores each
 * response without the network (ADR 0013 extended by ADR 0015 point 9).
 *
 * Each response is keyed by the SHA-256 of its canonical request (method,
 * URL, body), not by order: the venue checks run in parallel. A request with
 * no recorded response is stale, whether the request changed or the response
 * was never recorded: either way the old answer doesn't apply.
 *
 * The responses are model-independent, so one file per case serves every
 * recording set. Open data (OSM, Wikidata) is committed as recorded, with its
 * attribution.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import type { Fetch } from "../fetch.js";
import { StaleRecordingError } from "./stale.js";

export const ATTRIBUTIONS: Readonly<Record<string, string>> = {
  "nominatim.openstreetmap.org":
    "Data © OpenStreetMap contributors, ODbL 1.0, https://osm.org/copyright",
  "query.wikidata.org": "Wikidata, CC0 1.0",
};

const toolCallSchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** For people reading the file; the hash is what replay matches. */
  method: z.string(),
  url: z.string(),
  body: z.string().optional(),
  /** `authored` responses are written by hand, and the report says so. */
  origin: z.enum(["recorded", "authored"]),
  attribution: z.string().min(1),
  response: z.union([
    z.object({
      status: z.number().int(),
      /** Parsed when the body is JSON, to keep the file readable. */
      json: z.unknown().optional(),
      text: z.string().optional(),
    }),
    // A request that never got a response replays as the same failure.
    z.object({ error: z.enum(["timeout", "network"]) }),
  ]),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolRecordingSchema = z.object({
  caseId: z.string().min(1),
  calls: z.array(toolCallSchema),
});
export type ToolRecording = z.infer<typeof toolRecordingSchema>;

export interface ToolRequest {
  method: string;
  url: string;
  body?: string;
}

/** Headers stay out: the User-Agent and timeouts don't change the answer. */
export function hashToolRequest(request: ToolRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([request.method, request.url, request.body ?? null]))
    .digest("hex");
}

function requestOf(url: string, init: RequestInit): ToolRequest {
  const body = typeof init.body === "string" ? init.body : undefined;
  return {
    method: init.method ?? "GET",
    url,
    ...(body === undefined ? {} : { body }),
  };
}

export interface RecordingFetch {
  fetch: Fetch;
  /** One per distinct request, in the order they were first made. */
  calls(): ToolCall[];
}

/** Wraps a real `fetch` and keeps each response with its request hash. */
export function createRecordingFetch(inner: Fetch): RecordingFetch {
  const calls = new Map<string, ToolCall>();
  const fetch: Fetch = async (url, init) => {
    const request = requestOf(url, init);
    const requestHash = hashToolRequest(request);
    const base = {
      requestHash,
      ...request,
      origin: "recorded" as const,
      attribution: ATTRIBUTIONS[new URL(url).hostname] ?? new URL(url).hostname,
    };
    let response: Response;
    try {
      response = await inner(url, init);
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      calls.set(requestHash, {
        ...base,
        response: { error: timedOut ? "timeout" : "network" },
      });
      throw error;
    }
    const text = await response.text();
    calls.set(requestHash, {
      ...base,
      response: { status: response.status, ...bodyOf(text) },
    });
    return new Response(text, { status: response.status });
  };
  return { fetch, calls: () => [...calls.values()] };
}

function bodyOf(text: string): { json: unknown } | { text: string } {
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    return { text };
  }
}

/** Serves the recorded responses by request hash; never touches the network. */
export function createReplayFetch(recording: ToolRecording | null): Fetch {
  const byHash = new Map(
    (recording?.calls ?? []).map((call) => [call.requestHash, call]),
  );
  return (url, init) => {
    const call = byHash.get(hashToolRequest(requestOf(url, init)));
    if (call === undefined) {
      return Promise.reject(new StaleRecordingError("missing_tool_response"));
    }
    const { response } = call;
    if ("error" in response) {
      const error = new Error(`recorded ${response.error}`);
      error.name = response.error === "timeout" ? "TimeoutError" : "TypeError";
      return Promise.reject(error);
    }
    const body =
      response.text ??
      (response.json === undefined ? "" : JSON.stringify(response.json));
    return Promise.resolve(new Response(body, { status: response.status }));
  };
}

/**
 * A repeat run's responses added to the case's file (#42): only requests the
 * file doesn't hold yet. The runs already recorded replay against the
 * responses they saw; a repeat that saw another one (a provider timed out,
 * OSM changed) is the one that goes stale, and is re-recorded.
 */
export function addNewToolCalls(
  existing: ToolRecording | null,
  recorded: ToolRecording,
): ToolRecording {
  if (existing === null) return recorded;
  const known = new Set(existing.calls.map((call) => call.requestHash));
  return {
    caseId: existing.caseId,
    calls: [
      ...existing.calls,
      ...recorded.calls.filter((call) => !known.has(call.requestHash)),
    ],
  };
}
