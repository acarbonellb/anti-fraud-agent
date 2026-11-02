# Architecture Decision Records

One file per decision: `NNNN-short-title.md`, numbered in order, never renumbered. How to write
one: `.claude/skills/adr/SKILL.md`.

| #                                                         | Decision                                                                                                         | Status                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [0008](0008-provider-neutral-agent-local-model-first.md)  | Provider-neutral agent: two adapters cover four providers, shipped local-model first                             | accepted                      |
| [0011](0011-shipped-agent-api-is-the-satella-contract.md) | Satella's shipped agent API v1 is the contract, not the brief; read-only look at its API surface, no code copied | accepted · amended 2026-11-02 |
| [0012](0012-autonomy-rests-on-deterministic-checks.md)    | Autonomy rests on deterministic checks (rule vs heuristic); mechanical requests resolve on their own             | accepted                      |

The design brief's decisions D1–D10 (`docs/agent-design-brief.md` §12) are the starting set: they
become ADRs 0001–0010 as each one is implemented.
