// Checks the web search adapters: Tavily's request (bearer key, basic depth,
// the result cap), its response reduced to url, title and snippet, and every
// failure mapped to a typed error the tool turns into "unavailable"; the
// tool's cut of what reaches the model; and the authored corpus the evals
// search instead, matched by the query's words.
// Fakes `fetch` with canned Tavily responses.
import { describe, expect, it } from "vitest";

import type { Fetch } from "../fetch.js";
import { createAuthoredSearch } from "./authored.js";
import { createTavilySearch, TAVILY_URL } from "./tavily.js";
import { WebSearchError } from "./types.js";
import type { AnyAgentTool } from "../agent/tools.js";
import { webSearchTool } from "../agent/web-search-tool.js";

const KEY = "tvly-test-key";

function tavily(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve().then(answer);
  };
  return { search: createTavilySearch({ apiKey: KEY, fetch }), calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** Runs a tool as the loop does: its schema checks the arguments first. */
async function run(tool: AnyAgentTool, args: unknown): Promise<unknown> {
  const bound = tool.bind(args);
  if (!bound.ok) throw bound.error;
  return (await bound.call.run()).output;
}

describe("Tavily", () => {
  it("posts a basic search with the key as a bearer token", async () => {
    const { search, calls } = tavily(() => json({ results: [] }));
    await search.search({ query: "Sala Apolo aforo", maxResults: 3 });
    const [call] = calls;
    expect(call?.url).toBe(TAVILY_URL);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("Authorization")).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.parse(call?.init.body as string)).toEqual({
      query: "Sala Apolo aforo",
      max_results: 3,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    });
  });

  it("keeps only url, title and a capped snippet", async () => {
    const { search } = tavily(() =>
      json({
        query: "q",
        results: [
          {
            url: "https://example.test/a",
            title: "A",
            content: "x".repeat(900),
            score: 0.9,
            raw_content: "should not survive",
          },
        ],
        response_time: 0.4,
      }),
    );
    const [result] = await search.search({ query: "q", maxResults: 5 });
    expect(Object.keys(result ?? {})).toEqual(["url", "title", "snippet"]);
    expect(result?.snippet).toHaveLength(500);
  });

  it.each([
    [401, "unauthorized"],
    [432, "quota_exceeded"],
    [433, "quota_exceeded"],
    [429, "rate_limited"],
    [500, "http_error"],
  ])("maps a %i to %s", async (status, failure) => {
    const { search } = tavily(() => json({}, status));
    await expect(
      search.search({ query: "q", maxResults: 5 }),
    ).rejects.toMatchObject({ failure });
  });

  it("maps a timeout and an unexpected body", async () => {
    const timingOut = tavily(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      timingOut.search.search({ query: "q", maxResults: 5 }),
    ).rejects.toMatchObject({ failure: "timeout" });
    const odd = tavily(() => json({ unexpected: true }));
    await expect(
      odd.search.search({ query: "q", maxResults: 5 }),
    ).rejects.toBeInstanceOf(WebSearchError);
  });

  it("tells the model search is unavailable instead of failing the run", async () => {
    const { search } = tavily(() => json({}, 432));
    const tool = webSearchTool(search);
    await expect(run(tool, { query: "algo" })).resolves.toEqual({
      results: [],
      unavailable: "quota_exceeded",
    });
  });
});

describe("authored search", () => {
  const pages = [
    {
      url: "https://gira-ejemplo.test/fechas",
      title: "Los Bárbaros del Sur: fechas de la gira",
      snippet: "Tierra Quemada pasa por Bilbao el mismo día.",
    },
    {
      url: "https://otra-ejemplo.test/",
      title: "Otra cosa",
      snippet: "Nada que ver con la gira.",
    },
  ];

  it("answers a query with the pages that hold enough of its words", async () => {
    const search = createAuthoredSearch(pages);
    const results = await search.search({
      query: "Barbaros del Sur gira fechas",
      maxResults: 5,
    });
    expect(results.map((r) => r.url)).toEqual([
      "https://gira-ejemplo.test/fechas",
    ]);
  });

  it("finds nothing for an unrelated query", async () => {
    const search = createAuthoredSearch(pages);
    expect(
      await search.search({ query: "Valeria Montecristo", maxResults: 5 }),
    ).toEqual([]);
  });
});

describe("the web_search tool", () => {
  it("gives the model 3 results by default, with 300-character snippets", async () => {
    const pages = ["a", "b", "c", "d", "e"].map((id) => ({
      url: `https://gira-ejemplo.test/${id}`,
      title: `Gira de Los Bárbaros del Sur (${id})`,
      snippet: "Fechas de la gira. ".repeat(40),
    }));
    const tool = webSearchTool(createAuthoredSearch(pages));
    const { results } = (await run(tool, {
      query: "Barbaros del Sur gira",
    })) as { results: { snippet: string }[] };
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.snippet.length)).toEqual([
      300, 300, 300,
    ]);
  });
});
