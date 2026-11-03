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
