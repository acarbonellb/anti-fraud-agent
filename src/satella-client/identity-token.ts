/**
 * The agent's identity before Satella (brief §3.1, §13; #9): a Google
 * identity token of the job's service account, asked of the Cloud Run
 * metadata server with `aud` = `SATELLA_AGENT_API_AUDIENCE`. No shared secret
 * exists to leak or rotate. Application default credentials are never read.
 */
import { z } from "zod";

import { DomainError } from "../errors.js";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
/** A token is renewed this long before it expires, so none dies in flight. */
const TOKEN_MARGIN_MS = 60_000;
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
  let token: { value: string; expiresAt: number } | null = null;

  return async () => {
    if (
      token === null ||
      now().getTime() >= token.expiresAt - TOKEN_MARGIN_MS
    ) {
      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: { "Metadata-Flavor": "Google" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
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
      const value = (await response.text()).trim();
      token = { value, expiresAt: expiryOf(value) };
    }
    return token.value;
  };
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
