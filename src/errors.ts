/**
 * Base for typed domain errors (CLAUDE.md §5). `code` is stable and is what
 * the edge maps to a response or an exit status; `message` is for logs and
 * never carries secrets or whole Satella responses.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The code an edge logs or maps for whatever was thrown: a domain error's
 * own, `UNEXPECTED` for anything else, whose message could carry more than
 * ids.
 */
export function codeOf(error: unknown): string {
  return error instanceof DomainError ? error.code : "UNEXPECTED";
}
