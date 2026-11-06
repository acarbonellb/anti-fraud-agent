# Glossary

Domain vocabulary of the agent. Satella's terms come from its shipped agent API
(`src/satella-client/schemas.ts`, ADR 0011) and the design brief (`docs/agent-design-brief.md`);
when this file disagrees with them, the shipped API wins, then the brief, and this file gets
fixed.

## Satella side (read through the contract)

- **Event**: something sold on Satella, with sessions and ticket types. Lifecycle
  `draft → published → (cancelled | ended)`. Published events go on sale with no prior review.
- **Organizer**: the account that publishes events. Starts `pending` and needs a manual admin
  approval (`approved` / `rejected`); an admin can later `suspend` an approved one, reversibly.
- **Venue**: where an event happens. Owned by one organizer and stored **without capacity**, so
  the same real place can exist several times.
- **Session**: one date of an event. Capacity and sales live per session.
- **Ticket type**: a price tier in a session (`standard` or `guest_list`), with its capacity.
- **Agent API**: Satella's `/api/agent/v1`, the only way the agent reaches Satella. Its shipped
  behaviour is the contract (ADR 0011).
- **Feed**: Satella's cursor-paginated list of events that may need a review (`FeedItem`). Edits
  carry the changed fields and, while Satella keeps the revision (90 days), their before and
  after.
- **Review context**: the DTO Satella prepares to review one subject (event or organizer), with a
  `version` hash of what is reviewable.
- **Subject**: what a review is about: an event or an organizer.
- **Admin**: the human who resolves recommendations in Satella's panel.

## Agent side

- **Recommendation** (`agent_review` in Satella): what the agent proposes about a subject:
  `approve`, `reject` or `request_info`, with a `rationale` and `findings`. Changes nothing by
  itself.
- **Resolution**: what the admin does with a recommendation: accept or dismiss.
- **Pending recommendation**: the latest one that asks an admin to look at it, still unresolved.
- **Superseded recommendation**: replaced by a newer one before being resolved.
- **Autonomy**: `auto_resolved` (clear case, no human needed) or `escalated` (a human must look).
  Decided by the policy, not by the model.
- **Finding**: the result of one check (`pass` / `warn` / `fail` / `unknown`), with a confidence
  and its sources.
- **Hard signal**: a finding strong enough to allow an auto-resolved `reject` (off-platform
  payment, illegal content including alcohol aimed at minors, exact duplicate of another
  organizer, capacity several times the venue's), from a rule check or with sources (ADR 0012).
- **Deterministic check**: a check computed in code on the review context before the model runs
  (`src/checks/`). Its findings are authoritative over the model's.
- **Rule finding / heuristic finding**: a deterministic finding that is a certain inconsistency
  anyone can verify (rule), or one that crossed a threshold still needing judgement (heuristic).
  Only rule findings let a `request_info` resolve on its own (ADR 0012).
- **Venue checks**: `verifyVenue` and `estimateVenueCapacity`, external checks run in code before
  the model on the review context. Their findings are system findings with sources, and an event's
  auto-approval requires them (ADR 0015).
- **Exposure cap**: the most tickets on sale per session (300) an event may have to resolve an
  approval on its own while its venue's capacity is unknown (ADR 0015).
- **Mechanical request**: a `request_info` whose every negative finding is a rule finding. It
  may resolve on its own, for an event or an organizer (ADRs 0012 and 0015).
- **Copied-text check**: the one web search run in code: the description's longest sentence. A
  page that holds it word for word gives a heuristic `text_originality` warning (ADR 0015).
- **Held-back approval**: a model `approve` with a negative system finding. The agent sends it as
  a `request_info` that asks about each flag (ADR 0012).
- **Run**: one execution of the agent on one subject, with its tool trace, tokens, cost and
  latency.
- **Search budget**: the web searches one run may make (`AGENT_MAX_WEB_SEARCHES`, default 4). A
  search past it is refused, not run; the model still decides, and an approval escalates (ADR
  0015).
  A repeated search (same words) is answered without spending it.
- **Provider content**: the provider's own blocks of an assistant turn (`providerContent`), opaque
  to the loop and sent back unchanged by the adapter that produced them. Claude's thinking blocks
  travel in it (ADR 0008 amendment).
- **Effort**: how much Claude thinks before it answers (`AGENT_LLM_EFFORT`: `low` to `max`,
  default `medium`). Thinking is billed as output.
- **Paid provider**: one that bills per token (`anthropic`). The scripts call it only with
  `--paid`.
- **Deployed model**: the model the deployed agent runs, set in its environment and chosen by the
  evals (Claude Haiku 5.5 since E014). The code's fallback with nothing set stays local qwen, so
  development needs no key (ADR 0008 amendment, #42).
- **Pass**: one scheduled sweep of the feed from the stored cursor: at most 10 items, every
  subject that changed reviewed once, the cursor advanced past the page (`pnpm pass`, ADR 0017).
- **Deployed pass**: the pass as a Cloud Run Job on GCP, started every 10 minutes by Cloud Scheduler
  and deployed from CI with no stored key. It reviews Satella staging with its identity token
  (ADR 0018).
- **Identity token**: the Google token the deployed pass sends Satella as its bearer: issued by the
  Cloud Run metadata server for `pass-job`, with Satella's audience. No shared secret exists
  (brief §3.1, ADR 0018).
- **Reviewable item**: a feed item that starts a review. Every type but `event.minor_change` and
  `agent_review.resolved` (ADR 0017).
- **Agent store**: the agent's own data, apart from Satella's: runs and their resolutions, the
  feed cursor, the retry queue and the day's spend (`AgentStore`). Firestore when deployed, in memory locally and
  in tests (ADR 0016).
- **Run document**: one run as the store keeps it: the recommendation, its autonomy, usage, cost
  and the summary trace, never a tool response (ADR 0016).
- **Failed run**: a run that ended without a recommendation in Satella. It keeps the error's
  stable code and what its calls cost, and the pass moves on (ADR 0017).
- **Transient failure**: a failed review another try may fix: the model or Satella unreachable,
  timed out, rate limited or answering 5xx (`isTransient`). Its subject joins the retry queue
  (ADR 0017 amendment).
- **Retry queue**: the subjects whose last review failed transiently, oldest first. Each pass
  reviews some of them again, in at most half its room; a subject leaves after a review that
  doesn't fail transiently, or is abandoned after its third failure (ADR 0017 amendment).
- **Run resolution**: the admin's resolution of a run's recommendation, kept next to the run in
  the store; the admin agreement rate (brief §4.3) joins them (ADR 0016 amendment).
- **Feed cursor**: where the next pass reads the feed from. It advances only from the value read,
  so two overlapping passes can't both move it (ADR 0016).
- **Spend hold**: a run's worst-case cost, reserved against the UTC day's budget
  (`AGENT_DAILY_BUDGET_MICROS`) before it runs and replaced by its actual cost after. It expires
  after 15 minutes, so a crashed run can't keep budget (ADR 0016).
- **Worst-case cost**: what a run reserves before it starts: `AGENT_MAX_TOKENS` at the model's
  dearest rate, for the review and its re-review after a stale subject. A model with no price has
  none, so the pass won't run it (ADR 0017).
- **Prompt version**: the versioned prompt a run used; the unit of retirement.
- **Eval case**: a fixture subject with its expected decision and autonomy (brief §5).
- **Approved-fraud rate**: share of problem cases the agent approved. The critical metric.

## Evals

- **Problem case / legitimate case**: brief §5 cases 1–26 depict fraud or something off; N1–N5
  are legitimate events, there to measure false positives.
- **Expected outcome**: the decision (or decisions: case 4 takes two, case 25 «never approve») and
  the autonomy a case should end with, from brief §5 refined by ADR 0012.
- **External case**: a case only the external tools (#7: venue, capacity, web presence…) can
  settle, tagged `requires: ["external"]`. It runs and is reported, but not gated. A case loses the
  tag with the tool that settles it (ADR 0015).
- **Gated case**: every case that is not external. The CI gate and the **Gated** metrics count only
  these, because the agent already has what it needs to get them right.
- **Recording**: the model's responses to one case, each with the hash of the request that
  produced it, plus the clock the fixtures were built from (`evals/recordings/`).
- **Retrieved source**: a URL a tool returned in the current run (a `web_search` result). It is
  the only kind of source the policy accepts on a model finding (ADR 0015).
- **Authored web**: hand-written web pages for an eval case whose organizers, artists or texts
  are invented. Every search in that case runs against them, in code (ADR 0015).
- **Tool recording**: the venue providers' HTTP responses to one case, keyed by the hash of each
  request and shared by every model's recordings (`evals/tool-responses/`, ADR 0015).
- **Record / replay**: `pnpm eval` runs the real model and records; `pnpm eval:replay` feeds the
  recorded responses back through the real agent, with no model, network or cost.
- **Fixture origin**: `recorded` (a real provider response, committed only for open data or
  reduced to the fields the tool uses) or `authored` (written by hand, for invented organizers,
  artists and texts) (ADR 0015).
- **Repeated runs**: one case recorded several times in the same set (`pnpm eval --runs N`; 3 for a
  new set), each with its own fence nonce from the case id and run index. Run 1 is the case's file;
  run n sits next to it as `….run-<n>.json` (ADR 0014 amendment, #42).
- **Majority outcome**: the decision and autonomy more than half of a case's runs gave. A tie, or a
  majority missed because runs failed, matches no expected outcome.
- **Spread**: the min–max across runs of accuracy, approved-fraud rate, auto-approved fraud rate
  and autonomy accuracy, kept in a history entry next to the means.
- **Stale recording**: one whose requests no longer match what the code sends (the prompt, a tool,
  a check or a fixture changed), or that is missing. It must be recorded again.
- **Auto-approved fraud rate**: share of problem cases that ended in `approve` + `auto_resolved`,
  the only outcome that skips the admin. CI fails on a gated case that any of its repeated runs
  auto-approved.
- **Escalation rate**: share of cases sent to the admin (`escalated`).
- **Autonomy accuracy**: share of cases whose autonomy matches the expected one.
- **Brier score**: mean of (confidence − correct)², where correct is 1 or 0. Measures calibration:
  0 is perfect; a confident wrong answer costs the most.
- **Eval report**: `evals/report.md`, the metrics per provider/model and a row per case.
  Regenerated by replay and compared byte for byte in CI, so behaviour changes show in the diff.
- **Metrics history**: `evals/history.jsonl`, append-only and machine-written by `pnpm eval` and
  `pnpm eval:replay`. One history entry per change that moved a recording set's metrics.
- **History entry**: one line of the history, with an id (`E001`…), the UTC date, provider, model,
  prompt versions, a one-line note and the gated and all-cases metrics; with repeated runs, their
  number, the means and the spread. Never edited; a newer entry corrects a wrong one.
- **Experiment log**: `docs/experiments.md`, one written section per history entry, with the same
  id: hypothesis, change, before → after, what went wrong and the decision (keep, revert, retire).
- **Hypothesis**: the effect on the metrics a change is expected to have, stated in its ticket
  before it is `ready-for-agent` and checked against the history after.
- **Admin agreement rate**: share of recommendations the admin accepted, per prompt version.
