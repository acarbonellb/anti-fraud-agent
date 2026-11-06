# ADR 0008 — A provider-neutral agent with two adapters, shipped local-model first

- **Date:** 2026-11-01
- **Status:** accepted · amendment 2026-11-04 (#30) · amendment 2026-11-04 (#42) · amendment 2026-11-05 (#46) ·
  amendment 2026-11-07 (#89, #84)
- **Related:** brief D8 and §4; ADR 0011 (the Satella contract); issue #5.

## Context

Brief D8 asks for an agent that is neutral with respect to the LLM provider: one interface with
adapters for Claude, OpenAI and Grok over the same tools, evaluated offline first. The role the
project targets also asks for open-source models.

Two facts shaped the plan:

- Not every provider needs its own adapter. An adapter translates the loop's neutral messages,
  tools and token usage into one API format. Claude's Messages API has its own format. OpenAI's
  Chat Completions is shared by xAI's Grok and by local servers such as LM Studio and Ollama.
- Paid APIs cost money for every real run. The author's Claude Max plan covers claude.ai and
  Claude Code, not API calls. The first phase has to run at zero cost, which means a local
  open-source model.

A smoke test on 2026-11-01 confirmed the local path. `qwen/qwen3.5-9b` served by LM Studio on an
RTX 4070 Laptop (8 GB of VRAM) made a correct tool call in 1.6 s and closed the round trip with
a correct answer. Its responses follow the OpenAI format, with an extra `reasoning_content`
field.

## Decision

1. **The loop, the policy and the evals talk only to `LlmProvider`** (`src/providers/types.ts`):
   neutral messages, tool definitions generated from Zod as JSON Schema, tool calls with their
   raw JSON arguments, and token usage. No provider's wire format leaves its adapter.
2. **Two adapters cover four providers.** The **OpenAI-compatible** adapter serves OpenAI, Grok
   and local open-source servers; only the base URL, the key and the model change. The
   **Anthropic** adapter serves Claude. Provider choice is configuration (`AGENT_LLM_*`).
3. **They ship in phases.** Phase 1 delivers the OpenAI-compatible adapter against a local model
   (LM Studio by default, `qwen/qwen3.5-9b`), at zero API cost. OpenAI and Grok come next as
   configuration. Claude comes with the Anthropic adapter. Any paid run needs the author's
   go-ahead first (CLAUDE.md §8).
4. **A scripted provider keeps the seam honest.** Loop tests run on a provider that replays
   scripted responses. With one real adapter, that second implementation stops the interface
   from taking on any one provider's shape. Adapter tests replay recorded real responses
   (`src/providers/openai-compatible/recordings/`); no unit test touches the network.
5. **The default model is chosen by the evals, not by preference.** Once the eval runner exists
   (#6), it compares provider × model on accuracy, approved-fraud rate, cost and latency, and
   the winner becomes the default.

## Alternatives rejected

- **One adapter per provider (four).** Grok and local servers speak OpenAI's format. Four
  adapters would mean three copies of the same translation.
- **A unifying library (Vercel AI SDK, LiteLLM).** It saves the adapters, but hides what this
  project is meant to show: tool schema translation, tool-call parsing and token accounting. It
  also adds a dependency between the agent and every provider change.
- **Start with Claude.** It has the strongest tool use, but every real run costs money from day
  one, and a local model is enough to build and debug the loop.
- **Configure all four providers now.** It's a lot of setup and keys before the loop has even
  run once. The neutral interface already keeps the door open.

## Consequences

- A local model is weaker than the paid ones. In the first real run it miscomputed a service
  fee: it called 150 cents on a €15 ticket "about 1%". Calculations belong in deterministic
  tools (#7), not in the model.
- Findings name a check from a closed vocabulary (`src/checks/vocabulary.ts`), so the policy reads
  stable names instead of labels the model invents.
- `pnpm review:local` runs one real review on the local model against the Satella mock, with
  nothing leaving the machine.
- Cost per review is measured in tokens from day one. Prices per model arrive with the paid
  providers.

## Amendment (2026-11-04, #30): the Anthropic adapter, and what Claude asks of the interface

Phase 2 ships the Anthropic adapter (`src/providers/anthropic/adapter.ts`) on the official
`@anthropic-ai/sdk`, for one paid model: Claude Haiku 5.5 (`claude-haiku-5-5`). Its first
pass is E013 (`docs/experiments.md`). It refines points 1, 3 and 4 and doesn't reverse any:

1. **An assistant turn may carry the provider's own blocks (`providerContent`).** Haiku 5.5
   thinks before it answers, and a thinking block must go back unchanged, with its signature,
   next to the tool results. The neutral message keeps its text and tool calls and adds an opaque
   `providerContent` that only the adapter that produced it reads. Other adapters ignore it; the
   recordings keep it, so a replayed request hashes the same.
2. **Thinking gets its own room.** Thinking counts toward `max_tokens`, and the loop's per-call
   cap (4,096) was sized for the answer. The adapter adds 8,192 tokens of headroom. The loop's
   cap stays as it is, so the qwen recordings, whose requests carry it, stay valid. The run's
   token budget still counts every token the call reports.
3. **No sampling parameters, effort instead.** API version 2026-10-21 rejects `temperature`, so
   a Claude run can't be pinned: reproducibility rests on the recordings, and noise is measured
   by repeating runs. `AGENT_LLM_EFFORT` (default `medium`) is sent explicitly so every run
   states it.
4. **Usage counts every input token and says which were cached.** `inputTokens` is the total
   processed; `cacheReadInputTokens` and `cacheWriteInputTokens` are its cached parts. Automatic
   prompt caching lets each step of a review read the steps before it.
5. **Cost is priced per call, in integer micro-dollars** (`src/providers/pricing.ts`), because
   Haiku's rate card depends on each prompt's length. The report shows the mean cost per review.
   It stays out of the history entries, whose schema never changes after an entry is written
   (ADR 0014). A local model costs 0; an unpriced model costs «unknown», never 0.
6. **A paid provider needs `--paid`.** `pnpm eval` and `pnpm review:local` refuse to call one
   without the flag, so a `.env` left on `anthropic` never spends by accident (CLAUDE.md §8).

Point 4's «adapter tests replay recorded real responses» holds for the OpenAI-compatible
adapter. The Anthropic adapter's test responses were written from the documented Messages API
shape before any paid call. The first real pass (E013) confirmed that shape: a thinking block
with an empty text and a signature, then the tool calls.

**Rejected:** raising the loop's per-call cap for every provider, which would make every qwen
recording stale for a limit qwen doesn't need. Also rejected: dropping thinking blocks between
turns, which the API requires back with the tool results. Also rejected: `thinking: disabled`,
which would give up the model's reasoning to save output tokens on a review that costs $0.002.

## Amendment (2026-11-04, #42): the evals pick the deployed model; development stays local

Point 5 says the evals' winner becomes the default. E014 picks Claude Haiku 5.5: gated accuracy
86.7 % (83.3–90.0 across three runs) against qwen's 73.3 %, no approved fraud in any run, $0.0022
per review. This amendment refines point 5: "default" means **the model the deployed agent runs**,
not the code's fallback.

1. **The deployed agent runs the evals' winner.** Its environment sets `AGENT_LLM_PROVIDER`,
   `AGENT_LLM_MODEL` and `AGENT_LLM_EFFORT` to `anthropic`, `claude-haiku-5-5` and `medium`, with
   the key from Secret Manager (brief §8), when deployment lands.
2. **The code's fallback stays local.** With nothing set, `loadConfig` keeps `lmstudio` and
   `qwen/qwen3.5-9b`: development, tests and a fresh checkout run free, with no key, and never
   spend by accident. Paid recording still needs `--paid`.
3. **A newer winner moves the deployed setting, not the fallback.** An experiment that beats the
   deployed model over three runs, with ranges that don't overlap, changes the deployed
   environment.

**Rejected:** switching the code's fallback to Haiku. Every checkout would then need an Anthropic
key to start, and anything run without one would spend money.

## Amendment (2026-11-05, #46): the deployed agent calls Claude, not the author's local model

#8 first planned for the deployed agent to reach the author's LM Studio over Tailscale. The
deployment would then cost nothing per review. This amendment supersedes that plan: the
deployed agent calls the deployed model of the amendment of #42, Claude Haiku 5.5 at effort
`medium`, from Cloud Run (ADR 0018).

1. **No tunnel to the author's machine.** The container runs no `tailscaled`, joins no tailnet
   and holds no auth key. The pass doesn't depend on a laptop being on.
2. **The deployed job passes `--paid`.** That is the go-ahead of the amendment of #30, given once
   in the reviewed deploy config. The day's budget (ADR 0017) and the key's cap at the provider
   bound the spend.
3. **Local stays local.** Development, tests and evals keep the local fallback of the amendment of
   #42.

**Rejected:** Tailscale to the author's LM Studio. The agent would be up only while the author's
laptop is on. It would add three moving parts: the daemon in the container, a tailnet ACL and an
ephemeral key. All that to save $0.002 a review. A 9B model on a laptop GPU also loses to Haiku
on the evals (E014).

## Amendment (2026-11-07, #89, #84): which key and endpoint reach which provider

Two leaks crossed the boundary between the paid provider and everything else. The local adapter
got `AGENT_LLM_API_KEY` too, so a `.env` that kept the real key while pointing
`AGENT_LLM_BASE_URL` at a shared server sent it there. And the Anthropic SDK reads its own
environment, which the config didn't model: `ANTHROPIC_BASE_URL` could redirect the key,
`ANTHROPIC_LOG=debug` would print whole requests (review contexts included, against CLAUDE.md §4),
`ANTHROPIC_CUSTOM_HEADERS` adds headers to every request, and the `ANTHROPIC_OPEN_TELEMETRY*`
variables can put request content into the spans of a tracer someone else registered.

1. **One key per kind of provider.** `AGENT_LLM_API_KEY` goes to `anthropic` alone;
   the local providers read `AGENT_LLM_LOCAL_API_KEY`, usually unset. Neither key ever reaches
   the other side.
2. **The config picks the provider's endpoint, key and effort in one place**
   (`chosenProvider` in `src/config/config.ts`). `anthropic` gets `AGENT_LLM_ANTHROPIC_BASE_URL`
   (https only, Anthropic's public endpoint by default), the paid key and an effort; a local
   provider gets `AGENT_LLM_BASE_URL`, the local key and no effort. Every other module reads what
   it picked instead of asking which provider it is; `createConfiguredProvider` only chooses the
   adapter.
3. **The Anthropic client is built with everything the SDK would otherwise read itself:** the
   key, `baseURL`, `logLevel: "off"`, `openTelemetry: false`, and `defaultHeaders` that cancel
   (with `null`) every header `ANTHROPIC_CUSTOM_HEADERS` names. The SDK has no option to stop
   reading that variable, so the adapter reads it only to cancel it. The SDK's profile and
   federation variables (`ANTHROPIC_PROFILE` and the like) are read only when no key is passed,
   so passing the key keeps them unread.
4. **`.env.example` names the SDK variables that are now ignored**, so nobody sets one
   expecting an effect.

**Rejected:**

- **One `AGENT_LLM_API_KEY` for every provider**: the leak in the first place; a local server
  needs no key, and a shared one must never see the paid one.
- **Unset the SDK's variables in the entry scripts**: every new script would have to remember it,
  and a test building the adapter directly wouldn't be covered. The adapter is where the SDK is
  constructed, so that is where its environment is neutralised, and its tests stub each variable.
- **Strip unknown headers in a middleware (an allow-list)**: the SDK's own headers change between
  versions; cancelling exactly what the variable names is narrower.

**Consequences:** the adapter tests stub `ANTHROPIC_BASE_URL`, `ANTHROPIC_LOG` and
`ANTHROPIC_CUSTOM_HEADERS` and check the request goes to the configured URL, logs nothing and
carries none of the named headers. A new SDK release can read a new variable: upgrading the SDK
means checking its `readEnv` calls again. GitHub and Secret Manager are unchanged: the deployed job
runs the paid provider with the same `AGENT_LLM_API_KEY`.
