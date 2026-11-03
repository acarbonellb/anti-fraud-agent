# Architecture Decision Records

One file per decision: `NNNN-short-title.md`, numbered in order, never renumbered. How to write
one: `.claude/skills/adr/SKILL.md`.

| #                                                                 | Decision                                                                                                         | Status                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [0008](0008-provider-neutral-agent-local-model-first.md)          | Provider-neutral agent: two adapters cover four providers, shipped local-model first                             | accepted                      |
| [0011](0011-shipped-agent-api-is-the-satella-contract.md)         | Satella's shipped agent API v1 is the contract, not the brief; read-only look at its API surface, no code copied | accepted · amended 2026-11-02 |
| [0012](0012-autonomy-rests-on-deterministic-checks.md)            | Autonomy rests on deterministic checks (rule vs heuristic); mechanical requests resolve on their own             | accepted · amended 2026-11-03 |
| [0013](0013-evals-replay-recorded-model-responses.md)             | Offline evals replay recorded model responses in CI; the gate is fraud that skips the admin                      | accepted · amended 2026-11-03 |
| [0014](0014-eval-metrics-history-and-experiment-log.md)           | Eval metrics live in a machine-written history, explained in an experiment log; CI enforces both                 | accepted                      |
| [0015](0015-external-evidence-venue-checks-and-sourced-search.md) | Venue checks run in code and can be required for auto-approval; sourced web search can only hold back            | accepted · amended 2026-11-03 |

The design brief's decisions D1–D10 (`docs/agent-design-brief.md` §12) are the starting set: they
become ADRs 0001–0010 as each one is implemented.
