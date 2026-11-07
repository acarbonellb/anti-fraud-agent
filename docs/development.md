# Development

How to install, test, run and record the agent. What it is and how it decides is in the
[README](../README.md); the code layout is in [`architecture.md`](architecture.md).

## Setup

Requirements: Node ≥ 22, pnpm, and [gitleaks](https://github.com/gitleaks/gitleaks) for the
pre-commit secret scan.

```sh
pnpm install
cp .env.example .env   # optional: every variable has a default or is optional

pnpm test        # Vitest, always in UTC
pnpm lint        # ESLint with type-aware rules
pnpm typecheck   # tsc, strict
pnpm format      # Prettier
```

## Offline evals, with no keys and no cost

`pnpm eval:replay` replays the recorded model and tool responses of every eval case through the
real agent. It rewrites `evals/report.md`, the charts in `evals/charts/` and the summary block of
the README, all from the recordings and `evals/history.jsonl`. CI runs `pnpm eval:replay --check`,
which fails on a stale recording, on any gated fraud case approved without reaching the admin,
on metrics the history doesn't hold, and on a report, chart or summary that differs from the
replayed one ([ADR 0013](adr/0013-evals-replay-recorded-model-responses.md),
[ADR 0014](adr/0014-eval-metrics-history-and-experiment-log.md)).

`pnpm eval [case…]` records new responses with the configured model. When the metrics move, both
commands need `--note "<what changed>"` and append a history entry; its section in
`docs/experiments.md` is written by hand.

## A review or a pass on your machine

By default the agent talks to [LM Studio](https://lmstudio.ai) in server mode on
`http://localhost:1234/v1` with `qwen/qwen3.5-9b` loaded (a tool-calling model that fits 8 GB of
VRAM; give it a context of 16k or more). `AGENT_LLM_*` in `.env.example` points it elsewhere.

```sh
pnpm review:local            # one review of the fixture event against the Satella mock
pnpm review:local organizer  # the fixture organizer
pnpm pass --mock             # a whole pass over the mock's fictitious feed, with an in-memory store
```

Satella is an in-process mock with fictitious fixtures, and the model runs locally. The venue
checks still call OpenStreetMap and Wikidata (free, keyless), and web search calls Tavily when
`TAVILY_API_KEY` is set.

## Providers

| `AGENT_LLM_PROVIDER` | What it is                       | Cost                            |
| -------------------- | -------------------------------- | ------------------------------- |
| `lmstudio` (default) | Any model LM Studio serves       | Free                            |
| `ollama`             | Any model Ollama serves          | Free                            |
| `anthropic`          | Claude, through the official SDK | Paid: the scripts need `--paid` |

Any other value fails at startup ([ADR 0008](adr/0008-provider-neutral-agent-local-model-first.md)).
