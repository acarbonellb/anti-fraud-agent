// Checks the composition root every entry point builds a review with: the
// paid gate refuses with a typed error before anything is built, the store is
// Firestore exactly when its project is configured, and `mock` connects the
// in-process Satella. Fakes Firestore at the wire (the fake `fetch`); the mock
// Satella is the real in-process server. No model or network call is made:
// building a provider sends nothing.
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../config/config.js";
import { DomainError } from "../errors.js";
import { fixtures } from "../satella-client/fixtures.js";
import type { SatellaConnection } from "../satella-client/local-satella.js";
import {
  createFakeFirestore,
  FAKE_PROJECT,
} from "../test-support/fake-firestore.js";
import {
  buildReviewDependencies,
  buildReviewer,
  PaidNotAllowedError,
} from "./review-dependencies.js";

const PAID_ENV = {
  AGENT_LLM_PROVIDER: "anthropic",
  AGENT_LLM_MODEL: "claude-haiku-5-5",
  AGENT_LLM_API_KEY: "test-key",
};

const open: SatellaConnection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((satella) => satella.close()));
});

function caught(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("buildReviewer", () => {
  it("refuses a paid provider without `paid` with a typed error", () => {
    const error = caught(() =>
      buildReviewer(loadConfig(PAID_ENV), { paid: false }),
    );

    expect(error).toBeInstanceOf(PaidNotAllowedError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: "PAID_NOT_ALLOWED",
      provider: "anthropic",
    });
  });

  it("builds the paid provider with `paid`", () => {
    const { provider } = buildReviewer(loadConfig(PAID_ENV), { paid: true });

    expect(provider).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
  });

  it("builds a local provider without `paid`", () => {
    const { provider } = buildReviewer(loadConfig({}), { paid: false });

    expect(provider.provider).toBe("lmstudio");
  });

  it("searches the web only with a Tavily key", () => {
    const without = buildReviewer(loadConfig({}), { paid: false });
    const withKey = buildReviewer(loadConfig({ TAVILY_API_KEY: "tvly-x" }), {
      paid: false,
    });

    expect(without.search).toBeUndefined();
    expect(without.evidence.extraTools).toEqual([]);
    expect(withKey.search).toBeDefined();
    expect(withKey.evidence.extraTools?.map((tool) => tool.name)).toEqual([
      "web_search",
    ]);
  });
});

describe("buildReviewDependencies", () => {
  it("refuses a paid provider without `paid` before connecting Satella", async () => {
    await expect(
      buildReviewDependencies(loadConfig(PAID_ENV), {
        paid: false,
        mock: true,
        correlationId: "corr-1",
      }),
    ).rejects.toBeInstanceOf(PaidNotAllowedError);
  });

  it("keeps runs in memory without a Firestore project", async () => {
    const firestore = createFakeFirestore();
    const dependencies = await buildReviewDependencies(loadConfig({}), {
      paid: false,
      mock: true,
      correlationId: "corr-1",
      fetch: firestore.fetch,
    });
    open.push(dependencies.satella);

    expect(await dependencies.store.readFeedCursor()).toBeNull();
    expect(firestore.requests).toEqual([]);
  });

  it("stores runs in Firestore when its project is configured", async () => {
    const firestore = createFakeFirestore();
    const dependencies = await buildReviewDependencies(
      loadConfig({ FIRESTORE_PROJECT_ID: FAKE_PROJECT }),
      {
        paid: false,
        mock: true,
        correlationId: "corr-1",
        fetch: firestore.fetch,
      },
    );
    open.push(dependencies.satella);

    expect(await dependencies.store.readFeedCursor()).toBeNull();
    expect(
      firestore.requests.some((request) =>
        request.url.includes(`projects/${FAKE_PROJECT}/`),
      ),
    ).toBe(true);
  });

  it("connects the in-process Satella with `mock`", async () => {
    const dependencies = await buildReviewDependencies(loadConfig({}), {
      paid: false,
      mock: true,
      correlationId: "corr-1",
    });
    open.push(dependencies.satella);

    const page = await dependencies.satella.client.getFeed({});

    expect(page.items.map((item) => item.type)).toEqual(
      fixtures.feed.map((item) => item.type),
    );
  });

  it("refuses to review staging when no Satella is configured", async () => {
    await expect(
      buildReviewDependencies(loadConfig({}), {
        paid: false,
        mock: false,
        correlationId: "corr-1",
      }),
    ).rejects.toMatchObject({ code: "SATELLA_NOT_CONFIGURED" });
  });
});
