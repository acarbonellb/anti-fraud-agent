# ADR 0017 — The scheduled pass reviews each changed subject once, never holds the feed for a failure, and stops at the day's budget

- **Date:** 2026-11-05
- **Status:** accepted
- **Related:** brief §2.1, §4.2, §4.3 and §6.3.3, which it departs from (point 5); ADR 0016
  (the store it writes, amended for failed runs and resolutions); ADR 0011 (the feed's contract);
  issues #8 and #45.

## Context

The deployed agent's job is a pass every 10 minutes (#46): read Satella's feed from the stored
cursor, review what changed, store each run and advance the cursor. The store (ADR 0016) and
`reviewSubject` already existed. What was missing were the rules between them:

- The feed has 11 item types. Some carry a fraud signal, one only moves a start time by up to
  3 hours the same day, and one (`agent_review.resolved`) says an admin resolved a
  recommendation.
- One page can hold several items about the same event, such as its publication and then a
  content update.
- A review can fail half-way: the model unreachable, a tool down, Satella answering an error.
- The feed's cursor is per page, not per item (ADR 0011): a pass can't move it to the middle of
  a page.
- The brief (§6.3.3) cuts only on-demand reviews at the day's budget and keeps the scheduler
  running. On staging, the model key is a demo key with a spend cap at the provider.

## Decision

1. **Nine feed types start a review.** `event.published`, `event.content_updated`,
   `event.ticket_type_capacity_set`, `event.service_fee_set`,
   `event.ticket_type_service_fee_set`, `event.substantial_change`, `organizer.registered`,
   `organizer.profile_updated` and `content_report.created`.
   - `event.minor_change` starts none: a start time moved by up to 3 hours the same day carries
     no fraud signal.
   - `agent_review.resolved` starts none: it records a resolution (point 4).
   - A type the agent doesn't know is skipped and counted (ADR 0011).
2. **One review per subject per page, at its current version.** The review context is always
   current, so a second review of the same subject in one page would see the same thing.
   Subjects are reviewed in the order they first appear.
3. **A failed review is stored as a failed run, and the pass moves on.**
   - Any failure counts: a typed one keeps its stable code (`LLM_UNAVAILABLE`,
     `SATELLA_NOT_FOUND`…); anything else is `UNEXPECTED`. Only the code is kept.
   - The run is stored with `outcome: "failed"`, the subject without a version (the failure can
     come before the context is read), and the usage and cost of the calls it made.
   - The cursor advances past the page. The subject is reviewed again on its next change, or by
     "review now" (#48).
   - `409 STALE_SUBJECT` keeps `reviewSubject`'s behaviour: one re-review, recorded in the run's
     `attempts`, and a failed run if the subject changes again.
4. **An admin's resolution is stored next to the run that made the recommendation.**
   - On `agent_review.resolved`, the pass reads the review (`GET /reviews/{id}`) and stores its
     outcome and date under the run named by the review's `agentRunId`.
   - Runs stay append-only: the resolution is its own document (ADR 0016 amendment).
   - A recommendation from no run in this store (a local review, another deployment) is
     skipped. A failed read is logged and doesn't hold the feed back.
   - The admin agreement rate (brief §4.3) is computed from runs and resolutions later.
5. **The scheduled pass stops at the day's budget too.** This **departs from the brief**
   (§6.3.3), which cuts only on-demand reviews and keeps the scheduler running.
   - Every run first reserves its worst case: `AGENT_MAX_TOKENS` at the model's dearest rate,
     rounded up ($0.50 for Haiku 5.5 at 200,000 tokens). After the run, the hold becomes the
     cost of the calls it made, failed or not.
   - Before reading the feed, the pass asks it for no more items than the day's budget can
     review at worst case (at most 10). The cursor the page returns then never skips an item
     left unreviewed for lack of budget.
   - When not one more run fits, the pass reads nothing, logs `BUDGET_REACHED` with the day's
     spend, and leaves the cursor. The next day's passes pick the feed up there.
   - If a reservation is still refused mid-page (another run spent meanwhile), the pass stops
     there and leaves the cursor. That page is read again later, and its subjects already
     reviewed are reviewed again.
   - A model with no price can't be budgeted, so the pass refuses to start with
     `PASS_UNPRICED_MODEL`. A local model holds nothing.
   - The brief's reading protects the scheduled reviews' coverage; this one protects the
     budget. On staging, a feed burst or a loop bug shouldn't spend the provider's whole cap
     in one day.
6. **One correlation id per pass.** It travels in every log line and as `X-Correlation-Id` to
   Satella. Each review has its own `runId`, in its log lines and in the recommendation
   (`agentRunId`). Log lines carry ids, versions and codes only (CLAUDE.md §4).
7. **`pnpm pass` is the job's entry point.** It reads its configuration from the environment.
   The store is Firestore when `FIRESTORE_PROJECT_ID` is set, and in memory otherwise. Satella
   staging isn't wired until #9, so without `--mock` the pass exits with
   `SATELLA_NOT_CONFIGURED` before reading anything. With `--mock` it runs against the
   in-process mock.

## Alternatives rejected

- **Keep the cursor and retry the page after a failure**: it re-spends on every subject already
  reviewed in the page, and one subject that always fails stalls the feed.
- **Keep the scheduler running past the budget** (the brief's reading): a burst could spend the
  provider's cap in one day, with nothing left for the next.
- **Reserve per subject and stop mid-page at the budget**: the page's cursor can't point
  between items. Either the reviewed subjects are reviewed again each day, or, when the budget
  covers fewer runs than a page, the feed never moves.
- **Edit the run with its resolution**: it breaks ADR 0016's append-only runs and its
  conflict-on-resave guarantee, for one field.
- **Review every item, not every subject**: the same context reviewed twice in one pass, for
  twice the cost.
- **A tighter worst case** (input at the input rate, output bounded per call): it depends on how
  the loop splits tokens between calls, and an underestimate lets the day pass its budget. The
  pessimistic hold only leaves up to one hold of the day's budget unused.

## Consequences

- `src/pass/`: `runPass` and `PassReport`; `scripts/pass.ts` (`pnpm pass`).
- `worstCaseMicros` in `src/providers/pricing.ts`.
- New variables (`.env.example`, config schema): `AGENT_DAILY_BUDGET_MICROS` (default
  2,000,000, $2), `FIRESTORE_PROJECT_ID` and `FIRESTORE_EMULATOR_HOST`.
- With the defaults (Haiku 5.5, 200,000 tokens, $2), a pass reviews at most 4 subjects while the
  day's spend is low. That is 576 a day at 10-minute passes, far above staging volume.
- The brief §6.3.3 carries a note pointing here.
- Left open: Satella staging's URL and identity (#9), the deployment (#46), and on-demand
  reviews against the same budget (#48).
