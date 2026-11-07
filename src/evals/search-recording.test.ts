// What a search recording keeps: snippets no longer than the model reads, so
// the repo stores no more third-party text than the agent uses (#85). Fakes
// the real search with an in-memory one returning long snippets.
import { describe, expect, it } from "vitest";

import type { WebSearch } from "../search/types.js";
import { createRecordingSearch } from "./search-recording.js";

const longSnippet = "Fechas de la gira. ".repeat(40);

const inner: WebSearch = {
  provider: "fake",
  search: () =>
    Promise.resolve([
      { url: "https://example.org/a", title: "Gira", snippet: longSnippet },
      { url: "https://example.org/b", title: "Corto", snippet: "Breve." },
    ]),
};

describe("createRecordingSearch", () => {
  it("records snippets cut to the length the model reads", async () => {
    const recording = createRecordingSearch(inner);

    await recording.search.search({ query: "gira", maxResults: 3 });

    const [call] = recording.calls();
    const results =
      call !== undefined && "results" in call.response
        ? call.response.results
        : [];
    expect(results.map((result) => result.snippet)).toEqual([
      longSnippet.slice(0, 300),
      "Breve.",
    ]);
  });

  it("answers the recording run with the cut snippets replay will serve", async () => {
    const recording = createRecordingSearch(inner);

    const results = await recording.search.search({
      query: "gira",
      maxResults: 3,
    });

    expect(results[0]?.snippet).toHaveLength(300);
  });
});
