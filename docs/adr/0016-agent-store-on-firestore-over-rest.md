# ADR 0016 — The agent's store is Firestore over its REST API, behind one interface with an in-memory twin

- **Date:** 2026-11-05
- **Status:** accepted
- **Related:** brief §2 («Reparto de responsabilidades»), §6.1, §6.3 and §8, which it replaces
  where they say Postgres; CLAUDE.md §3–§5; ADR 0015 (the venue providers' `fetch` seam); issues
  #8 and #44.

## Context

The agent needs its own data, apart from Satella's: each run with its trace, tokens and cost;
the feed cursor, so a pass resumes where the last one stopped; and the day's spend, so on-demand
runs stop at `AGENT_DAILY_BUDGET_MICROS` (brief §6.3.3). The brief (§8) and CLAUDE.md §3 planned
Postgres, on Cloud SQL or Neon.

The data turned out simpler than that plan assumed:

- A run is one document, written once and never edited. Nothing joins it to anything.
- The cursor is one value, and the spend is one small document per day.
- The dashboard (§6.1) lists runs newest first and opens one.
- Staging volume is a few runs an hour at most.

Costs, checked 2026-11-05:

- **Firestore** (Standard edition, the `(default)` database) is free up to 50,000 reads, 20,000
  writes a day and 1 GiB. Cloud Run reaches it with its service account (IAM), so there is no
  password to keep. It lives in the same project as Firebase Hosting.
- **Cloud SQL**, the smallest instance, costs about $9–10 a month idle.
- **Neon** is free, but needs a connection-string secret, and the dashboard's access becomes a
  separate problem.
- **Firebase SQL Connect** is Cloud SQL after a 90-day trial.

## Decision

1. **Firestore, not Postgres.** The `(default)` database in Standard edition. Collections:
   `runs/{runId}`, `agentState/feedCursor` and `spend/{YYYY-MM-DD}`.
2. **Over Firestore's REST API with `fetch`, not the SDK.**
   - It is tested like the venue providers (ADR 0015), with a fake `fetch` that answers as the
     REST API does. No gRPC dependency.
   - In Cloud Run the token comes from the metadata server. It is cached until a minute before it
     expires.
   - Local runs and tests use the in-memory store, or the emulator (`FIRESTORE_EMULATOR_HOST`),
     which takes no token. Application default credentials are never read: a developer's own
     Google login never reaches the store.
   - Every update carries a precondition: `currentDocument.exists=false`, or the `updateTime` it
     read. That is the compare-and-set below, with no transaction API.
   - Errors are typed (`StoreError`): `STORE_CONFLICT` (409, 412, and `400 FAILED_PRECONDITION`),
     `STORE_FORBIDDEN` (401, 403), `STORE_UNAVAILABLE` (network failure, 429, 503),
     `STORE_HTTP_ERROR` and `STORE_BAD_RESPONSE`. No error carries a response body, which can
     quote a document.
3. **A run document keeps the summary trace, never tool responses.**
   - The trace is the loop's `TraceEntry` as it is: `{ tool, ok, error? }`.
   - Findings with their sources, the rationale and the info request are stored whole, because
     they are what the dashboard shows (§6.1).
   - Of Satella's review, only its id, whether it was created and the attempts are kept.
     Nothing else from Satella's responses is stored (CLAUDE.md §4, minimal logs). This also
     keeps documents far below Firestore's 1 MiB limit.
   - Dates are UTC ISO strings, so they sort as they read. Money is integer micro-dollars, and
     an unknown cost stays `null`, never `0`.
   - Every field is picked by name when the run is mapped, so whatever a result carries beyond
     them stays out of the store.
4. **Runs are kept, with no TTL.** Staging volume is small, and the history is what the
   dashboard shows. Saving a `runId` twice is a conflict: runs are appended, never edited.
5. **The feed cursor advances only from the value read.** `advanceFeedCursor(from, to)` refuses
   with a conflict when the cursor no longer holds `from`. Two overlapping passes can't both
   advance it, so one of them re-reads instead of skipping or replaying the feed.
6. **The day's spend is reserved, then settled.**
   - Before a run, a hold of its worst-case cost is reserved against the day's budget. The
     reservation is refused when the day's settled cost plus its open holds plus this hold would
     pass the budget.
   - After the run, the hold is replaced by the actual cost.
   - Holds expire after 15 minutes, so a crashed run can't keep budget forever.
   - The day is the UTC day (CLAUDE.md §5). A hold settles against the day it was reserved on,
     even after midnight.
   - The day's document holds one entry per run. Settling overwrites that entry, so a retried
     settle can't count twice, and settling an expired hold still records what was spent.
   - A reservation or settlement that loses a race (a precondition conflict) re-reads and tries
     again, up to three times.
   - The pattern is acb-landing's monthly spend cap, which works in production.
7. **One interface, two implementations, one contract suite.** `AgentStore` has an in-memory
   implementation and a Firestore one. The same suite runs against both: the in-memory store
   keeps the Firestore store's promises, conflicts included.

## Alternatives rejected

- **Cloud SQL for PostgreSQL** (the brief's first option): about $9–10 a month idle, for data
  with no joins.
- **Neon**: free, but a connection-string secret to keep and rotate, and the dashboard's access
  becomes a separate problem.
- **Firebase SQL Connect**: it is Cloud SQL once its 90-day trial ends.
- **The Firestore SDK** (`@google-cloud/firestore`): it pulls gRPC, and it would be tested by
  mocking the SDK instead of against the wire format. The REST surface needed is four calls.
- **Application default credentials locally**: a developer's own login would write to the real
  database from a laptop. The emulator covers local runs instead.
- **A spend counter instead of entries per run**: a retried settle would count twice, and an
  expired hold couldn't be told from a settled cost.
- **A TTL on runs**: it would delete the history the dashboard exists to show, to save storage
  the free tier doesn't run out of.

## Consequences

- `src/store/`: `AgentStore`, `createMemoryStore`, `createFirestoreStore`, `toRunDocument` and
  the contract suite. The loop now sums the provider's prompt-cache tokens, so a run records
  them.
- Not verified against real Firestore yet: that a stale `updateTime` comes back as
  `400 FAILED_PRECONDITION`. The store treats 409, 412 and that 400 as a conflict. The first
  emulator run checks it.
- Brief §8 and CLAUDE.md §3 say Firestore. Postgres stays in the brief only where it is
  Satella's database.
- Left to the next issues: the pass that uses the store, with its configuration
  (`AGENT_DAILY_BUDGET_MICROS`, the project and the emulator host); the GCP resources; the
  dashboard; and the demo-account quotas (§6.3.2), which will need their own counting.
