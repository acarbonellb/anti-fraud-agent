/**
 * Organizer texts, Satella payloads and anything from the web reach the model
 * as data, never as instructions (brief D9, CODING_STANDARDS "Untrusted text
 * never steers control flow").
 *
 * The data goes inside a fence whose tag carries a per-run random nonce: the
 * organizer can't close the fence early because they can't guess the nonce,
 * and the system prompt tells the model that only text outside fences with
 * that nonce is an instruction.
 */
import { randomBytes } from "node:crypto";

export interface UntrustedFence {
  readonly nonce: string;
  wrap(source: string, data: unknown): string;
}

export function createUntrustedFence(
  nonce: string = randomBytes(12).toString("hex"),
): UntrustedFence {
  return {
    nonce,
    wrap(source, data) {
      // JSON keeps the data's structure and escapes nothing the model needs;
      // the nonce is what makes the fence unforgeable.
      const body = typeof data === "string" ? data : JSON.stringify(data);
      return [
        `<untrusted_data source="${source.replace(/[^\w.-]/g, "_")}" nonce="${nonce}">`,
        body,
        `</untrusted_data nonce="${nonce}">`,
      ].join("\n");
    },
  };
}
