# anti-fraud-agent

An autonomous AI agent that reviews new events and organizers of a ticketing
platform and leaves a reasoned recommendation (approve, reject or request
info) for a human admin, with graded autonomy, provider-neutral LLM adapters
(Claude, OpenAI, Grok) and offline evals.

Status: bootstrapping. The specification is
[`docs/agent-design-brief.md`](docs/agent-design-brief.md) (in Spanish);
decisions are recorded in [`docs/adr/`](docs/adr/), and the ones worth arguing
about are mapped in [`docs/design-highlights.md`](docs/design-highlights.md).

## Development

Requirements: Node ≥ 22, pnpm, and [gitleaks](https://github.com/gitleaks/gitleaks)
for the pre-commit secret scan.

```sh
pnpm install
cp .env.example .env   # optional: every variable so far has a default

pnpm test        # Vitest, always in UTC
pnpm lint        # ESLint with type-aware rules
pnpm typecheck   # tsc, strict
pnpm format      # Prettier
```

### Offline evals

The brief §5 dataset (31 cases) runs through the real agent. `pnpm eval [case…]`
records the configured model's responses (LM Studio by default, so free);
`pnpm eval:replay` replays them with no model and rewrites
[`evals/report.md`](evals/report.md). CI runs `pnpm eval:replay --check`. See
[ADR 0013](docs/adr/0013-evals-replay-recorded-model-responses.md).

### Run a review locally (no cost)

The agent talks to any OpenAI-compatible server. By default it expects
[LM Studio](https://lmstudio.ai) in server mode on `http://localhost:1234/v1`
with `qwen/qwen3.5-9b` loaded (a tool-calling model that fits 8 GB of VRAM;
give it a context of 16k or more). `AGENT_LLM_*` in `.env.example` points it
elsewhere.

```sh
pnpm review:local            # reviews the fixture event against the Satella mock
pnpm review:local organizer  # reviews the fixture organizer
```

Nothing leaves the machine: Satella is an in-process mock with fictitious
fixtures. See [ADR 0008](docs/adr/0008-provider-neutral-agent-local-model-first.md).
