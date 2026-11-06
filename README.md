# anti-fraud-agent

An autonomous AI agent that reviews new events and organizers on Satella, a Spanish ticketing
platform, and leaves a reasoned recommendation (`approve`, `reject` or `request_info`) for a human
admin. It runs against Satella's staging environment, on synthetic data, and never changes an
event's state itself.

**Graded autonomy.** The model proposes a decision; code decides how much to trust it. A
recommendation resolves on its own only when deterministic checks back it, and anything else is
escalated to the admin. In Satella, only an auto-resolved approval skips the admin, and on the
recorded evals none of those is fraud ([ADR 0012](docs/adr/0012-autonomy-rests-on-deterministic-checks.md)).

**Status:** deployed. A Cloud Run Job reviews Satella staging's feed every 10 minutes with Claude
Haiku 5.5, within a daily budget. What it doesn't do well yet is in
[`docs/known-limitations.md`](docs/known-limitations.md).

## Where to start reading

- [`docs/design-highlights.md`](docs/design-highlights.md): the decisions worth arguing about,
  each with its reason and evidence. It is the English entry point.
- [`docs/adr/`](docs/adr/): the architecture decisions, each with the alternatives rejected.
- [`evals/report.md`](evals/report.md): accuracy, approved-fraud rate, escalation, cost and latency
  per model, generated from recordings.
- [`evals/history.jsonl`](evals/history.jsonl) and [`docs/experiments.md`](docs/experiments.md):
  how the metrics moved over time, and why ([ADR 0014](docs/adr/0014-eval-metrics-history-and-experiment-log.md)).
- [`docs/agent-design-brief.md`](docs/agent-design-brief.md): the original specification, in
  Spanish.

## How a review works

```
Satella feed ─▶ pass ─▶ reviewSubject ─▶ checks in code ─▶ model loop ─▶ policy ─▶ Satella + store
                 │                       (rules, venue,     (tools,        (autonomy)  (recommendation,
          cursor, budget,                 copied text)       limits)                    run document)
          retries
```

1. **The pass** (`pnpm pass`) reads a page of Satella's feed from a stored cursor and reviews each
   changed subject once. It reserves each run's worst-case cost against the day's budget, and
   tries a review that failed transiently again on a later pass ([ADR 0017](docs/adr/0017-scheduled-pass-reviews-feed-within-day-budget.md)).
2. **Checks in code** run before the model on the review context: rule checks (postal code and
   province, overlapping sessions, off-platform payment…), venue checks against OpenStreetMap and
   Wikidata, and one web search for a copied description ([ADR 0015](docs/adr/0015-external-evidence-venue-checks-and-sourced-search.md)).
3. **The model loop** sees the context and those findings as untrusted data, calls tools (the
   organizer's context, similar events, the price benchmark, web search) within run limits, and submits a recommendation.
4. **The policy** computes autonomy from the findings, never from the model's own claim.
5. **Satella** receives the recommendation with an idempotency key, and **the store** (Firestore)
   keeps the run: findings, trace, tokens and cost ([ADR 0016](docs/adr/0016-agent-store-on-firestore-over-rest.md)).

| Directory             | What it holds                                                              |
| --------------------- | -------------------------------------------------------------------------- |
| `src/pass/`           | The scheduled pass, its retry queue and its log lines                      |
| `src/agent/`          | `reviewSubject`, the model loop, the autonomy policy, the prompt and tools |
| `src/checks/`         | Deterministic checks and the check vocabulary                              |
| `src/venue/`          | Venue existence and capacity, from OpenStreetMap (Nominatim) and Wikidata  |
| `src/search/`         | Web search (Tavily) and authored pages for fictitious eval entities        |
| `src/providers/`      | One provider-neutral interface; Claude and OpenAI-compatible adapters      |
| `src/satella-client/` | Satella's agent API: client, Zod schemas, identity token and a mock server |
| `src/store/`          | The agent's store: Firestore over REST and an in-memory twin               |
| `src/evals/`          | The eval runner, recording and replay, metrics and the CI gate             |
| `src/config/`         | Environment variables, read once and validated with Zod                    |
| `src/test-support/`   | Test doubles, kept out of the deployed image                               |

## Run it

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

### Offline evals, with no keys and no cost

`pnpm eval:replay` replays the recorded model and tool responses of 31 cases (fraud patterns and
legitimate events; the organizers, promoters and artists in fraud cases are invented) and rewrites `evals/report.md`. CI runs
`pnpm eval:replay --check`, which fails on a stale recording or on any gated fraud case approved
without reaching the admin ([ADR 0013](docs/adr/0013-evals-replay-recorded-model-responses.md)).

`pnpm eval [case…]` records new responses with the configured model.

### A review or a pass on your machine

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

### Providers

| `AGENT_LLM_PROVIDER` | What it is                       | Cost                            |
| -------------------- | -------------------------------- | ------------------------------- |
| `lmstudio` (default) | Any model LM Studio serves       | Free                            |
| `ollama`             | Any model Ollama serves          | Free                            |
| `anthropic`          | Claude, through the official SDK | Paid: the scripts need `--paid` |

Any other value fails at startup ([ADR 0008](docs/adr/0008-provider-neutral-agent-local-model-first.md)).

## Deployment

The pass runs as a Cloud Run Job, started every 10 minutes by Cloud Scheduler. CI deploys it from
`main` with Workload Identity Federation, so no service-account key exists. The job reaches Satella
with its Google identity token, keeps runs in Firestore, and reads its API keys and Satella's
address from Secret Manager ([ADR 0018](docs/adr/0018-pass-runs-as-cloud-run-job-deployed-keyless.md)). Spend is
capped twice: by the daily budget in code and by the provider key's own limit.

## Data attribution

Venue data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available
under the Open Database License (ODbL 1.0), through Nominatim. Recorded venue lookups under
`evals/tool-responses/` carry that data. Wikidata content is CC0.
