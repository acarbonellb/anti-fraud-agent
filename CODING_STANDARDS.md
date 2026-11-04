# CODING_STANDARDS.md

Standards checked in code review, on top of the mandatory patterns in `CLAUDE.md` §4–§5. What a
linter can check lives in the ESLint config; this file holds what needs judgement.

## Agent safety

- **Untrusted text never steers control flow.** Organizer fields, image text and web results are
  passed to the model inside an explicit untrusted-data wrapper, never concatenated into the
  system prompt. Organizer text never acts as an instruction to the code or the model. Scanning it
  for risk signals (`src/checks/`) is analysis: it can only add negative findings, never approve.
  Rule patterns stay narrow (negations included), because a false rule finding can let a request
  or a rejection resolve on its own (brief D9, ADR 0012).
- **No destructive tools.** The agent can read and recommend; adding a tool that changes state in
  Satella or elsewhere needs an ADR first (brief D3).
- **Autonomy is computed, not asked.** `auto_resolved` vs `escalated` comes from the policy
  (brief §4.2 refined by ADR 0012) applied to the findings, not from the model's own claim. The
  model proposes; the policy decides how much to trust it.
- **Evidence over claims.** Anything a rule can compute is a deterministic check in `src/checks/`,
  run in code before the model, never left to the model. A model `pass` is not evidence. A new
  deterministic check declares whether it is a `rule` or a `heuristic`. When in doubt it is a
  heuristic: a false rule lets a request resolve on its own.
- **Limits are enforced by the loop**, not by the prompt: a run that reaches a limit escalates
  with the reason recorded. The search budget is the soft one: a search past it is refused, the
  model still decides, and only an approval escalates (ADR 0015).

## Contract and data

- **One source for the contract.** The Satella DTOs are Zod schemas in one module; types derive
  from them (`z.infer`). Fixtures and the mock server are validated against the same schemas.
- **The same calculation that decides, reports.** A number shown in a finding or in the dashboard
  (capacity ratio, price percentile, cost) comes from the same function the policy used.
- **Idempotent writes.** A retry with the same `Idempotency-Key` must be safe; a stale subject
  re-reviews instead of retrying.

## Money and cost

- Prices in integer cents; LLM and tool cost in integer micros (`AGENT_DAILY_BUDGET_MICROS`). No
  floats for money, ever: compute ratios at the edge for display only.

## Tests

- **Behaviour through the public interface**, not through the shape of internal calls.
- **Time-relative fixtures**: if behaviour depends on "now" (imminent session, session in 3 years),
  build the fixture from an injected clock, never from a fixed date that will drift into the past.
- **Evals are reproducible**: an eval run never hits the network; external responses are recorded
  fixtures. A new eval case states its expected decision and autonomy (brief §5).
