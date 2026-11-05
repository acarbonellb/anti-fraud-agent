/**
 * The agent's identity before Satella (brief §3.1, §13; #9): a Google
 * identity token of the job's service account, asked of the Cloud Run
 * metadata server with `aud` = `SATELLA_AGENT_API_AUDIENCE`. No shared secret
 * exists to leak or rotate. Application default credentials are never read.
 */
import { z } from "zod";

import { cachedToken } from "../cached-token.js";
import { DomainError } from "../errors.js";
import type { Fetch } from "../fetch.js";

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const REQUEST_TIMEOUT_MS = 10_000;

const claimsSchema = z.object({ exp: z.number().positive() });

export class IdentityTokenError extends DomainError {
  readonly code = "IDENTITY_TOKEN_UNAVAILABLE";
}

export interface IdentityTokenSourceOptions {
  audience: string;
  fetch?: Fetch;
  now?: () => Date;
}

/** Returns a function that yields a valid token, reusing it while it lasts. */
export function createIdentityTokenSource(
  options: IdentityTokenSourceOptions,
): () => Promise<string> {
  const doFetch: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const url = new URL(METADATA_IDENTITY_URL);
  url.searchParams.set("audience", options.audience);
  // Satella checks `email` and `email_verified`, which only `full` includes.
  url.searchParams.set("format", "full");

  return cachedToken(async () => {
    let response: Response;
    let value: string;
    try {
      response = await doFetch(url.toString(), {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      value = (await response.text()).trim();
    } catch (error) {
      throw new IdentityTokenError("metadata server unreachable", {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new IdentityTokenError(
        `metadata server: ${String(response.status)}`,
      );
    }
    return { value, expiresAt: expiryOf(value) };
  }, now);
}

/** Reads `exp` without verifying the signature: Satella is the verifier. */
function expiryOf(jwt: string): number {
  const payload = jwt.split(".")[1];
  try {
    const claims = claimsSchema.parse(
      JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")),
    );
    return claims.exp * 1000;
  } catch {
    throw new IdentityTokenError("metadata server: not a JWT");
  }
}
