# anti-fraud-agent

An autonomous AI agent that reviews new events and organizers of a ticketing
platform and leaves a reasoned recommendation (approve, reject or request
info) for a human admin, with graded autonomy, provider-neutral LLM adapters
(Claude, OpenAI, Grok) and offline evals.

Status: bootstrapping. The specification is
[`docs/agent-design-brief.md`](docs/agent-design-brief.md) (in Spanish);
decisions are recorded in [`docs/adr/`](docs/adr/).

## Development

Requirements: Node ≥ 22, pnpm, and [gitleaks](https://github.com/gitleaks/gitleaks)
for the pre-commit secret scan.

```sh
pnpm install
```
