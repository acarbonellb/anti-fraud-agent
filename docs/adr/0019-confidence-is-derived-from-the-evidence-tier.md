# ADR 0019 — A review's confidence is derived from its evidence tier, not taken from the model

- **Date:** 2026-11-06
- **Status:** accepted
- **Related:** ADR 0012 (the autonomy policy this changes; replaces point 3 of its amendment of
  #33), ADR 0015 (the venue evidence and the exposure cap the tiers read), ADR 0014 (how the
  change is measured), brief §4.2, issues #71 and #77.

## Context

`decideAutonomy` let a review resolve on its own only when the evidence allowed it **and** the
model's own confidence reached `AGENT_AUTO_APPROVE_THRESHOLD` (0.85). The evidence half is
computed in code from the findings (ADR 0012); the confidence half was the one number the policy
took from the model.

That number didn't track being right. In E015 Haiku 5.5 was right 85.6 % of the time on the
gated cases but reported 0.60–0.80, so 86.7 % of them escalated. Cases 03, 14, 19 and 22 (a
mechanical request backed only by a `rule` finding) and N3, N4 and N6 (a clean approval) had the
evidence to resolve and escalated only on that number. None of them is fraud.

Lowering the threshold would fit it to 31 cases, where one case moves a rate by 3.3 points, and
would still let a model that reports 0.9 on a thin case through.

## Decision

1. **The review's confidence is the evidence tier that backs the decision.** It is computed in
   code from the findings, and it is the number Satella and the store receive:
   - **0.95**: a `request_info` whose negative findings are all `rule` system findings, or a
     `reject` on a hard signal (a `rule` finding, or a source retrieved in the run). Anyone can
     re-check it with the rule or the source.
   - **0.90**: a clean `approve` with the venue and its capacity verified.
   - **0.85**: a clean `approve` of unknown capacity, under the exposure cap (ADR 0015 point 5).
     It rests on a limit of the damage, not on a fact about the venue.
2. **`AGENT_AUTO_APPROVE_THRESHOLD` means the lowest tier that resolves on its own.** It stays at
   0.85. Raising it to 0.90 makes approvals under the cap escalate, with the reason
   `evidence tier 0.85 below 0.9`. It is never tuned on the eval cases.
3. **An escalated review shows the model's number capped at 0.84**
   (`ESCALATED_CONFIDENCE_CAP`), so it never reads as confident enough to have resolved. A run
   that ended on a limit keeps its 0.
4. **The model's number can only hold back.** Below `MODEL_CONFIDENCE_FLOOR` (0.5), a review that
   would otherwise resolve escalates, whatever its decision; a review that escalates anyway gets
   no floor reason. The floor sits at even odds, not at a value fitted to the cases: it is a
   safety net for a model that doubts its own decision.
5. **The model's number is kept for comparison**: `modelConfidence` in the run result, the run
   document and the eval outcome. **The Brier score measures the model's number**, as it did
   before this ADR: a tier is a rank, not a probability, so a Brier over tiers would score a
   lookup table, and it would break the series from E001 to E024. The per-case confidence in the
   report is the derived one, since that is what the admin sees.
6. **Replaces point 3 of ADR 0012's amendment of #33.** A held-back approval no longer keeps the
   model's confidence in approving: as a mechanical request it shows 0.95, otherwise it
   escalates and shows at most 0.84.

A recommendation is defensible when its confidence can be explained from its findings: "0.95
because a rule found the postal code and the province disagree" can be argued with; "0.7 because
the model said so" can't.

## Alternatives rejected

- **Tuning the threshold** on the eval cases: it fits the test set, and it still trusts a number
  the model doesn't calibrate.
- **An additive formula** (weights per finding kind and source): every weight is a parameter to fit
  on 31 cases, and the result is harder to explain than a tier.
- **Recalibrating the model's number** (Platt or isotonic scaling per model): needs far more
  labelled cases than the evals have, and has to be redone for every model and prompt.
- **Dropping the model's number altogether**: it costs nothing to keep as a hold-back, and it is
  the only signal of a model that doubts its own decision.

## Consequences

- The tiers are ranks, not probabilities, and no eval metric scores them as if they were. The
  admin agreement rate on the deployed agent (#71, out of scope) is what can check them.
  E025 and E026 computed the Brier over the tiers; the entries after them read the model's
  number again and correct theirs.
- The policy has no model input left for a resolution beyond the floor: what resolves is what the
  findings allow. Making the policy stricter means changing a tier, a check or the threshold, each
  explained in code.
- A held-back approval no longer shows the model's confidence in approving. Its
  `modelConfidence` still is that number, so the Brier score keeps the flattery ADR 0012
  (#33 point 3) noted: it measures the model, held-back approvals included.
- `docs/known-limitations.md` loses "Confidence is poorly calibrated"; the prompt still asks the
  model for a confidence, which only feeds the floor and the comparison.
