/**
 * The web search the configuration names: Tavily with a key, none without
 * (ADR 0015 point 8). A review then runs without web search, as production
 * would without the key.
 */
import type { Config } from "../config/config.js";
import { createTavilySearch } from "./tavily.js";
import type { WebSearch } from "./types.js";

export function createConfiguredSearch(
  config: Config["webSearch"],
): WebSearch | undefined {
  return config.tavilyApiKey === undefined
    ? undefined
    : createTavilySearch({
        apiKey: config.tavilyApiKey,
        fetch: globalThis.fetch,
      });
}
