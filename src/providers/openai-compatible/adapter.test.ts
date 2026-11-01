// Checks the OpenAI-compatible adapter: how it translates neutral messages and
// tools to the wire format, and how it reads responses recorded from a local
// LM Studio server (qwen/qwen3.5-9b, 2026-11-01). Fakes the network with a
// `fetch` stub that captures the request and replays the recording.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ProviderError } from "../types.js";
import { createOpenAiCompatibleProvider } from "./adapter.js";

function recording(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./recordings/${name}`, import.meta.url), "utf8"),
  );
}

function stubFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: input as string, init: init ?? {} });
    return Promise.resolve(response);
  };
  return { fetch, calls };
}

function providerWith(fetch: typeof globalThis.fetch, apiKey?: string) {
  return createOpenAiCompatibleProvider({
    provider: "lmstudio",
    baseUrl: "http://localhost:1234/v1/",
    model: "qwen/qwen3.5-9b",
    ...(apiKey === undefined ? {} : { apiKey }),
    fetch,
  });
}

const postalCodeTool = {
  name: "checkPostalCodeProvince",
  description: "Checks a Spanish postal code against a province.",
  inputSchema: {
    type: "object",
    properties: {
      postalCode: { type: "string" },
      province: { type: "string" },
    },
    required: ["postalCode", "province"],
  },
};

describe("OpenAI-compatible adapter", () => {
  it("reads a recorded tool call", async () => {
    const { fetch } = stubFetch(
      Response.json(recording("lmstudio-tool-call.json")),
    );

    const response = await providerWith(fetch).complete({
      messages: [{ role: "user", content: "CP 28013, Sevilla" }],
      tools: [postalCodeTool],
      maxOutputTokens: 1024,
    });

    expect(response.stopReason).toBe("tool_calls");
    expect(response.message).toEqual({
      role: "assistant",
      content: null,
      toolCalls: [
        {
          id: "MA61aLdwE8igELeJWuOaCzgq6r3GSlcv",
          name: "checkPostalCodeProvince",
          argumentsJson: '{"postalCode":"28013","province":"Sevilla"}',
        },
      ],
    });
    expect(response.usage).toEqual({ inputTokens: 345, outputTokens: 47 });
  });

  it("reads a recorded final answer", async () => {
    const { fetch } = stubFetch(
      Response.json(recording("lmstudio-final-answer.json")),
    );

    const response = await providerWith(fetch).complete({
      messages: [{ role: "user", content: "CP 28013, Sevilla" }],
      tools: [],
      maxOutputTokens: 1024,
    });

    expect(response.stopReason).toBe("end");
    expect(response.message.toolCalls).toEqual([]);
    expect(response.message.content).toContain("Madrid");
  });

  it("translates the conversation, tools and limits to the wire format", async () => {
    const { fetch, calls } = stubFetch(
      Response.json(recording("lmstudio-final-answer.json")),
    );

    await providerWith(fetch).complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "c1", name: "t", argumentsJson: "{}" }],
        },
        { role: "tool", toolCallId: "c1", content: '{"ok":true}' },
      ],
      tools: [postalCodeTool],
      maxOutputTokens: 512,
    });

    expect(calls[0]?.url).toBe("http://localhost:1234/v1/chat/completions");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      model: "qwen/qwen3.5-9b",
      temperature: 0,
      max_tokens: 512,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "t", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: postalCodeTool.name,
            description: postalCodeTool.description,
            parameters: postalCodeTool.inputSchema,
          },
        },
      ],
    });
  });

  it("sends the API key only when there is one", async () => {
    const withKey = stubFetch(
      Response.json(recording("lmstudio-final-answer.json")),
    );
    const withoutKey = stubFetch(
      Response.json(recording("lmstudio-final-answer.json")),
    );
    const request = { messages: [], tools: [], maxOutputTokens: 16 };

    await providerWith(withKey.fetch, "demo-key").complete(request);
    await providerWith(withoutKey.fetch).complete(request);

    expect(withKey.calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer demo-key",
    });
    expect(withoutKey.calls[0]?.init.headers).not.toHaveProperty(
      "authorization",
    );
  });

  it.each([
    [
      "an HTTP error",
      () => Promise.resolve(new Response("nope", { status: 500 })),
      "LLM_HTTP_ERROR",
    ],
    [
      "a body outside the format",
      () => Promise.resolve(Response.json({ choices: [] })),
      "LLM_BAD_RESPONSE",
    ],
    [
      "a network failure",
      () => Promise.reject(new TypeError("fetch failed")),
      "LLM_UNAVAILABLE",
    ],
  ] as const)("maps %s to a typed error", async (_, fetch, code) => {
    const error = await providerWith(fetch)
      .complete({ messages: [], tools: [], maxOutputTokens: 16 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe(code);
  });
});
