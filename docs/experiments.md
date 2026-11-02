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
