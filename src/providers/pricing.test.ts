// Checks the cost of model calls in integer micro-dollars: Haiku 5.5's two
// rate cards and its cache rates, a local model as free, and an unpriced
// model as unknown rather than free. Pure function; fakes nothing.
import { describe, expect, it } from "vitest";

import { costMicros, worstCaseMicros } from "./pricing.js";

describe("cost of model calls", () => {
  it("prices Haiku 5.5 input, cache and output at its rates", () => {
    // 1,000 uncached × $0.10 + 3,000 read × $0.01 + 900 written × $0.125
    // + 210 out × $0.50, per million: 100 + 30 + 112.5 + 105 = 347.5 µ$.
    expect(
      costMicros("anthropic", "claude-haiku-5-5", [
        {
          inputTokens: 4900,
          outputTokens: 210,
          cacheReadInputTokens: 3000,
          cacheWriteInputTokens: 900,
        },
      ]),
    ).toBe(348);
  });

  it("sums a run's calls before rounding", () => {
    // Three calls of 5 input tokens: 0.5 µ$ each would round to 1 + 1 + 1.
    const call = { inputTokens: 5, outputTokens: 0 };
    expect(
      costMicros("anthropic", "claude-haiku-5-5", [call, call, call]),
    ).toBe(2);
  });

  it("bills a prompt over 100K tokens at the long-prompt rates", () => {
    // 200,000 × $0.50 + 1,000 × $2.50, per million: 100,000 + 2,500 µ$.
    expect(
      costMicros("anthropic", "claude-haiku-5-5", [
        { inputTokens: 200_000, outputTokens: 1000 },
      ]),
    ).toBe(102_500);
  });

  it("counts a local model as free and an unpriced one as unknown", () => {
    const call = { inputTokens: 1000, outputTokens: 100 };
    expect(costMicros("lmstudio", "qwen/qwen3.5-9b", [call])).toBe(0);
    expect(costMicros("openai", "some-model", [call])).toBeNull();
  });
});

describe("worst-case cost of a run", () => {
  it("prices every token at the model's dearest rate, rounded up", () => {
    // Haiku 5.5's dearest is long-prompt output, $2.50 per million:
    // 200,000 tokens → $0.50; 3 tokens → 7.5 µ$, held as 8.
    expect(worstCaseMicros("anthropic", "claude-haiku-5-5", 200_000)).toBe(
      500_000,
    );
    expect(worstCaseMicros("anthropic", "claude-haiku-5-5", 3)).toBe(8);
  });

  it("holds nothing for a local model and has no figure for an unpriced one", () => {
    expect(worstCaseMicros("lmstudio", "qwen/qwen3.5-9b", 200_000)).toBe(0);
    expect(worstCaseMicros("openai", "some-model", 200_000)).toBeNull();
  });
});
