/**
 * What model calls cost, in integer micro-dollars, the unit of
 * `AGENT_DAILY_BUDGET_MICROS` (brief §6.3, #30). Prices are per million
 * tokens, from each provider's pricing page; update them with the page, not
 * from memory.
 */
import type { TokenUsage } from "./types.js";

/** Micro-dollars per million tokens: integers, as money is (CLAUDE.md §5). */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface ModelPrice {
  rates: Rates;
  /** A prompt longer than `promptTokens` is billed at `rates` instead. */
  longPrompt?: { promptTokens: number; rates: Rates };
}

// Anthropic's pricing page, checked 2026-11-04. Cache reads are 0.1× the
// input rate and 5-minute cache writes 1.25×, on both rate cards.
const PRICES: Readonly<Record<string, ModelPrice>> = {
  "anthropic/claude-haiku-5-5": {
    rates: {
      input: 100_000,
      output: 500_000,
      cacheRead: 10_000,
      cacheWrite: 125_000,
    },
    longPrompt: {
      promptTokens: 100_000,
      rates: {
        input: 500_000,
        output: 2_500_000,
        cacheRead: 50_000,
        cacheWrite: 625_000,
      },
    },
  },
};

/** Models that run on this machine: no bill. */
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["lmstudio"]);

/**
 * The cost of a run's calls, rounded once at the end. Null for a model with
 * no price here: an unknown cost is never reported as free.
 */
export function costMicros(
  provider: string,
  model: string,
  calls: readonly TokenUsage[],
): number | null {
  if (LOCAL_PROVIDERS.has(provider)) return 0;
  const price = PRICES[`${provider}/${model}`];
  if (price === undefined) return null;
  // Token × micro-dollars per million: summed exactly, divided once.
  const scaled = calls.reduce((total, usage) => {
    const rates =
      price.longPrompt !== undefined &&
      usage.inputTokens > price.longPrompt.promptTokens
        ? price.longPrompt.rates
        : price.rates;
    const cacheRead = usage.cacheReadInputTokens ?? 0;
    const cacheWrite = usage.cacheWriteInputTokens ?? 0;
    return (
      total +
      (usage.inputTokens - cacheRead - cacheWrite) * rates.input +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite +
      usage.outputTokens * rates.output
    );
  }, 0);
  return Math.round(scaled / 1_000_000);
}

/**
 * The most a run within `maxTokens` can cost: every token at the model's
 * dearest rate, rounded up. What a run reserves against the day's budget
 * before it starts (ADR 0017). Pessimistic on purpose: a run is mostly input,
 * so the hold is far above the actual cost, and settling returns the rest.
 * Null for a model with no price, as `costMicros`.
 */
export function worstCaseMicros(
  provider: string,
  model: string,
  maxTokens: number,
): number | null {
  if (LOCAL_PROVIDERS.has(provider)) return 0;
  const price = PRICES[`${provider}/${model}`];
  if (price === undefined) return null;
  const cards =
    price.longPrompt === undefined
      ? [price.rates]
      : [price.rates, price.longPrompt.rates];
  const dearest = Math.max(
    ...cards.flatMap((rates) => [
      rates.input,
      rates.output,
      rates.cacheRead,
      rates.cacheWrite,
    ]),
  );
  return Math.ceil((maxTokens * dearest) / 1_000_000);
}
