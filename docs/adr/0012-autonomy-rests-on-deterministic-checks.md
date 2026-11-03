# ADR 0012 — Autonomy rests on deterministic checks, and mechanical requests resolve on their own

- **Date:** 2026-11-02
- **Status:** accepted · amendment 2026-11-03 (#7)
- **Related:** brief §4.1, §4.2 and §5; brief D3 and D9; ADR 0008; issues #7 and #18.

## Context

Brief §4.2 lets only two decisions resolve on their own: an `approve` with no `fail` and high
confidence, and a `reject` on a sourced hard signal. Every `request_info` escalates. The brief
§5 dataset disagrees: it expects `request_info` to resolve on its own in five cases where a
rule settles the question:

- 3: the postal code belongs to another province;
- 12: the terms deny refunds even if the event is cancelled;
- 14: VIP is cheaper than General;
- 19: two sessions overlap;
- 22: the tax id has a wrong checksum.

It also expects four cases that are just as computable to escalate:

- 13: an outlier price;
- 15: a 45% service fee;
- 17: a session hours after publishing;
- 18: a session three years away.

The first local runs (#5) showed two weaknesses:

- The model computed numbers badly. It called a 10% fee "about 1%".
- It recorded a `pass` for checks no tool had performed. It marked `impersonation` as `pass`
  with nothing to check it, and the run resolved on its own.

The policy trusted findings whose only author was the model.

Satella's session was consulted on 2026-11-01. In Satella only `approve` + `auto_resolved`
skips the admin; any other combination is born `pending_admin`. The autonomy the agent sends
is still stored, shown to the admin and returned by `GET /reviews/{id}`. A request for
information is never sent to the organizer on its own (Satella's DSA procedure). Satella
recommended sending `auto_resolved` for mechanical requests, so their acceptance by admins can
be measured, provided the rule is written down and each finding names it.

## Decision

1. **Deterministic checks run in code, before the model,** on the review context
   (`src/checks/`). Their findings are authoritative. The model sees them, fenced as untrusted
   because they quote organizer text, and any model finding for the same check is dropped.
   Each `detail` names its rule in Spanish, so the admin sees why it is mechanical.
2. **Every deterministic check is a rule or a heuristic.**
   - A **rule** finding is a certain inconsistency anyone can verify: postal code against
     province, off-platform payment wording, a no-refund-even-if-cancelled clause, alcohol
     aimed at minors, VIP cheaper than General, overlapping sessions, a wrong tax id checksum.
   - A **heuristic** finding crossed a threshold that still needs judgement: links to other
     ticketing sites, injection wording, a service fee above 20%, a session within 12 hours of
     publishing or more than 548 days away, an owner with a rejected organization, previous
     fraud reports.
   - The thresholds are provisional until the evals tune them (#6).
3. **The policy weighs evidence, not claims.**
   - **`approve`** resolves on its own only with no negative system finding, no model `fail`,
     at most one minor model `warn`, and confidence at the threshold. A model `pass` counts
     for nothing.
   - **`request_info`** resolves on its own only when every negative finding is a **rule**
     system finding and confidence is at the threshold. That covers cases 3, 12, 14, 19 and 22. Any heuristic or model negative escalates, which covers cases 13, 15, 17, 18, 23 and 25.
   - **`reject`** resolves on its own only on a hard signal: a `fail` from a hard-signal check
     that is either a **rule** system finding or a model finding with a source.
   - Alcohol aimed at minors joins the hard signals as illegal content (case 24).
4. **The agent sends the autonomy it computed, even where Satella doesn't act on it.** A
   mechanical `request_info` goes as `auto_resolved` and still lands as `pending_admin`.
   Measuring how often admins accept those is what would justify any future automation, which
   would be Satella's decision, with its own ADR.

## Alternatives rejected

- **Keep brief §4.2 as written** (every `request_info` escalates). Safe, but it sends admins
  requests a rule already settles. It also hides the signal that would show whether the agent
  can be trusted with them.
- **Let any deterministic finding resolve a `request_info`.** It contradicts cases 13, 15, 17
  and 18: a threshold like "a fee above 20%" is a judgement written as a number.
- **Let the model run the deterministic checks as tools.** The model chooses whether to call
  them and copies the inputs, so the policy still couldn't tell a computed result from a
  claimed one. Running them in code makes their provenance certain.
- **Send `escalated` for mechanical requests, matching what Satella does today.** It loses the
  measurement and misreports what the agent concluded.

## Consequences

- The system findings take up to 13 of Satella's 30 findings per recommendation, leaving the
  rest for the model.
- A run that hits a limit still carries the deterministic findings in its fallback
  recommendation.
- Approvals can only resolve on their own when the deterministic checks are clean. Once the
  external checks exist (#7: venue, capacity, presence), they should become part of the
  required evidence for an auto-approval, not just the absence of negatives.
- The prompt is now `review-v2`: it tells the model the deterministic checks already ran.

## Amendment (2026-11-03, #7): external evidence

ADR 0015 settles the consequence above: an event's auto-approval now requires the venue checks
(`verifyVenue` `pass`, and capacity `pass` or unknown within the exposure cap), a `webSearch`
finding never counts towards one, and organizer reviews always escalate.
