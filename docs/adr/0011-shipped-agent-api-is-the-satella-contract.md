# ADR 0011 — Satella's shipped agent API v1 is the contract, not the brief

- **Date:** 2026-11-01
- **Status:** accepted · amendment 2026-11-02
- **Related:** brief §3, §9 step 2 and §13; brief D1 (integration by API, future ADR 0001); issues
  #4 and #13; PRs #11 and #12.

## Context

The brief (§3, refined by §13) described Satella's agent API before it existed, and the repo
rules made it the only source of the contract: «Satella is reached only through `/api/agent/v1`
as described in the brief. Do not read, copy or infer anything from Satella's code».

The first `satella-client` (#11) followed §13 to the letter. Satella then shipped the API
(with its own ADR and epic), and the shipped API differs from §13 in names and shapes:

- `POST /reviews` takes `subject: { type, id, version }` and flat `agentRunId`,
  `promptVersion`, `provider` and `model`, not `subjectVersion` and an `agent` object;
  `infoRequest.draft`, not `draftMessageToOrganizer`. Both review endpoints return the whole
  recommendation, not `{ reviewId, status }`.
- The venue has `latitude` and `longitude`, not `lat` and `lng`. Similar events come wrapped
  in `{ items }` with other field names, and benchmark percentiles end in `Cents`.
- The feed carries fields §13 doesn't mention: `changes` (before and after of an edit) and
  `reviewId`.

§13 also left eight questions open (#4): the shape of the organizer's `history`, the
`GET /reviews/{id}` response and the error body, among others. The client built from §13
would have rejected every real response as a contract violation.

## Decision

1. **The source of truth for the Satella contract is the agent API v1 as Satella shipped it.**
   This repo models it in `src/satella-client/schemas.ts`, the single source for the client,
   the mock server and the fixtures. Brief §3 and §13 remain the design history: they explain
   why the API exists and what it is for, but where they differ from the shipped API, the
   shipped API wins. The brief is not edited.
2. **The contract is learned in two ways, both read-only.** One is reading Satella's `main`,
   limited to its agent API surface: the routes under `/api/agent/v1`, the services and
   validations behind them, and Satella's ADR for that API. The other is asking Satella's maintainers.
   Nothing else in Satella's code is read, and nothing about its internals is inferred into
   this repo.
3. **No Satella code is copied here.** Only the contract: field names, types, limits, status
   codes and documented behaviours, rewritten as this repo's own Zod schemas. Fixtures stay
   fictitious. The repo stays free of hosts, internal URLs and credentials (CLAUDE.md §1).
4. **The mock server reproduces the shipped behaviours the agent relies on**, each pinned by a
   contract test. Examples: credential, then scope, then rate limit (401 → 403 → 429); a new
   recommendation supersedes the subject's `pending_admin` and `auto_resolved` ones; the
   idempotency match comes before the version check.
5. **Gaps and mismatches go to Satella, never around it.** When the shipped API misses
   something the agent needs, or disagrees with the brief's intent, it is raised with Satella
   (through the user) and documented in `schemas.ts` until fixed. A workaround in the agent
   needs its own decision. Open at the time of writing:
   - Session date changes (postponements) don't reach the feed. The event context `version`
     changes, but nothing prompts a re-read.
   - `maxCents` is sent even with fewer than 5 prices; it carries no weight when `p50Cents` is
     null.

## Alternatives rejected

- **Keep brief §13 as the contract and ask Satella to change its API to match.** The brief was
  a proposal written before the code. Satella's triage refined it with reasons (PII,
  idempotency, what the admin sees), and reverting working code to match a draft would move
  the cost to the wrong side.
- **Generate the client from Satella's TypeScript types, or share a package.** Satella's repo
  is private and this one is public-bound. Sharing types couples the two builds and leaks
  internals. There is no published OpenAPI document to generate from.
- **Copy Satella's Zod schemas.** Fastest, but it puts Satella code into a public repo, and the
  agent would validate with Satella's rules instead of stating its own expectations.
- **Keep «never read Satella's code» and learn the contract only by asking.** Slow, and it has
  already fallen short once: eight questions in #4 stayed open until the shipped API answered
  them.

## Consequences

- `CLAUDE.md` §2 and §4, `docs/agents/domain.md`, `docs/agents/triage-labels.md` and the
  `write-tests` skill point to the shipped API and this ADR.
- A change in Satella's API needs a matching change in `schemas.ts` and its contract tests.
  Until the agent runs against staging (#9), nothing detects drift automatically. A contract
  smoke test against staging belongs in that issue.
- The brief's §10 doubts about Satella still go to the user. Reading Satella's code doesn't
  settle a doubt about intent, only about what was built.

## Amendment (2026-11-02): both gaps closed, and the feed tolerates new types

Satella closed the two gaps listed in point 5. One change puts session date and time changes in the
feed as `event.substantial_change` and `event.minor_change`, with a `kind` (`postponement`,
`start_time` or `minor`). The other sends `maxCents` as `null` below 5 prices, like the
percentiles.

The first of those changes would have stopped the agent cold. The client validated feed item
types against a closed list, so the first new item turned the whole page into a contract
violation. Satella may add feed types within v1, so the client now skips items of a type it
doesn't know yet and reports them in `skippedTypes`. The cursor still moves past them. Items
of known types are still validated strictly: a known type that breaks its shape is still a
contract violation.
