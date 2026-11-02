---
name: write-tests
description: Tests and evals of anti-fraud-agent. Load before writing or changing a test, a fixture, a recorded external response or an eval case; before picking a test layer; or when a suite fails for environment reasons (network, time zone, clock).
---

# Writing and running tests

Four layers with different tools and traps. The choice rule beats habit: anything that talks to
Satella is tested against the **mock server built from the contract**, not with hand-written
stubs; anything that depends on an LLM is an **eval**, not a unit test.

## 0. Which layer

| Change                                                                                                                               | Layer                                         | Where                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| Pure function: deterministic check (postal code ↔ province, text risk signals, pricing sanity), autonomy policy, cost maths, mapping | **Unit** (Vitest, `pnpm test`)                | next to the code: `src/**/x.test.ts`               |
| Satella client: requests, auth header, `Idempotency-Key`, cursor handling, `409 STALE_SUBJECT`, `429 Retry-After`                    | **Contract** (Vitest against the mock server) | `src/satella-client/**/*.test.ts`                  |
| Provider adapter: tool schema translation, tool-call parsing, token/cost accounting                                                  | **Unit with recorded provider responses**     | `src/providers/<provider>/*.test.ts`               |
| Agent behaviour on a subject: decision, autonomy, findings, injection resistance                                                     | **Eval** (`pnpm eval`)                        | `evals/cases/<case>.ts` + `evals/fixtures/<case>/` |

A unit test never calls a real LLM or the network. An eval never calls the network either: it
calls an LLM only when run on purpose with a provider key, and replays every tool response from
fixtures.

## 1. Common rules

- **Name by behaviour**, not by issue: `rejects-off-platform-payment.test.ts`, not `issue-14.test.ts`.
- **Header comment** saying what it checks and what it fakes.
- **Injected clock.** Behaviour that depends on "now" (imminent session, session in 3 years,
  token expiry, quotas) takes a clock; fixtures are built relative to it, never from a fixed date.
- **`TZ=UTC`** for every run: catches local-time formatting. Presentation in `Europe/Madrid` is
  tested explicitly.
- **Money in cents** in fixtures too: `priceCents: 1500`, never `15`.

## 2. Contract tests

- Fixtures and the mock server are validated with the **same Zod schemas** as the client. A
  fixture that doesn't parse is a failing test, not a warning.
- Cover the documented errors: 400 (bad cursor, limits), 401, 403, 404, 409 `STALE_SUBJECT`,
  429 with `Retry-After`; and `200` vs `201` on `POST /reviews`.
- The source of truth is Satella's shipped agent API v1, modelled in `schemas.ts` (ADR 0011);
  the brief (§13 over §3) is its history. A behaviour neither the shipped API nor the brief
  states is not invented in the mock: ask the user.

## 3. Evals

- **One case per file**, with its expected `decision` and `autonomy` from brief §5 and the
  fixtures it needs (review context, similar events, benchmark, recorded web responses).
- **Fictitious entities in problem cases.** No organizer, promoter or artist in a problem case may
  resemble a real one; real venues only for existence and capacity. Review every new fixture for
  this before committing.
- **No answer leaks**: no `[EVAL]`, case number or expected decision inside the subject's fields.
- Metrics (brief §4.3): accuracy, **approved-fraud rate** (the critical one), escalation rate,
  confidence calibration, cost and latency per review, rationale quality.
- Recording new external responses is a deliberate step that hits the network and may cost money:
  confirm with the user first, then commit the recording with its source URLs.
- **Two modes.** `pnpm eval [case…]` runs the real agent with the configured model (LM Studio by
  default: free; a paid provider needs the user's go-ahead), records every model response under
  `evals/recordings/<provider>/<model>/` and rewrites `evals/report.md`. `pnpm eval:replay --check`
  (CI) replays them with no model: it fails on a stale or missing recording, on any gated fraud case
  approved as `auto_resolved` (the only outcome that skips the admin), or on a report that changed.
- **A changed request makes recordings stale.** A change to the prompt, a tool, a check's wording or
  a fixture changes what the model is sent, so the old answer no longer applies. Re-record the
  affected cases locally and commit recordings and report in the same PR: the report diff is the
  behaviour change. Keep requests reproducible: dates from the injected clock, ids and the fence
  nonce from the case id, never `Math.random`, `Date.now` or this machine's env.
- **History and experiment log** (ADR 0014). When a change moves the metrics (re-recordings, the
  prompt, a check, a policy threshold), `pnpm eval` or `pnpm eval:replay` requires
  `--note "<what changed>"` and appends one entry per moved set to `evals/history.jsonl`. Write
  the matching `## E00N — title` section in `docs/experiments.md` (hypothesis, change, before →
  after, what went wrong, decision) and commit both with the report. `--check` fails on a set
  whose metrics differ from its latest entry and on an entry without a section. Never edit or
  delete an entry: append a newer one that corrects it.
- Cases that need the external tools carry `requires: ["external"]`: they run and record, but stay
  out of the gated metrics.

## Done when

The test is in the right layer, named by behaviour, with a header; passes with `pnpm test` (or
`pnpm eval` for a case) under `TZ=UTC`; makes no network call; and eval fixtures are fictitious
where they have to be.
