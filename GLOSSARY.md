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
- **Mechanical request**: a `request_info` whose every negative finding is a rule finding.
- **Run**: one execution of the agent on one subject, with its tool trace, tokens, cost and
  latency.
- **Pass**: one scheduled sweep of the feed from the stored cursor.
- **Prompt version**: the versioned prompt a run used; the unit of retirement.
- **Eval case**: a fixture subject with its expected decision and autonomy (brief §5).
- **Approved-fraud rate**: share of problem cases the agent approved. The critical metric.
- **Admin agreement rate**: share of recommendations the admin accepted, per prompt version.
