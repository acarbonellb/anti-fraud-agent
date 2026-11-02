# Design highlights

The decisions in this repo worth arguing about, each with its reason and its evidence. Detail
lives in the ADRs; this page is the map. Add a line when a decision earns one.

## The model proposes; code decides how far to trust it

- **Deterministic checks run in code, before the model, and win over it.**
  - _Why:_ a local model called a 10 % fee «about 1 %», and it recorded a `pass` for checks
    nothing had run.
  - _Evidence:_ in case 03 the model approved an event whose postal code belongs to another
    province. The rule finding escalated it anyway.
  - [ADR 0012](adr/0012-autonomy-rests-on-deterministic-checks.md)
- **Autonomy is computed by a pure policy, never claimed by the model.**
  - _Why:_ a model `pass` counts for nothing. Only rule findings let a request resolve on its
    own, and only a sourced hard signal lets a rejection resolve on its own.
  - _Evidence:_ the model approved 7 of 18 gated fraud cases, and the policy sent all 7 to the
    admin.
  - [ADR 0012](adr/0012-autonomy-rests-on-deterministic-checks.md)
- **Organizer text is data, never instructions.**
  - _Why:_ texts travel inside fences with a per-run nonce the organizer can't guess, and wording
    that tries to instruct the reviewer is itself a finding.
  - _Evidence:_ eval case 25 (injection in the description and the terms) ended `request_info`,
    escalated.

## Measure before choosing

- **Local open-source model first, at zero cost; one interface, two adapters for four providers.**
  - _Why:_ every real run on a paid API costs money. OpenAI, Grok and local servers share one
    wire format, so they share one adapter.
  - [ADR 0008](adr/0008-provider-neutral-agent-local-model-first.md)
- **The evals, not preference, choose the default model.**
  - _Why:_ a candidate (another LLM, or a classifier such as a «System One» model) is added as a
    recording set, measured on the same 31 cases, and compared in one report. Vendor benchmarks
    don't enter the decision.
  - [ADR 0008](adr/0008-provider-neutral-agent-local-model-first.md),
    [ADR 0013](adr/0013-evals-replay-recorded-model-responses.md)
- **Record live, replay in CI.**
  - _Why:_ CI replays the recorded model responses through the real agent in seconds, with no
    model, network or cost.
  - _Evidence:_ editing three fixtures marked exactly those three cases stale, because each
    response is valid only for the hash of the request it answered.
  - [ADR 0013](adr/0013-evals-replay-recorded-model-responses.md)
- **Gate on the risk that matters.**
  - _Why:_ CI fails on fraud that ends `approve` + `auto_resolved`, the only outcome that skips
    the admin, not on every approval the model gets wrong. The approved-fraud rate (38.9 % for
    the local model) stays in the report as model quality.
  - [ADR 0013](adr/0013-evals-replay-recorded-model-responses.md)
- **Keep the cases you can't pass yet.**
  - _Why:_ the 9 cases that need external tools are recorded but not gated.
  - _Evidence:_ their 26.9 % auto-approved fraud is the baseline that will show whether #7 works,
    and the argument for building it next.

## Integrate by contract

- **The agent reaches the platform only through its versioned agent API, and never changes
  state.**
  - _Why:_ it reads review contexts and writes recommendations. Idempotency keys make retries
    safe, and `409 STALE_SUBJECT` means re-review, not retry.
  - [ADR 0011](adr/0011-shipped-agent-api-is-the-satella-contract.md)
- **The shipped API is the contract, not the design document.**
  - _Why:_ when they differ, the code models what was shipped, and the brief keeps the history.
  - [ADR 0011](adr/0011-shipped-agent-api-is-the-satella-contract.md)
