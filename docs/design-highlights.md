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
- **External evidence must not vouch for what it doesn't check.**
  - _Why:_ a verified venue is evidence about the venue, nothing else. The model read it as
    evidence about the whole event.
  - _Evidence:_ once the venue checks verified the room (E002), the model approved case 13 (a
    950 € ticket in a 300-person room) at 0.95 instead of doubting it at 0.65. The approval
    resolved on its own and CI went red. A deterministic price check against Satella's benchmark
    (E003) brought the gate back to 0. The model still approves 13, and the policy no longer
    lets it through.
  - [ADR 0015](adr/0015-external-evidence-venue-checks-and-sourced-search.md),
    [ADR 0012](adr/0012-autonomy-rests-on-deterministic-checks.md) (amendment),
    `docs/experiments.md` E002–E003
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
- **Every metric change leaves a line and a reason.**
  - _Why:_ a machine-written history holds the numbers, a written experiment log holds the
    hypothesis and the decision, and CI fails until both match the replayed metrics. Failures
    stay in the log as honestly as wins.
  - _Evidence:_ E001, the baseline: a lenient model whose 7 gated approvals of fraud the policy
    all escalated.
  - [ADR 0014](adr/0014-eval-metrics-history-and-experiment-log.md)
- **Keep the cases you can't pass yet.**
  - _Why:_ the 9 cases that need external tools are recorded but not gated.
  - _Evidence:_ their 26.9 % auto-approved fraud is the baseline that will show whether #7 works,
    and the argument for building it next.
- **Cut the tools to the measured risk.**
  - _Why:_ two external tools instead of seven. Venue checks run in code and can be required for
    an auto-approval. A sourced web search can only hold back, never let through. Two free
    providers, one key, no card.
  - _Evidence:_ every auto-approved fraud in the baseline was an external case; capacity data
    covers 0.6 % of Spanish venues in OSM, hence the exposure cap.
  - [ADR 0015](adr/0015-external-evidence-venue-checks-and-sourced-search.md)

## Integrate by contract

- **The agent reaches the platform only through its versioned agent API, and never changes
  state.**
  - _Why:_ it reads review contexts and writes recommendations. Idempotency keys make retries
    safe, and `409 STALE_SUBJECT` means re-review, not retry.
  - [ADR 0011](adr/0011-shipped-agent-api-is-the-satella-contract.md)
- **The shipped API is the contract, not the design document.**
  - _Why:_ when they differ, the code models what was shipped, and the brief keeps the history.
  - [ADR 0011](adr/0011-shipped-agent-api-is-the-satella-contract.md)

## Run on what the data needs

- **The agent's store is Firestore over REST, with an in-memory twin and one contract suite for
  both.**
  - _Why:_ the data is one append-only document per run, one cursor and one document per day,
    with no joins. Firestore's free tier covers it, Cloud Run reaches it with its service
    account, and there is no password to keep. Plain `fetch` keeps it testable against the
    wire format, with no gRPC.
  - _Evidence:_ Cloud SQL would cost about $9–10 a month idle for the same data. The same 21
    contract tests pass against both stores.
  - [ADR 0016](adr/0016-agent-store-on-firestore-over-rest.md)
- **Spend is reserved before a run and settled after, and a reservation expires.**
  - _Why:_ two concurrent on-demand runs can't both fit under the day's budget, and a crashed
    run releases its hold after 15 minutes. One entry per run makes a retried settle count once.
  - _Evidence:_ tests cover a reservation past the budget, a race lost and retried, an
    expired hold, and a hold settled after midnight.
  - [ADR 0016](adr/0016-agent-store-on-firestore-over-rest.md)
- **The scheduled pass stops at the day's budget, and asks the feed only for what it can afford.**
  - _Why:_ the feed's cursor is per page, so a pass that stopped mid-page would either re-review
    or never move. Sizing the page to the budget at worst case means a stop never skips an item.
    It departs from the brief on purpose: on a demo key, a feed burst shouldn't spend the
    provider's cap in one day.
  - _Evidence:_ a test runs the pass with room for one run: it reviews one subject, stops on the
    next pass without reading the feed, and picks up the other item the next UTC day.
  - [ADR 0017](adr/0017-scheduled-pass-reviews-feed-within-day-budget.md)
- **A failed review is a stored run, not a stuck feed.**
  - _Why:_ retrying the page re-spends on every subject already reviewed, and one subject that
    always fails would stall the rest. The failed run keeps its stable code and what it spent.
  - [ADR 0017](adr/0017-scheduled-pass-reviews-feed-within-day-budget.md)
