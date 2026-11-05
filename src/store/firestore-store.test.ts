// Runs the AgentStore contract against the Firestore store, then checks what
// only it does: the REST requests it sends (document paths, the precondition
// on every update, how integers and nested maps are encoded, the metadata
// token), and its typed errors on a conflict, a 403 and a network failure,
// none carrying a response body. Fakes Firestore's REST API and the metadata
// server with one in-memory `fetch`, and the clock.
import { describe, expect, it } from "vitest";

import {
  createFakeFirestore,
  FAKE_PROJECT,
  FAKE_TOKEN,
  type FakeFirestore,
} from "./fake-firestore.js";
import { createFirestoreStore } from "./firestore-store.js";
import { describeAgentStore, runDocument } from "./store-contract.js";
import { type AgentStore, StoreError } from "./types.js";

describeAgentStore("Firestore store", (now) => ({
  store: createFirestoreStore({
    projectId: FAKE_PROJECT,
    fetch: createFakeFirestore().fetch,
    now,
  }),
}));

const DOCUMENTS = `https://firestore.googleapis.com/v1/projects/${FAKE_PROJECT}/databases/(default)/documents`;

function setup(now = () => new Date("2026-11-05T10:00:00.000Z")): {
  fake: FakeFirestore;
  store: AgentStore;
} {
  const fake = createFakeFirestore();
  return {
    fake,
    store: createFirestoreStore({
      projectId: FAKE_PROJECT,
      fetch: fake.fetch,
      now,
    }),
  };
}

async function errorOf(promise: Promise<unknown>): Promise<StoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  throw new Error("expected a StoreError");
}

const firestoreRequests = (fake: FakeFirestore) =>
  fake.requests.filter((request) => !request.url.includes("metadata"));

describe("the requests it sends", () => {
  it("creates a run under its id, encoding integers as strings and maps as maps", async () => {
    const { fake, store } = setup();

    await store.saveRun(runDocument("run_1", "2026-11-05T09:00:00.000Z"));

    const [create] = firestoreRequests(fake);
    expect(create?.method).toBe("POST");
    expect(create?.url).toBe(`${DOCUMENTS}/runs?documentId=run_1`);
    const fields = (create?.body as { fields: Record<string, unknown> }).fields;
    expect(fields.costMicros).toEqual({ integerValue: "1590" });
    expect(fields.confidence).toEqual({ doubleValue: 0.92 });
    expect(fields.infoRequest).toEqual({ nullValue: null });
    expect(fields.startedAt).toEqual({
      stringValue: "2026-11-05T09:00:00.000Z",
    });
    expect(fields.usage).toEqual({
      mapValue: {
        fields: {
          inputTokens: { integerValue: "12000" },
          outputTokens: { integerValue: "800" },
          cacheReadInputTokens: { integerValue: "9000" },
          cacheWriteInputTokens: { integerValue: "0" },
        },
      },
    });
    // An entry without an error has no `error` field, not a null one.
    expect(fields.trace).toEqual({
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                tool: { stringValue: "get_event_context" },
                ok: { booleanValue: true },
              },
            },
          },
          {
            mapValue: {
              fields: {
                tool: { stringValue: "web_search" },
                ok: { booleanValue: false },
                error: { stringValue: "BUDGET_SPENT" },
              },
            },
          },
        ],
      },
    });
  });

  it("authenticates with the metadata server's token, fetched once while valid", async () => {
    const { fake, store } = setup();

    await store.getRun("run_1");
    await store.readFeedCursor();

    const [token] = fake.requests;
    expect(token?.url).toContain("metadata.google.internal");
    expect(token?.headers["metadata-flavor"]).toBe("Google");
    expect(fake.tokenRequests()).toBe(1);
    for (const request of firestoreRequests(fake)) {
      expect(request.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    }
  });

  it("fetches a new token once the one it has expires", async () => {
    let clock = new Date("2026-11-05T10:00:00.000Z");
    const fake = createFakeFirestore({ tokenExpiresInSeconds: 600 });
    const store = createFirestoreStore({
      projectId: FAKE_PROJECT,
      fetch: fake.fetch,
      now: () => clock,
    });

    await store.readFeedCursor();
    clock = new Date(clock.getTime() + 600_000);
    await store.readFeedCursor();

    expect(fake.tokenRequests()).toBe(2);
  });

  it("talks to the emulator without a token", async () => {
    const requests: string[] = [];
    const store = createFirestoreStore({
      projectId: FAKE_PROJECT,
      emulatorHost: "localhost:8080",
      fetch: (url) => {
        requests.push(url);
        return Promise.resolve(new Response("{}", { status: 404 }));
      },
    });

    await store.getRun("run_1");

    expect(requests).toEqual([
      `http://localhost:8080/v1/projects/${FAKE_PROJECT}/databases/(default)/documents/runs/run_1`,
    ]);
  });

  it("advances the cursor with a precondition on what it read", async () => {
    const { fake, store } = setup();

    await store.advanceFeedCursor(null, "cur_1");
    await store.advanceFeedCursor("cur_1", "cur_2");

    const patches = firestoreRequests(fake).filter((r) => r.method === "PATCH");
    expect(patches.map((patch) => new URL(patch.url).search)).toEqual([
      "?currentDocument.exists=false",
      `?currentDocument.updateTime=${encodeURIComponent("2026-11-05T00:00:00.000001Z")}`,
    ]);
    expect(
      patches[0]?.url.startsWith(`${DOCUMENTS}/agentState/feedCursor?`),
    ).toBe(true);
  });

  it("keeps the day's holds in one document per UTC day, as a map by run", async () => {
    const { fake, store } = setup();

    await store.reserveSpend({
      runId: "run_1",
      micros: 4_000,
      budgetMicros: 10_000,
    });

    expect(fake.documents.get("spend/2026-11-05")?.fields).toEqual({
      entries: {
        mapValue: {
          fields: {
            run_1: {
              mapValue: {
                fields: {
                  micros: { integerValue: "4000" },
                  expiresAt: { stringValue: "2026-11-05T10:15:00.000Z" },
                },
              },
            },
          },
        },
      },
    });
  });
});

describe("concurrent writers", () => {
  it("refuses a cursor advance when another pass wrote between its read and its write", async () => {
    const { fake, store } = setup();
    await store.advanceFeedCursor(null, "cur_1");
    fake.beforeNextPatch(() => {
      const document = fake.documents.get("agentState/feedCursor");
      if (document === undefined) throw new Error("no cursor");
      fake.documents.set("agentState/feedCursor", {
        ...document,
        fields: { cursor: { stringValue: "cur_other" } },
        updateTime: "2026-11-05T00:00:01.000000Z",
      });
    });

    const error = await errorOf(store.advanceFeedCursor("cur_1", "cur_2"));

    expect(error.code).toBe("STORE_CONFLICT");
    expect(await store.readFeedCursor()).toBe("cur_other");
  });

  it("re-reads and retries a reservation that lost a race, then counts both", async () => {
    const { fake, store } = setup();
    const other = createFirestoreStore({
      projectId: FAKE_PROJECT,
      fetch: fake.fetch,
      now: () => new Date("2026-11-05T10:00:00.000Z"),
    });
    await store.reserveSpend({
      runId: "run_0",
      micros: 1_000,
      budgetMicros: 10_000,
    });
    let raced = false;
    fake.beforeNextPatch(() => {
      raced = true;
      // Synchronously, the other writer's patch lands first.
      const document = fake.documents.get("spend/2026-11-05");
      if (document === undefined) throw new Error("no spend");
      fake.documents.set("spend/2026-11-05", {
        ...document,
        fields: {
          entries: {
            mapValue: {
              fields: {
                ...(document.fields.entries as { mapValue: { fields: object } })
                  .mapValue.fields,
                run_other: {
                  mapValue: {
                    fields: {
                      micros: { integerValue: "5000" },
                      expiresAt: { stringValue: "2026-11-05T10:15:00.000Z" },
                    },
                  },
                },
              },
            },
          },
        },
        updateTime: "2026-11-05T00:00:09.000000Z",
      });
    });

    const reservation = await store.reserveSpend({
      runId: "run_1",
      micros: 4_000,
      budgetMicros: 10_000,
    });

    expect(raced).toBe(true);
    expect(reservation.ok).toBe(true);
    expect(await other.daySpend()).toEqual({
      day: "2026-11-05",
      settledMicros: 0,
      heldMicros: 10_000,
    });
  });
});

describe("typed errors", () => {
  const SECRET_BODY = {
    error: { code: 403, message: "secret-detail", status: "PERMISSION_DENIED" },
  };

  it.each([
    [
      {
        status: 409,
        body: { error: { status: "ABORTED", message: "secret-detail" } },
      },
      "STORE_CONFLICT",
      409,
    ],
    [
      { status: 412, body: { error: { message: "secret-detail" } } },
      "STORE_CONFLICT",
      412,
    ],
    [{ status: 403, body: SECRET_BODY }, "STORE_FORBIDDEN", 403],
    [{ status: 401, body: SECRET_BODY }, "STORE_FORBIDDEN", 401],
    [
      { status: 503, body: { error: { message: "secret-detail" } } },
      "STORE_UNAVAILABLE",
      503,
    ],
    [
      { status: 500, body: { error: { message: "secret-detail" } } },
      "STORE_HTTP_ERROR",
      500,
    ],
  ] as const)("maps %o to %s with no body", async (answer, code, status) => {
    const { fake, store } = setup();
    fake.failNext(answer);

    const error = await errorOf(store.getRun("run_1"));

    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("secret-detail");
    expect(JSON.stringify(error)).not.toContain("secret-detail");
    expect(error.cause).toBeUndefined();
  });

  it("maps a network failure to STORE_UNAVAILABLE", async () => {
    const { fake, store } = setup();
    fake.failNext("network");

    const error = await errorOf(store.readFeedCursor());

    expect(error.code).toBe("STORE_UNAVAILABLE");
    expect(error.status).toBeNull();
  });

  it("refuses a stored run that no longer parses, without echoing it", async () => {
    const { fake, store } = setup();
    await store.saveRun(runDocument("run_1", "2026-11-05T09:00:00.000Z"));
    const stored = fake.documents.get("runs/run_1");
    if (stored === undefined) throw new Error("not saved");
    stored.fields.decision = { stringValue: "secret-detail" };

    const error = await errorOf(store.getRun("run_1"));

    expect(error.code).toBe("STORE_BAD_RESPONSE");
    expect(error.message).not.toContain("secret-detail");
  });
});
