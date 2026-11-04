# Experiment log

Why the eval metrics moved, and what was decided because of it (brief §4.3, ADR 0014). The numbers
come from `evals/history.jsonl`, which `pnpm eval` and `pnpm eval:replay --note "…"` append to:
nobody types a metric by hand. Each history entry gets one section here, with the same id, and CI
fails until it has one.

Failures and regressions are recorded as honestly as wins. Past sections are never rewritten: a
wrong conclusion is corrected by a newer entry that says so. A prompt version or model is retired
by a decision written here, never automatically.

Metrics are the **gated** ones unless a line says otherwise. Each section has this shape:

```markdown
## E00N — Short title

- **Hypothesis:** the expected effect on the metrics, stated before the change.
- **Change:** what changed, and its PR.
- **Before → after:** the key metrics from the history, previous entry → this one.
- **What went wrong or surprised:** …
- **Decision:** keep, revert or retire, and the next step.
```

## E001 — Baseline: `qwen/qwen3.5-9b` with `review-v2`

- **Hypothesis:** none; this is the reference every later entry is measured against.
- **Change:** the first full recording of the brief §5 dataset (31 cases) on 2026-11-02, with
  the local model through LM Studio and prompt `review-v2` (#6, PR #20). The history starts here
  (#21).
- **Before → after:** — → 59.1 % accuracy, 38.9 % approved-fraud rate, 0.0 % auto-approved
  fraud rate, Brier 0.302. All cases: 41.9 % accuracy, 53.8 % approved-fraud rate, 26.9 %
  auto-approved fraud rate, Brier 0.470.
- **What went wrong or surprised:**
  - **The model is too lenient.** It approved 7 of the 18 gated fraud cases (03, 11, 15, 16, 17,
    18, 23), most at 0.85–0.95 confidence. Case 03 ignored a rule finding: its postal code belongs
    to another province.
  - **The policy contained it.** All 7 gated approvals of fraud were escalated, because a
    deterministic check flagged them or a warning was not minor (ADR 0012). The gated
    auto-approved fraud rate is 0.
  - **The external cases are the real exposure.** 7 of the 26 fraud cases (26.9 %) ended
    `approve` + `auto_resolved`, and every one of them is an external case (01, 02, 04, 05, 06,
    08, 09). Without the external tools the checks find nothing, and a confident approval resolves
    on its own.
  - **Confidence is poorly calibrated.** Wrong approvals carry 0.95 like right ones, and the
    auto-approve threshold trusts that number.
- **Decision:** keep as the baseline. Next: the real review tools (#7), so the external cases
  can be caught and gated, and the other providers (#15), to compare models on the same cases.
  Prompt work on leniency is measured against this entry.

## E002 — Venue checks in code, and venue evidence required for an approval

- **Hypothesis** (#24, ADR 0015):
  - cases 01, 02, 04 and N5 join the gate: 01 ends `reject` + `auto_resolved`, and 02, 04 and
    N5 escalate;
  - the all-cases auto-approved fraud rate drops from 26.9 % to 15.4 %, and the gated rate stays
    at 0;
  - N1 and N3 stay `approve` + `auto_resolved`.
- **Change** (#24):
  - `verifyVenue` and `estimateVenueCapacity` run in code before the model, against Nominatim
    (search, and reverse lookup at the coordinates instead of Overpass, which was at capacity:
    ADR 0015 amendment) and Wikidata;
  - an event's approval resolves on its own only with the venue verified, and its capacity
    verified or at most 300 tickets on sale per session;
  - organizer reviews always escalate;
  - the cases use real venues (04 and N5 keep invented ones, by design);
  - the prompt is `review-v3`, which says the venue checks already ran;
  - the gated set grows from 22 to 26 cases.
- **Before → after:** gated: 59.1 % → 57.7 % accuracy, 38.9 % → 38.1 % approved-fraud rate,
  **0.0 % → 4.8 % auto-approved fraud rate**, Brier 0.302 → 0.357. All cases: 41.9 % → 48.4 %
  accuracy, 53.8 % → 42.3 % approved-fraud rate, 26.9 % → 7.7 % auto-approved fraud rate, Brier
  0.470 → 0.415.
- **What went wrong or surprised:**
  - **The gate is red: case 13 resolves on its own.** It is a General ticket at 950 € in a
    300-person room. In E001 the model asked for information at 0.65. Now it approves at 0.95,
    and the policy lets it through: the venue is verified, and 280 tickets are under the exposure
    cap. Nothing deterministic looks at the price against the benchmark, so the only thing
    stopping this case was the model's doubt. A verified venue seems to have removed that doubt.
    The venue checks made the approval look better supported than it is.
  - **01 doesn't resolve on its own.** The capacity check fails with its source (2,000 tickets
    against a bar of 140 in OSM, 14.3×). The model then proposes `request_info` at 0.70, not
    `reject`. The policy only lets a `reject` resolve on a hard signal, so this one escalates.
    That is safe, but the hypothesis missed.
  - **The external exposure fell further than expected.** 05, 06 and 09 no longer resolve on
    their own: 06 (700 tickets) and 09 (900) hit the exposure cap, and the model asked about 05.
    Only 08 (copied text, `webSearch`'s case) and 13 remain.
  - **N2, a legitimate festival, now escalates.** It puts 6,000 tickets on sale per session in a
    park with no published capacity, above the 300 cap. This is the cost the cap was designed to
    have. Festivals in open spaces will reach the admin.
  - **Case 22 escalates by rule** (ADR 0015 point 7). Its expected `auto_resolved` from the brief
    is kept, so the miss stays visible.
  - **Calibration got worse** (Brier 0.302 → 0.357 gated). Several of the model's confidences
    moved. 03 and 14 fell to 0.75, so the mechanical requests escalate.
- **Decision:** keep the venue checks, because they removed most of the external exposure. Don't
  merge while the gate is red. The next step is a deterministic heuristic on price against
  Satella's benchmark, so case 13 escalates on evidence and not on the model's mood. ADR 0012
  already expects 13 to escalate as a heuristic. That needs the author's go-ahead and a new
  history entry.

## E003 — A price heuristic against the benchmark closes case 13

- **Hypothesis:** case 13 escalates on a deterministic `warn`, whatever the model proposes, and
  the gated auto-approved fraud rate returns to 0. No other case trips the check: only case 13
  has a price above 3× its benchmark's p90.
- **Change** (#24, ADR 0012 amendment): `price_benchmark` asks Satella for the price benchmark of
  the event's genre, province and capacity band, in code before the model, and warns on a ticket
  above 3× the p90. The check vocabulary gains `price_benchmark`, so every case was recorded
  again.
- **Before → after** (E002 → E003): gated: 57.7 % → 53.8 % accuracy, 38.1 % → 33.3 %
  approved-fraud rate, **4.8 % → 0.0 % auto-approved fraud rate**, autonomy accuracy 73.1 % →
  80.8 %, Brier 0.357 → 0.335. All cases: 48.4 % → 48.4 % accuracy, 7.7 % → 3.8 % auto-approved
  fraud rate (08 only), Brier 0.415 → 0.386.
- **What went wrong or surprised:**
  - **It worked the way it was meant to.** The model still approves 13, at 0.85. The policy
    escalates it because the code flagged the price, not because the model hesitated.
  - **The all-cases rate already reaches the level the ADR expected only after `webSearch`.**
    Only 08 (copied text) still resolves on its own. 09, the expected known gap, now escalates on
    the exposure cap.
  - **Case 07 regressed with no change of its own.** A clone with the same title, date and venue
    as another organizer's event went from `reject` + `auto_resolved` to `request_info` at 0.70.
    The only change in its request is the check vocabulary. The model is sensitive to small
    changes in its tools. One run per case can't tell drift from noise.
  - **01 still escalates** (`request_info` at 0.60) despite the sourced capacity `fail`, as in
    E002.
  - **03 and 14 resolve on their own again** at 0.85, right at the threshold. Calibration
    decides them, not evidence.
- **Decision:** keep. Next:
  - a deterministic check for an exact clone (same title, date and venue as another organizer's
    event), which `find_similar_events` already makes computable: case 07 shouldn't depend on
    the model either;
  - several runs per case before reading a single case's change as a regression.

## E004 — `webSearch`: fewer approvals of fraud, a model that searches too much

- **Hypothesis** (#25, ADR 0015):
  - 05, 06, 08 and 20 join the gate, and all four escalate;
  - the all-cases auto-approved fraud rate falls towards 3.8 % (09 only), if the model uses
    search well;
  - legitimate cases don't escalate more.
- **Change** (#25):
  - the model gets `web_search`, a provider-neutral tool with Tavily behind it;
  - a model finding counts as sourced only by a URL a tool retrieved in the run;
  - the capacity check gains its web step;
  - cases with invented entities search authored pages, the four problem cases and N1–N4 (ADR
    0015 amendment);
  - prompt `review-v4`.
- **Before → after** (E003 → E004): gated: 53.8 % → 65.5 % accuracy, **33.3 % → 8.3 %
  approved-fraud rate**, 0.0 % → 0.0 % auto-approved fraud rate, Brier 0.335 → 0.319. All cases:
  48.4 % → 61.3 % accuracy, 42.3 % → 15.4 % approved-fraud rate, 3.8 % → 3.9 % auto-approved
  fraud rate. Mean input tokens per review: about 10,400 → 39,600.
- **What went wrong or surprised:**
  - **Search made the model much harder to fool.** It approves 2 of 24 gated fraud cases, down
    from 7 of 21. 01 now resolves its `reject` on its own: the model searched the bar, and the
    sourced capacity `fail` (14×) became a hard signal. 06 found the band's other date.
  - **Case 08 is still not settled, so it keeps `external`.** The model searched the theatre's
    capacity, never the description, and approved at 0.95. Even had it found the copy, a model
    `text_originality` warning is "minor" and doesn't stop an approval. With 08 gated, CI failed,
    so 08 stays outside the gate, a known gap like 09. That is why the all-cases rate didn't
    fall.
  - **The model searches too much.** 05, N2 and N3 hit the 10-search limit, looking for one exact
    confirmation (band + venue + date) with the query reworded each time. The limit escalates
    them safely. For N2 and N3, legitimate events, it is a false alarm the admin pays for.
  - **My authored pages were incomplete at first.** I gave pages only to the problem cases. The
    model searched N3's and N4's invented bands on the real web, found nothing and escalated
    them. Giving N1–N4 their own pages, dated like a band's real agenda, fixed N1 and N4. I
    stopped there: shaping pages until the model approves would tune the dataset to the model.
  - **Cost:** each review reads about 4× the input tokens, and recording all cases spent 124
    Tavily credits.
- **Decision:** keep. Next:
  - a text-originality check in code: search a literal sentence of the description, 1 credit
    per event, so 08 escalates on evidence and can join the gate;
  - stop the over-searching, with a lower cap or a prompt that says when to stop, measured
    against N2 and N3.

## E005 — A soft search budget: fewer tokens, and the fallback no longer hides wrong decisions

- **Hypothesis** (#31): mean gated input tokens fall from about 39.6k to under 20k; the gated
  approved-fraud rate (8.3 %) and auto-approved fraud rate (0) don't get worse; accuracy stays at
  65.5 % or above; N2 and N3 stop escalating because of the search limit.
- **Change** (#31, ADR 0015 amendment): a search past the budget is refused and the model still
  decides, and the run escalates; the default budget drops from 10 to 4; a repeated query (same
  words) is answered without searching; each search gives 3 results of 300 characters instead
  of 5 of 500. Prompt unchanged (`review-v4`).
- **Before → after** (E004 → E005): gated: 65.5 % → 58.6 % accuracy, **8.3 % → 20.8 %
  approved-fraud rate**, 0.0 % → 0.0 % auto-approved fraud rate, Brier 0.319 → 0.351. All cases:
  61.3 % → 54.8 % accuracy, 15.4 % → 26.9 % approved-fraud rate, 3.9 % → 3.8 % auto-approved
  fraud rate. **Mean input tokens per review: about 39,600 → 27,500 (−30 %).**
- **What went wrong or surprised:**
  - **E004's accuracy was partly the fallback's.** Seven runs used to end on the 11th search with
    a stock `request_info` at confidence 0. That is the expected answer for many problem cases,
    so a broken run scored as a right one. Now the model decides, and in 11, 15 and 23 it
    approves fraud the fallback used to "catch". The approved-fraud rate rose because the
    model's real decisions are now measured, not because it got worse.
  - **The budget-spent escalation is too broad.** 12 runs hit the 4-search budget. In 01 and 10
    it turned a `reject` resolved on a hard signal (sourced capacity, off-platform payment) into
    an escalation. More searching can't weaken a rule-based rejection: only an approval rests
    on the evidence the model didn't get to read.
  - **N3 now auto-approves and N2 approves,** escalated only by the exposure cap of its
    6,000-ticket festival (#29 item 6). Both stopped escalating because of searches.
  - **Tokens fell, but not enough.** The model still spends every search it has, so each review
    still has about six steps.
- **Decision:** keep the soft budget: a run that ends on a limit should keep the model's work,
  and the metrics should measure the model's decisions, not a fallback. Next: the budget holds
  back only an approval (E006, replayed with no model), then a prompt that says when to stop
  searching (E007).

## E006 — The spent search budget holds back only an approval

- **Hypothesis** (#31, from E005): 01 and 10 resolve their hard-signal rejections on their own
  again; nothing else moves, since the recordings are replayed unchanged.
- **Change** (#31, ADR 0015 amendment point 1): a run that spent its search budget escalates
  only when it approves. A rejection or a request is weighed by the policy as usual. Replayed
  with no model: the requests didn't change.
- **Before → after** (E005 → E006): gated: accuracy 58.6 % → 58.6 %, approved-fraud rate
  20.8 % → 20.8 %, auto-approved fraud rate 0.0 % → 0.0 %, **escalation rate 75.9 % →
  65.5 %, autonomy accuracy 69.0 % → 72.4 %**.
- **What went wrong or surprised:**
  - 01 and 10 resolve on their hard signals again, as before E005.
  - **17 now resolves a `reject` on its own** on the sourced `capacity_far_above_venue` signal,
    where the dataset expects an escalated `request_info`. The policy allows a hard signal to
    resolve a rejection (ADR 0012 point 3, ADR 0015 point 6), so this is the policy working.
    The budget had been hiding it, the same way the old fallback hid wrong decisions in E005.
- **Decision:** keep. Next: the prompt says when to stop searching (E007).

## E007 — A prompt that says when to stop: better decisions, not fewer searches

- **Hypothesis** (#31): with `review-v5` the model searches once or twice, so mean input tokens
  fall towards 20k; decisions don't get worse.
- **Change** (#31): prompt `review-v5`. One or two well-aimed searches usually settle a review;
  don't search the venue, which the code already checked; a search that finds nothing is
  evidence to record, not a reason to reword it.
- **Before → after** (E006 → E007): gated: **58.6 % → 65.5 % accuracy, 20.8 % → 12.5 %
  approved-fraud rate**, 0.0 % → 0.0 % auto-approved fraud rate, **Brier 0.351 → 0.253** (the
  best so far), escalation rate 65.5 % → 72.4 %. All cases: 54.8 % → 61.3 % accuracy, 26.9 % →
  19.2 % approved-fraud rate, 3.8 % → 3.8 % auto-approved fraud rate. Mean input tokens per
  review: about 27,500 → 28,400.
- **What went wrong or surprised:**
  - **The model ignores the number.** It still makes about 4 searches per review, and 15 cases
    try a 5th or 6th past the budget. So tokens didn't fall: the budget is what bounds them,
    not the prompt.
  - **But it reads what it finds better.** 02, 03, 06, 07 and 16 now get the expected decision,
    and 21 no longer approves. Calibration improved the most: confidence follows the evidence
    better than in any earlier entry.
  - **Over the whole of #31 (E004 → E007):** gated accuracy 65.5 % → 65.5 %, approved-fraud rate
    8.3 % → 12.5 %, Brier 0.319 → 0.253, mean input tokens 39,600 → 28,400 (−28 %). The
    approved-fraud rate is higher than E004's, but E004's counted seven runs that ended on the
    search limit as correct `request_info`s (E005). Measured on the model's own decisions, it
    fell from 20.8 % to 12.5 %.
  - The hypothesis of under 20k tokens wasn't met.
  - 08 and 09 swapped places as the external case that auto-approves (the known gaps of #29,
    items 1 and 2), so the all-cases auto-approved fraud rate stays at 3.8 %.
- **Decision:** keep `review-v5` for its decisions. The next token cut is the budget itself: 4 →
  2 searches, about two fewer steps per review. Measure that against N2, N3 and 06, which need a
  search to decide. Prompt caching on a paid model (#30) cuts the price of the steps that remain.

## E008 — A budget of 2 searches: fewer tokens, worse decisions (reverted)

- **Hypothesis** (#31, from E007): with 2 searches instead of 4, each review has about two
  fewer steps, so mean input tokens fall towards 20k; N2, N3 and 06, which need a search to
  decide, still get theirs.
- **Change** (#31): the default `AGENT_MAX_WEB_SEARCHES` drops from 4 to 2. Prompt `review-v5`.
- **Before → after** (E007 → E008): gated: **65.5 % → 51.7 % accuracy, 12.5 % → 16.7 %
  approved-fraud rate**, 0.0 % → 0.0 % auto-approved fraud rate, **Brier 0.253 → 0.365**,
  autonomy accuracy 72.4 % → 65.5 %. All cases: 61.3 % → 48.4 % accuracy. **Mean input tokens
  per review: about 28,400 → 21,100 (−26 %)**; latency 38.8 s → 34.8 s.
- **What went wrong or surprised:**
  - **Two searches aren't enough for this model.** It spends both on its first guesses and is
    refused the one that would settle the case. 02 now approves fraud, 06 loses the band's other
    date and no longer rejects, and N2 drops from approve to request_info. N4, a legitimate
    event, escalates because its approval came with the budget spent.
  - **Confidence stopped following the evidence:** Brier is worse than E004's. The gain of
    E007 is lost.
  - The token cut is real, but each saved token cost accuracy. Tokens matter for the paid
    model, but decisions matter more.
- **Decision:** revert to a budget of 4 and restore E007's recordings (E009). #31 ends at about
  28k tokens (−28 % from E004). What's left of the cost is the prompt caching of the paid
  adapter (#30): the steps that remain are mostly a prefix sent again.

## E009 — Back to a budget of 4

- **Hypothesis:** restoring the budget of 4 and E007's recordings gives E007's metrics back
  exactly.
- **Change** (#31): `AGENT_MAX_WEB_SEARCHES` defaults to 4 again; E007's recordings are restored
  from git and replayed with no model.
- **Before → after** (E008 → E009): gated: 51.7 % → 65.5 % accuracy, 16.7 % → 12.5 %
  approved-fraud rate, 0.0 % → 0.0 % auto-approved fraud rate, Brier 0.365 → 0.253, mean input
  tokens about 21,100 → 28,400. The same as E007.
- **What went wrong or surprised:** nothing; the replay matches E007.
- **Decision:** keep. This is where #31 ends.

## E010 — An approval never contradicts the code

- **Hypothesis** (#33): 11 and 15 become `request_info`; the gated approved-fraud rate drops from
  12.5 % to 4.2 % and accuracy rises from 65.5 % to 72.4 %; the auto-approved fraud rate stays
  at 0; no legitimate case changes.
- **Change** (#33, ADR 0012 amendment): a model `approve` with a negative system finding becomes
  a `request_info` that asks about each flag. Replayed from E009's recordings with no model: the
  change comes after the model, so its requests don't change.
- **Before → after** (E009 → E010): gated: **65.5 % → 72.4 % accuracy, 12.5 % → 4.2 %
  approved-fraud rate**, 0.0 % → 0.0 % auto-approved fraud rate, Brier 0.253 → 0.198. All
  cases: 61.3 % → 67.7 % accuracy, 19.2 % → 11.5 % approved-fraud rate, 3.8 % → 3.8 %
  auto-approved fraud rate. Tokens unchanged.
- **What went wrong or surprised:**
  - As predicted, only 11 and 15 changed, both to the expected decision, and both still
    escalate. Their flags are heuristics.
  - **The Brier gain is partly an artefact.** The held-back request keeps the model's confidence
    in approving (0.85 in 11, 0.95 in 15), and now that the decision is right, that confidence scores as well
    calibrated. The model's own calibration didn't change.
  - The one gated fraud the model still approves is 23 (previous fraud reports). No system check
    flags it, and the policy escalates it because the search budget was spent.
- **Decision:** keep.

## E011 — An exact clone is caught in code

- **Hypothesis** (#35): 07 resolves its `reject` on its own, on a rule hard signal. Gated
  autonomy accuracy goes from 72.4 % to 75.9 % and escalation from 72.4 % to 69.0 %; accuracy
  and the approved-fraud rate don't move; no other case changes.
- **Change** (#35, ADR 0012 amendment): a rule fails `exact_duplicate_other_organizer` when
  another organizer's similar event has the same title, venue and Madrid day. Only 07 has
  similar events, so only 07's request changed and only 07 was re-recorded.
- **Before → after** (E010 → E011): gated: accuracy 72.4 % → 72.4 %, approved-fraud rate 4.2 %
  → 4.2 %, auto-approved fraud rate 0.0 % → 0.0 %, **autonomy accuracy 72.4 % → 75.9 %,
  escalation rate 72.4 % → 69.0 %**, Brier 0.198 → 0.199. Mean input tokens about 28,400 →
  28,200, since 07 searched less with the clone already found.
- **What went wrong or surprised:** as predicted, only 07 moved. Its confidence fell from 0.85
  to 0.75, which is what nudged Brier up. A `reject` on a rule hard signal resolves whatever the
  confidence, so 07 resolves at 0.75.
- **Decision:** keep.

## E012 — A copied description is caught in code

- **Hypothesis** (#37): 08 becomes `request_info` + `escalated`, as expected, and joins the gate
  without moving any other case: a heuristic system warning already holds back an approval (#33).
- **Change** (#37, ADR 0015 amendment): a check in code searches the description's longest
  sentence and warns on `text_originality` when another page holds it word for word. 08 searches
  its authored pages and was re-recorded. The 20 real-web event cases found no copy, so what they
  send the model didn't change: only the new search was recorded for them (20 Tavily credits),
  keeping their model answers. 08 dropped `requires: ["external"]`.
- **Before → after** (E011 → E012): gated, now 30 cases with 08: **accuracy 72.4 % → 73.3 %**,
  approved-fraud rate 4.2 % → 4.0 %, auto-approved fraud rate 0.0 % → 0.0 %, escalation rate
  69.0 % → 70.0 %, autonomy accuracy 75.9 % → 76.7 %, Brier 0.199 → 0.195. On all 31 cases,
  **auto-approved fraud 3.8 % → 0.0 %**: 08 was the one fraud case that resolved on its own.
  Mean input tokens about 28,200 → 28,000.
- **What went wrong or surprised:** nothing in the metrics. A real search for an invented
  sentence still returns pages (Instagram reels, YouTube videos) that share some of its words,
  which is why a result must hold the whole sentence.
- **Decision:** keep.

## E013 — Claude Haiku 5.5 on the same prompt and cases

- **Hypothesis** (#30, from #15): a larger model raises gated accuracy above the latest qwen entry
  (E012: 73.3 %) and lowers the approved-fraud rate (E012: 4.0 %), with the gated auto-approved
  fraud rate still at 0. If accuracy doesn't move, the remaining errors (#29) are design limits.
- **Change** (#30): a new Anthropic adapter on the official SDK; `claude-haiku-5-5` with adaptive
  thinking at effort `medium`, automatic prompt caching and no sampling parameters (the API
  rejects them). Same prompt (`review-v5`), cases, checks and policy as E012. One recording pass
  of the 31 cases; the venue responses (OpenStreetMap) were re-recorded with it and drifted only
  in ids and tags, which the qwen set still replays against unchanged.
- **Before → after** (E012 qwen → E013 Haiku), gated, 30 cases: **accuracy 73.3 % → 90.0 %**,
  **approved-fraud rate 4.0 % → 0.0 %**, auto-approved fraud rate 0.0 % → 0.0 %, escalation rate
  70.0 % → 83.3 %, **autonomy accuracy 76.7 % → 70.0 %**, Brier 0.195 → 0.130. Mean tokens in /
  out about 28,000 / 1,400 → 13,700 / 2,400 (half the steps: 76 model calls against 195; the
  output includes thinking). Mean model latency 39.3 s → 11.4 s. Cost of the pass: about
  **$0.064, $0.002 per review** (54 % of the input read from cache); 56 Tavily searches against 112.
- **What went wrong or surprised:** Haiku is right more often but sure less often. Its
  confidence clusters at 0.60–0.80, below the 0.85 auto-approve threshold, so three legitimate
  events (N2–N4) are approved correctly but escalate, and 01 asks for information where qwen
  rejected on its own. The errors moved: qwen's were rejections where a question was expected
  (12, 14, 17, 18); Haiku's are questions where a rejection was expected (01, 06; 21 fails on both). This is
  one pass with a model whose sampling can't be pinned, so case-level differences may be noise.
- **Decision:** provisional. Haiku leads on what matters most (accuracy, approved fraud,
  calibration) at a negligible cost; the default model changes (ADR 0008 point 5) only after
  repeated runs confirm the gap, and the threshold isn't lowered to chase autonomy on one pass.

## E014 — Claude Haiku 5.5 over three runs per case

- **Hypothesis** (#42): Haiku's gated accuracy stays above qwen's E012 (73.3 %) in every run and
  its approved-fraud rate stays at 0; case-level disagreement concentrates in the 0.60–0.80
  confidence band.
- **Change** (#42): runs 2 and 3 of the 31 cases recorded next to E013's run 1, each with its own
  fence nonce; same model, effort `medium`, prompt `review-v5`, cases, checks and policy. The
  history entry now holds means with the min–max of the decisive metrics. Cost of the two passes:
  about $0.14 (31 cases × 2 runs, $0.0022 per review), plus one case re-recorded (below).
- **Before → after** (E013, one run → E014, mean over three, min–max), gated, 30 cases:
  **accuracy 90.0 % → 86.7 % (83.3–90.0)**, **approved-fraud rate 0.0 % → 0.0 % (0.0–0.0)**,
  auto-approved fraud rate 0.0 % → 0.0 % (0.0–0.0), escalation rate 83.3 % → 85.6 %, **autonomy
  accuracy 70.0 % → 67.8 % (66.7–70.0)**, Brier 0.130 → 0.144. Mean tokens in / out about
  13,700 / 2,400 → 15,000 / 2,600; mean model latency 11.4 s → 12.0 s.
- **The hypothesis holds.** The worst run's gated accuracy, 83.3 %, is 10 points above qwen's
  73.3 %, and no run approved a gated fraud. Only two gated cases split across runs, both in the
  band: 24 (`request_info 2/3 · reject 1/3`, 0.70–0.80) and N2 (`approve 2/3 · request_info 1/3`,
  0.60–0.72). External case 09 approved once in three runs (escalated, so the admin would see it).
- **What went wrong or surprised:**
  - E013's errors are not noise. 01, 06 and 21 fail in all three runs, and N3 and N4 escalate a
    correct approval in all three at 0.80: Haiku's underconfidence is systematic, so its autonomy
    gap is a calibration and policy question, not a sampling one.
  - Recording run 3 of N4, Wikidata timed out, and that response overwrote the one runs 1 and 2
    of both models replay against: three runs went stale. Fixed in this PR. A repeat run now only
    adds requests the case's file doesn't hold, so the repeat that saw a different response is the
    one that goes stale. The committed venue responses were restored, and only N4 run 3 was
    re-recorded (about $0.002).
- **Decision:** Haiku 5.5 is the evals' winner on accuracy and approved fraud, with ranges that
  clear qwen's single run, at $0.0022 per review. It becomes the deployed agent's model; the
  code's fallback stays on local qwen, so development runs keyless and free (ADR 0008 amendment,
  #42). Next: the systematic errors
  (01, 06, 21) and Haiku's confidence band against the 0.85 threshold, as separate experiments,
  each measured over three runs.
