// Checks the Anthropic adapter: how it translates neutral messages and tools
// to a Messages API request for Claude Haiku 5.5, and how it reads responses.
// Fakes the network with a `fetch` stub that captures the request. The
// responses in ./responses/ were written from the documented Messages API
// shape before any paid call; the first real pass (E013) confirmed it.
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../types.js";
import { ProviderError } from "../types.js";
import { createAnthropicProvider } from "./adapter.js";

function response(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./responses/${name}`, import.meta.url), "utf8"),
  );
}

function stubFetch(reply: () => Response | Promise<Response>) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    urls.push(input instanceof Request ? input.url : String(input));
    // The SDK sends its JSON body as a string.
    bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
    return reply();
  };
  return { fetch, bodies, urls };
}

function providerWith(fetch: typeof globalThis.fetch) {
  return createAnthropicProvider({
    apiKey: "test-key",
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-5-5",
    effort: "medium",
    thinkingHeadroomTokens: 8000,
    maxRetries: 0,
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

describe("Anthropic adapter", () => {
  it("reads a tool call after a thinking block, and keeps the blocks to send back", async () => {
    const { fetch } = stubFetch(() =>
      Response.json(response("tool-call.json")),
    );

    const result = await providerWith(fetch).complete({
      messages: [{ role: "user", content: "CP 28013, Sevilla" }],
      tools: [postalCodeTool],
      maxOutputTokens: 1024,
    });

    expect(result.stopReason).toBe("tool_calls");
    expect(result.message.content).toBeNull();
    expect(result.message.toolCalls).toEqual([
      {
        id: "toolu_01FakePostalCode000000",
        name: "checkPostalCodeProvince",
        argumentsJson: '{"postalCode":"28013","province":"Sevilla"}',
      },
    ]);
    expect(result.message.providerContent).toEqual(
      (response("tool-call.json") as { content: unknown[] }).content,
    );
    // Input counts every token processed: uncached, written and read.
    expect(result.usage).toEqual({
      inputTokens: 4020,
      outputTokens: 210,
      cacheReadInputTokens: 3000,
      cacheWriteInputTokens: 900,
    });
  });

  it("sends a Haiku 5.5 request: system apart, adaptive thinking, explicit effort, caching and no temperature", async () => {
    const { fetch, bodies } = stubFetch(() =>
      Response.json(response("final-answer.json")),
    );

    await providerWith(fetch).complete({
      messages: [
        { role: "system", content: "You review events." },
        { role: "user", content: "CP 28013, Sevilla" },
      ],
      tools: [postalCodeTool],
      maxOutputTokens: 1024,
    });

    const [body] = bodies;
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 9024,
      system: "You review events.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "CP 28013, Sevilla" }],
        },
      ],
      tools: [
        {
          name: postalCodeTool.name,
          description: postalCodeTool.description,
          input_schema: postalCodeTool.inputSchema,
        },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("sends a turn's own blocks back unchanged, with its tool results in one user message", async () => {
    const first = stubFetch(() => Response.json(response("tool-call.json")));
    const turn = await providerWith(first.fetch).complete({
      messages: [{ role: "user", content: "CP 28013, Sevilla" }],
      tools: [postalCodeTool],
      maxOutputTokens: 1024,
    });
    const messages: ChatMessage[] = [
      { role: "user", content: "CP 28013, Sevilla" },
      turn.message,
      {
        role: "tool",
        toolCallId: "toolu_01FakePostalCode000000",
        content: '{"province":"Madrid"}',
      },
      { role: "tool", toolCallId: "toolu_other", content: "ok" },
    ];

    const second = stubFetch(() =>
      Response.json(response("final-answer.json")),
    );
    await providerWith(second.fetch).complete({
      messages,
      tools: [postalCodeTool],
      maxOutputTokens: 1024,
    });

    expect(second.bodies[0]?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "CP 28013, Sevilla" }] },
      {
        role: "assistant",
        content: (response("tool-call.json") as { content: unknown[] }).content,
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01FakePostalCode000000",
            content: '{"province":"Madrid"}',
          },
          { type: "tool_result", tool_use_id: "toolu_other", content: "ok" },
        ],
      },
    ]);
  });

  it("rebuilds a turn another provider produced from the neutral shape", async () => {
    const { fetch, bodies } = stubFetch(() =>
      Response.json(response("final-answer.json")),
    );

    await providerWith(fetch).complete({
      messages: [
        { role: "user", content: "CP 28013, Sevilla" },
        {
          role: "assistant",
          content: "Lo compruebo.",
          toolCalls: [
            {
              id: "call_1",
              name: "checkPostalCodeProvince",
              argumentsJson: '{"postalCode":"28013","province":"Sevilla"}',
            },
          ],
        },
        { role: "tool", toolCallId: "call_1", content: "Madrid" },
      ],
      tools: [postalCodeTool],
      maxOutputTokens: 1024,
    });

    expect(bodies[0]?.messages).toContainEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Lo compruebo." },
        {
          type: "tool_use",
          id: "call_1",
          name: "checkPostalCodeProvince",
          input: { postalCode: "28013", province: "Sevilla" },
        },
      ],
    });
  });

  it("reads a final answer as text, skipping the thinking block", async () => {
    const { fetch } = stubFetch(() =>
      Response.json(response("final-answer.json")),
    );

    const result = await providerWith(fetch).complete({
      messages: [{ role: "user", content: "CP 28013, Sevilla" }],
      tools: [],
      maxOutputTokens: 1024,
    });

    expect(result.stopReason).toBe("end");
    expect(result.message.content).toBe(
      "El código postal 28013 es de Madrid, no de Sevilla.",
    );
    expect(result.message.toolCalls).toEqual([]);
  });

  it("reports a refusal as its own stop reason", async () => {
    const { fetch } = stubFetch(() => Response.json(response("refusal.json")));

    const result = await providerWith(fetch).complete({
      messages: [{ role: "user", content: "…" }],
      tools: [],
      maxOutputTokens: 1024,
    });

    expect(result.stopReason).toBe("refusal");
    expect(result.message).toMatchObject({ content: null, toolCalls: [] });
  });

  it("maps an HTTP error to a provider error with its status, not its body", async () => {
    const { fetch } = stubFetch(() =>
      Response.json(
        {
          type: "error",
          error: { type: "invalid_request_error", message: "secret detail" },
        },
        { status: 400 },
      ),
    );

    const error = await providerWith(fetch)
      .complete({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        maxOutputTokens: 16,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "LLM_HTTP_ERROR", status: 400 });
    expect((error as Error).message).not.toContain("secret detail");
  });

  it("maps a network failure to an unavailable provider", async () => {
    const { fetch } = stubFetch(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    await expect(
      providerWith(fetch).complete({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        maxOutputTokens: 16,
      }),
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", provider: "anthropic" });
  });
  it("calls the configured base URL with logging off, whatever the SDK's own variables say", async () => {
    // The SDK reads these on its own: one could redirect the key, the other
    // log whole review contexts (#89).
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://elsewhere.example.test");
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    const logged = (["debug", "info", "warn", "error", "log"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const { fetch, urls } = stubFetch(() =>
      Response.json(response("final-answer.json")),
    );

    try {
      await createAnthropicProvider({
        apiKey: "test-key",
        baseUrl: "https://gateway.example.test",
        model: "claude-haiku-5-5",
        effort: "medium",
        maxRetries: 0,
        fetch,
      }).complete({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        maxOutputTokens: 16,
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(urls).toEqual(["https://gateway.example.test/v1/messages"]);
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });
});
