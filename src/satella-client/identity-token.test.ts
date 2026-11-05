// Checks that the agent's Google identity token for Satella is asked of the
// Cloud Run metadata server with the right audience and claims, reused until
// shortly before it expires, and refused as a typed error when the server
// fails. Fakes the metadata server with a recording fetch and the clock.
import { describe, expect, it } from "vitest";

import {
  createIdentityTokenSource,
  IdentityTokenError,
} from "./identity-token.js";

const AUDIENCE = "https://staging.example.test";
const START = new Date("2026-11-05T10:00:00Z");

/** An unsigned JWT is enough: the agent only reads `exp`; Satella verifies. */
function jwt(expiresAt: Date): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ exp: expiresAt.getTime() / 1000 })}.sig`;
}

function fakeMetadata(responses: Response[]) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers) });
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    return Promise.resolve(next);
  };
  return { calls, fetch };
}

describe("createIdentityTokenSource", () => {
  it("asks the metadata server for a full token with Satella's audience", async () => {
    const token = jwt(new Date("2026-11-05T11:00:00Z"));
    const metadata = fakeMetadata([new Response(token)]);
    const source = createIdentityTokenSource({
      audience: AUDIENCE,
      fetch: metadata.fetch,
      now: () => START,
    });

    await expect(source()).resolves.toBe(token);

    const [call] = metadata.calls;
    const url = new URL(call?.url ?? "");
    expect(url.origin + url.pathname).toBe(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity",
    );
    expect(url.searchParams.get("audience")).toBe(AUDIENCE);
    // Satella requires `email` and `email_verified`, which only `full` carries.
    expect(url.searchParams.get("format")).toBe("full");
    expect(call?.headers.get("metadata-flavor")).toBe("Google");
  });

  it("reuses the token until a minute before it expires", async () => {
    const first = jwt(new Date("2026-11-05T11:00:00Z"));
    const second = jwt(new Date("2026-11-05T12:00:00Z"));
    const metadata = fakeMetadata([new Response(first), new Response(second)]);
    let now = START;
    const source = createIdentityTokenSource({
      audience: AUDIENCE,
      fetch: metadata.fetch,
      now: () => now,
    });

    await source();
    now = new Date("2026-11-05T10:58:59Z");
    await expect(source()).resolves.toBe(first);
    now = new Date("2026-11-05T10:59:00Z");
    await expect(source()).resolves.toBe(second);
    expect(metadata.calls).toHaveLength(2);
  });

  it.each([
    ["the server fails", new Response("nope", { status: 500 })],
    ["the token isn't a JWT", new Response("not-a-jwt")],
  ])("refuses with a typed error when %s", async (_, response) => {
    const source = createIdentityTokenSource({
      audience: AUDIENCE,
      fetch: fakeMetadata([response]).fetch,
      now: () => START,
    });

    await expect(source()).rejects.toThrow(IdentityTokenError);
  });
});
