// Every fixture parses with the contract schema it stands for: a fixture that
// drifts from the contract is a failing test (write-tests §2). Fakes nothing.
import { expect, it } from "vitest";

import { fixtures } from "./fixtures.js";
import {
  eventReviewContextSchema,
  feedItemSchema,
  organizerReviewContextSchema,
  priceBenchmarkSchema,
  similarEventSchema,
} from "./schemas.js";

it("parses every fixture with its contract schema", () => {
  expect(() => {
    eventReviewContextSchema.parse(fixtures.eventContext);
    organizerReviewContextSchema.parse(fixtures.organizerContext);
    fixtures.feed.forEach((item) => feedItemSchema.parse(item));
    fixtures.similarEvents.forEach((item) => similarEventSchema.parse(item));
    priceBenchmarkSchema.parse(fixtures.priceBenchmark);
  }).not.toThrow();
});
