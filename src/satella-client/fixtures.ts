// Fictitious fixtures shared by the client's contract tests and the mock
// server. Organizers, venues and artists are invented (CLAUDE.md §5).
import { readFileSync } from "node:fs";

import {
  type EventReviewContext,
  type FeedItem,
  type PriceBenchmark,
  type SimilarEvent,
} from "./schemas.js";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

// Typed by assertion here and parsed by the mock server and by the fixture
// test, so a fixture that drifts from the contract fails loudly.
export const fixtures = {
  eventContext: load("event-review-context.json") as EventReviewContext,
  feed: load("feed.json") as FeedItem[],
  similarEvents: load("similar-events.json") as SimilarEvent[],
  priceBenchmark: load("price-benchmark.json") as PriceBenchmark,
};
