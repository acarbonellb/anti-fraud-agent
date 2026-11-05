/**
 * The part of `fetch` the HTTP clients call: tests, recorders and replay
 * inject their own. Here, not in any one client, so none of them depends on
 * another for a type.
 */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
