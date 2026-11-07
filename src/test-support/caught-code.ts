/**
 * The code of the domain error a call throws or rejects with, or null when it
 * succeeds. Takes the call (for one that may throw before it returns) or its
 * promise. Anything but a domain error is rethrown, so a plain error fails the
 * test that expected a typed one.
 */
import { DomainError } from "../errors.js";

export async function caughtCode(
  call: (() => unknown) | Promise<unknown>,
): Promise<string | null> {
  try {
    await (typeof call === "function" ? call() : call);
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}
