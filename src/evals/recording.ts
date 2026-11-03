/**
 * Recordings of model responses, so the evals replay in CI without a model,
 * network or cost (issue #6). Each call is stored with the hash of the
 * request that produced it: if the code now sends a different request (a
 * prompt, a tool or the context changed), the recorded answer no longer
 * applies and the case is stale until it is recorded again.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { DomainError } from "../errors.js";
import type {
  CompletionRequest,
  CompletionResponse,
  LlmProvider,
} from "../providers/types.js";

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  argumentsJson: z.string(),
});

const completionResponseSchema = z.object({
  message: z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    toolCalls: z.array(toolCallSchema),
  }),
  stopReason: z.enum(["tool_calls", "end", "max_tokens", "other"]),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

const recordedCallSchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  latencyMs: z.number().nonnegative(),
  response: completionResponseSchema,
});
export type RecordedCall = z.infer<typeof recordedCallSchema>;

export const recordingSchema = z.object({
  caseId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  /** The clock the case's fixtures were built from; replay reuses it. */
  clock: z.iso.datetime(),
  calls: z.array(recordedCallSchema),
});
export type Recording = z.infer<typeof recordingSchema>;

export type StaleReason =
  | "missing_recording"
  | "prompt_version"
  | "request_changed"
  | "missing_step"
  // A tool request with no recorded response: changed, or never recorded.
  | "missing_tool_response";

/** The recording no longer matches what the code sends: re-run `pnpm eval`. */
export class StaleRecordingError extends DomainError {
  readonly code = "EVAL_STALE";

  constructor(
    readonly reason: StaleReason,
    readonly step: number | null = null,
  ) {
    super(
      `Stale recording: ${reason}` +
        (step === null ? "" : ` at call ${String(step + 1)}`),
    );
  }
}

/** SHA-256 of the request's canonical JSON: keys sorted, so order never matters. */
export function hashRequest(request: CompletionRequest): string {
  const { messages, tools, maxOutputTokens } = request;
  return createHash("sha256")
    .update(canonicalJson({ messages, tools, maxOutputTokens }))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

export interface RecordingProvider extends LlmProvider {
  readonly calls: RecordedCall[];
}

/** Wraps a real provider and keeps every response with its request hash. */
export function createRecordingProvider(
  inner: LlmProvider,
  clock: () => number = () => performance.now(),
): RecordingProvider {
  const calls: RecordedCall[] = [];
  return {
    provider: inner.provider,
    model: inner.model,
    calls,
    async complete(request) {
      // Hashed before the call: the loop keeps appending to the same array.
      const requestHash = hashRequest(request);
      const started = clock();
      const response = await inner.complete(request);
      calls.push({
        requestHash,
        latencyMs: Math.round(clock() - started),
        response,
      });
      return response;
    },
  };
}

/** Returns the recorded responses in order while each request matches. */
export function createReplayProvider(recording: Recording): LlmProvider {
  let next = 0;
  return {
    provider: recording.provider,
    model: recording.model,
    complete(request): Promise<CompletionResponse> {
      const step = next;
      next += 1;
      const call = recording.calls[step];
      if (call === undefined) {
        return Promise.reject(new StaleRecordingError("missing_step", step));
      }
      if (call.requestHash !== hashRequest(request)) {
        return Promise.reject(new StaleRecordingError("request_changed", step));
      }
      return Promise.resolve(call.response);
    },
  };
}
