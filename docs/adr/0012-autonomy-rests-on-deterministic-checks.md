# ADR 0012 — Autonomy rests on deterministic checks, and mechanical requests resolve on their own

- **Date:** 2026-11-02
- **Status:** accepted · amendment 2026-11-03 (#7) · amendment 2026-11-03 (#24) · amendment 2026-11-04 (#33) · amendment 2026-11-04 (#35) · amendment 2026-11-05 (#57) · amendment 2026-11-06 (#77) · amendment 2026-11-07 (#82)
- **Related:** brief §4.1, §4.2 and §5; brief D3 and D9; ADR 0008; issues #7, #18, #24, #33 and #35.

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
finding never counts towards one, and organizer reviews always escalate. ADR 0015's amendment
of #79 restores point 3 for a mechanical organizer request.

## Amendment (2026-11-03, #24): a price heuristic against the benchmark

Point 2 gains a heuristic: a ticket priced above 3× the p90 of Satella's price benchmark for the
event's genre, province and capacity band (`price_benchmark`, a `warn`). The check asks Satella
for the benchmark in code, before the model. A benchmark with too small a sample, or one Satella
can't serve, gives `unknown`.

Why now: case 13 (950 € in a 300-person room) was caught only by the model's doubt. In E002 the
model approved it once the venue checks had verified the venue, and it resolved on its own (see
`docs/experiments.md`). Point 3 already says what is computable belongs in code. The factor is
provisional, like the other thresholds.

## Amendment (2026-11-04, #33): an approval never contradicts a negative system finding

Point 3 kept a contradicted approval from resolving on its own, but the recommendation still
said "approve". In E009 the model approved case 11, where the code had flagged a link to another
ticketing site, and case 15, where it had flagged a 45 % service fee. The admin saw both, but
read an approval that went against the code's own evidence.

1. **A model `approve` with any negative system finding becomes a `request_info`.** This counts
   any `warn` or `fail`, `rule` or `heuristic`, from a deterministic or venue check.
   - The info request asks about each flagged finding. It is written in code from the findings'
     details.
   - The rationale names each flag, then gives the model's reasons.
   - The policy weighs the request as usual. With only `rule` negatives it is a mechanical
     request that may resolve on its own, even with the search budget spent (ADR 0015): a rule
     needs no search. With a heuristic one it escalates.
   - Texts stay within Satella's limits. Past 10 flags, the last question points to the rest of
     the findings.
2. **Nothing else is rewritten.** A model `reject` or `request_info` stands. Model findings never
   trigger it: they are claims (point 3).
3. **The confidence stays the model's.** It was a confidence in approving, so on a held-back
   approval it overstates the request. Of all the eval metrics, the Brier score is the one this
   flatters: it dropped from 0.253 to 0.198 in E010, partly because of this (`docs/experiments.md`).

Rejected:

- **Turning the approval into a `reject` on a hard signal:** the model proposes rejections, and
  the policy already lets a sourced or rule-based one resolve.
- **Asking the model again with the flag pointed out:** that is one more model call per held-back
  approval. And a 9B model that ignored a fenced, authoritative finding once can do it twice.

## Amendment (2026-11-04, #35): an exact clone is a rule

Point 2 gains a rule, `exact_duplicate_other_organizer`. It fails when another organizer's
published event, among the similar events Satella serves, matches on all three: title similarity
1, the same venue name, and its first session in Satella's window on the same day, in
Europe/Madrid, as one of the event's sessions. The agent asks Satella in
code, before the model, as it does for the price benchmark.

Why now: Satella's list of similar events carries everything the check needs. Until now only the
model read it, so in case 07 the `reject` rested on a model finding without a source and
escalated. As a rule `fail` on a hard-signal check, it now resolves on its own (point 3).

It only fails; a near match gives no finding. A `pass` would drop any model finding on the same
check, since system findings win. That would include a clone the model finds on another site
with `web_search`. The platform's list proves a clone; it can't prove originality. If Satella
can't serve the list, there is no finding and the model still has `find_similar_events`.

Limits, all false negatives, never false fails: Satella reports only the other event's first
session in its window (7 days by default), so a clone that shares a later date is missed; days are
compared by start, so sessions on either side of midnight don't match; title similarity 1 is
trigram equality, which also ignores case, punctuation and word order.

Rejected: **a heuristic `warn` for a near match** (similar title, same venue and day). Satella
returns titles from a trigram similarity of 0.3. A threshold there would need cases to tune it,
and none of the brief's cases has a near clone.

## Amendment (2026-11-05, #57): a system pass doesn't silence a model fail

This narrows point 1. Before, any model finding on a check the code ran was dropped. Now a model
`fail` or `warn` survives when every system finding on that check is a `pass`. Every other model
finding on such a check is still dropped, as before.

- **Why.** A system `pass` on a pattern check only means the pattern didn't match. An independent
  review (#57) wrote "B1zum" and "Si no tienes tarjeta, paga por Bizum…", and neither matched the
  payment rule. The code then reported `off_platform_payment: pass` and removed the model's `fail`
  on the same check. So the admin and the policy lost the one finding that had caught it.
- **What doesn't change.** A system `fail`, `warn` or `unknown` still wins over any model finding
  on its check. A model `pass` or `unknown` still never stands next to the code's verdict. The
  #33 rule on approvals is untouched.
- **Effect today.** None on the evals: `pnpm eval:replay --check` replays both sets with the
  same metrics and report.

**Rejected:** dropping `pass` from the pattern checks, as the exact clone check does (#35). The
admin would no longer see what was checked and came out clean. The fix belongs where findings
are merged, not in each check.

## Amendment (2026-11-06, #77): the confidence comes from the evidence tier

ADR 0019 takes the model's confidence out of the policy. Where this ADR says a decision resolves
"with confidence at the threshold", the threshold now compares the review's evidence tier, which
the findings already decide; the model's number only holds back, below 0.5. It replaces point 3 of
the amendment of #33: a held-back approval shows its tier when it resolves as a mechanical
request, and at most 0.84 when it escalates.

## Amendment (2026-11-07, #82): a model negative survives where the code reached no verdict, and two patterns narrow

Three changes from the review of #81 (groups 1 and 2).

**1. The model-finding rule.** This replaces the rule of the amendment of #57. On a check the code
ran, the model's `fail` or `warn` is kept unless the code's own finding on that check is negative
(`fail` or `warn`): there the system finding wins, as before. The model's `pass` and `unknown` are
still dropped. So a system `unknown` now behaves like a system `pass` for this purpose. The
`covers` family of the venue checks (`venue_capacity`, `capacity_far_above_venue`) follows the same
rule. It lives in one function, `keepsModelFinding` (`src/agent/loop.ts`).

- **Why.** A system `unknown` means the code had no evidence, not that it found the subject clean.
  With a sparse price benchmark, `price_benchmark: unknown` dropped the model's `warn` on case 13's
  outlier price, and that `warn` was the only thing catching the pattern. Where the code has no
  verdict, a model doubt should hold back an approval.
- **What doesn't change.** A system negative still wins over any model finding on its check, so
  the admin reads one verdict per check. A model `pass` still counts for nothing. The #33 rule on
  approvals is untouched.

**2. `text_originality` is no longer a minor warning.** It leaves `MINOR_WARN_CHECKS`, so a model
`warn` on it holds back an approval like any other non-minor model warning (point 3).
`organizer_web_presence` stays minor. The copied-text check (ADR 0015, amendment of #37) searches
one sentence, and it can't run when web search is down (ADR 0015, amendment of #82). A copy the
model noticed and the code missed should reach the admin.

**3. Two rule patterns narrow.** Both checks stay `rule` findings and hard signals, and the fraud
fixtures of cases 10 and 26 (Bizum) and 24 (alcohol aimed at minors) still fire.

- **Off-platform payment.** A negation shortly after the match now counts too, not only one before
  it: "Bizum no disponible" and "PayPal ya no se acepta" give no finding. "Shortly after" means at
  most two words in between, none of them a conjunction (`y`, `o`, `pero`, `sino`…) or a clause
  break, so "Paga por Bizum y no pagues gastos" still fires. Every occurrence of a pattern is now
  checked, not only the first, so "Bizum no disponible en taquilla; paga por Bizum al…" still
  fires on the second.
- **Alcohol aimed at minors.** The minors mention and the alcohol mention must be in the same
  clause. A clause ends at `.`, `!`, `?`, `;`, `,` or a line break, but not at a colon: what
  follows a colon is what its head offers, list commas included. Case 24 needs that ("para +14:
  música, cervezas y barra libre" is one offer to the +14).
- **The cost, both ways.** The comma cut misses "Fiesta +14, barra libre", a real offer split by a
  comma: no finding, so the case rests on the model. The colon join fires on "Menores: zona
  infantil, cerveza para adultos", a benign sentence: a false hard signal. Both are listed in
  `docs/known-limitations.md`. They are the price of a clause rule simple enough to argue; neither
  appears in the cases today.

**Rejected:**

- **Keeping the #57 rule** (a model negative survives only next to a system `pass`). It silences
  the model exactly where the code has no evidence.
- **Letting a model `pass` stand next to a system `unknown`.** A model `pass` is a claim; it would
  read as evidence of a clean check that no one ran.
- **Making the payment rule a heuristic** to absorb its false fails. It would no longer let a
  rejection resolve on its own on case 10 and 26's plain requests, which are certain.
- **A clause parser** (subordinate clauses, list detection) for the minors rule. More upkeep than
  one cases-backed split, and still Spanish-only.
