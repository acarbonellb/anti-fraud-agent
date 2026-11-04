// Checks the copied-text check: one search for the description's longest
// sentence, and a warning only when another page holds that sentence word for
// word. Fakes the web with the authored search over invented pages.
import { describe, expect, it } from "vitest";

import { createAuthoredSearch } from "../search/authored.js";
import {
  type SearchQuery,
  type SearchResult,
  type WebSearch,
  WebSearchError,
} from "../search/types.js";
import { fixtures } from "../satella-client/fixtures.js";
import type { EventReviewContext } from "../satella-client/schemas.js";
import { copiedTextCheck } from "./copied-text.js";

const DESCRIPTION =
  "Déjate envolver por un viaje sonoro irrepetible: las bandas sonoras más queridas del cine, interpretadas por un cuarteto de cuerda. Plazas limitadas.";
const LONGEST =
  "Déjate envolver por un viaje sonoro irrepetible: las bandas sonoras más queridas del cine, interpretadas por un cuarteto de cuerda";

function withDescription(description: string | null): EventReviewContext {
  return {
    ...fixtures.eventContext,
    event: { ...fixtures.eventContext.event, description },
  };
}

const copy: SearchResult = {
  url: "https://entradas-ejemplo.test/eventos/velas",
  title: "Bandas sonoras a la luz de las velas | EntradasEjemplo",
  // Another site's casing, accents and punctuation: still the same words.
  snippet:
    "DEJATE envolver por un viaje sonoro irrepetible — las bandas sonoras mas queridas del cine, interpretadas por un cuarteto de cuerda y miles de velas.",
};
const lookalike: SearchResult = {
  url: "https://otra-sala.test/agenda",
  title: "Bandas sonoras del cine con cuarteto de cuerda",
  snippet:
    "Un cuarteto de cuerda interpreta las bandas sonoras del cine en un viaje por la historia de la música.",
};

/** A search that keeps the queries it was asked. */
function spying(inner: WebSearch) {
  const queries: SearchQuery[] = [];
  const search: WebSearch = {
    provider: inner.provider,
    search(query) {
      queries.push(query);
      return inner.search(query);
    },
  };
  return { search, queries };
}

describe("copied description", () => {
  it("warns, with the page as source, when another site has the longest sentence word for word", async () => {
    const { search, queries } = spying(createAuthoredSearch([lookalike, copy]));

    const findings = await copiedTextCheck(
      withDescription(DESCRIPTION),
      search,
    );

    expect(queries).toEqual([{ query: `"${LONGEST}"`, maxResults: 5 }]);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.certainty).toBe("heuristic");
    expect(finding?.finding).toMatchObject({
      check: "text_originality",
      verdict: "warn",
      sources: [{ url: copy.url, title: copy.title }],
    });
    expect(finding?.finding.detail).toContain("entradas-ejemplo.test");
  });

  it("gives no finding when the pages only share words", async () => {
    const findings = await copiedTextCheck(
      withDescription(DESCRIPTION),
      createAuthoredSearch([lookalike]),
    );
    expect(findings).toEqual([]);
  });

  it.each([
    ["no description", null],
    [
      "no sentence long enough to be a fingerprint",
      "Concierto. Plazas limitadas.",
    ],
  ])("doesn't search with %s", async (_, description) => {
    const { search, queries } = spying(createAuthoredSearch([copy]));
    expect(await copiedTextCheck(withDescription(description), search)).toEqual(
      [],
    );
    expect(queries).toEqual([]);
  });

  it("gives no finding when search is down: the review goes on", async () => {
    const down: WebSearch = {
      provider: "down",
      search: () => Promise.reject(new WebSearchError("quota_exceeded")),
    };
    expect(await copiedTextCheck(withDescription(DESCRIPTION), down)).toEqual(
      [],
    );
  });

  it("searches a long sentence by its first words, within the query limit", async () => {
    const long = `${Array.from({ length: 40 }, (_, i) => `palabra${String(i)}`).join(" ")}.`;
    const { search, queries } = spying(createAuthoredSearch([]));

    await copiedTextCheck(withDescription(long), search);

    const words = queries[0]?.query.replaceAll('"', "").split(" ") ?? [];
    expect(words).toHaveLength(25);
    expect(words[0]).toBe("palabra0");
  });
});
