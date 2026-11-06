/**
 * A token from the Cloud Run metadata server, kept until shortly before it
 * expires and then fetched again. The identity token for Satella and the
 * access token for Firestore share this; how each is fetched, and how its
 * failure is typed, stays with its client.
 */

/** A token is renewed this long before it expires, so none dies in flight. */
export const TOKEN_MARGIN_MS = 60_000;

export interface Token {
  value: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export function cachedToken(
  fetchToken: () => Promise<Token>,
  now: () => Date,
): () => Promise<string> {
  let token: Token | null = null;
  return async () => {
    if (
      token === null ||
      now().getTime() >= token.expiresAt - TOKEN_MARGIN_MS
    ) {
      token = await fetchToken();
    }
    return token.value;
  };
}
