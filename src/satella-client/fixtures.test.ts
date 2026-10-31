// Every fixture parses with the contract schema it stands for: a fixture that
// drifts from the contract is a failing test (write-tests §2). Fakes nothing.
import { expect, it } from "vitest";

import { fixtures } from "./fixtures.js";
import {
  eventReviewContextSchema,
  feedItemSchema,
  priceBenchmarkSchema,
  similarEventsSchema,
} from "./schemas.js";

it("parses every fixture with its contract schema", () => {
  expect(() => {
    eventReviewContextSchema.parse(fixtures.eventContext);
    fixtures.feed.forEach((item) => feedItemSchema.parse(item));
    similarEventsSchema.parse(fixtures.similarEvents);
    priceBenchmarkSchema.parse(fixtures.priceBenchmark);
  }).not.toThrow();
});
