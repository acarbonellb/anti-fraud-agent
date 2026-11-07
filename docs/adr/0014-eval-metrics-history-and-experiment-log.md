# ADR 0014 — Eval metrics are tracked in a machine-written history, explained in an experiment log, and CI enforces both

- **Date:** 2026-11-02
- **Status:** accepted · amendment 2026-11-04 (#42) · amendment 2026-11-05 (#57) · amendment 2026-11-07 (#102)
- **Related:** brief §4.3; ADR 0013 (the replayed evals and the report this builds on); ADR 0008
  (the evals choose the default model); issues #21, #6, #7 and #15.

## Context

ADR 0013 made `evals/report.md` deterministic and committed, so a PR's diff shows how it moved the
metrics. The report is a snapshot, though: each recording overwrites it, and the evolution of the
agent's performance lives only in git history, where nobody reads it.

Brief §4.3 asks for a loop: measure per model and prompt version, keep what works, retire what
doesn't. The changes that will move the metrics are already queued: the external tools (#7),
other models (#15), prompt versions, checks and policy thresholds. Each should show where it moved
the numbers and what was decided because of it, starting from a baseline.

The baseline, recorded on 2026-11-02, is a model that approves too easily: `qwen/qwen3.5-9b` with
prompt `review-v2`, at 59.1 % gated accuracy, a 38.9 % approved-fraud rate, a 0 % auto-approved
fraud rate and a Brier score of 0.302.

## Decision

1. **Numbers are generated; the narrative is written.** `evals/history.jsonl` is append-only and
   machine-written: nobody types a metric by hand. `docs/experiments.md` is the human log, with
   one `## E00N — title` section per history entry.
2. **A history entry** is one JSON object per line:
   - `id` (`E001`, `E002`…, with no gap) and `date` (UTC, `YYYY-MM-DD`, when appended);
   - `provider`, `model` and `promptVersions`;
   - `note`, one line saying what changed;
   - `gated` and `all`, each the `Metrics` of `src/evals/metrics.ts`, rounded to 4 decimals.

   An entry is never edited or deleted. A wrong one is corrected by a newer entry that says so.

3. **Runs append.** `pnpm eval` and `pnpm eval:replay` append one entry per recording set whose
   metrics or prompt versions differ from that set's latest entry, or that has none. A code-only
   change counts too: a policy threshold moves the metrics without re-recording. When they would
   append, they require `--note "<what changed>"`; without it they fail, write nothing and say how
   to call them. Recordings already made are kept.
4. **CI enforces it.** Besides ADR 0013's failures, `pnpm eval:replay --check` fails when a
   recording set has no entry or its current metrics differ from its latest one, and when
   `docs/experiments.md` has no section for some entry. A history that doesn't parse, or whose ids
   skip, fails too.
5. **An experiment section** states the hypothesis, the change and its PR, the key metrics before
   → after (from the history), what went wrong or surprised, and the decision (keep, revert or
   retire) with the next step.
6. **The report shows the evolution.** Each recording set gets a «History» section: a table of its
   entries (id, date, prompt, note, gated accuracy, approved-fraud rate, auto-approved fraud rate
   and Brier score) and a Mermaid `xychart-beta` line chart of the three rates over the entries.
   Both are deterministic, so the report still matches byte for byte in CI.
7. **Retirement stays manual.** A prompt version or model is retired by a decision in the
   experiment log, not automatically. Automating it waits for the online metric, the admin
   agreement rate (brief §4.3).
8. **The process carries it.** A change that moves eval metrics appends its entry and writes its
   section in the same PR (`CLAUDE.md` §5). A ticket that touches the prompt, a model, the tools,
   the checks or the policy states its **hypothesis** before it is `ready-for-agent`
   (`docs/agents/triage-labels.md`). The PR's Evidence shows the before and after entries and
   links the section (`github-pr` skill).

## Alternatives rejected

- **Rely on git history of `evals/report.md`.** The numbers are there, but nobody diffs a report
  across ten commits, and the reason for each change isn't.
- **A hand-written results table.** A typed metric drifts from what was measured; generated
  numbers can't.
- **Numbers and narrative in one file.** The machine would have to edit human prose, or humans
  would edit generated numbers. Keeping them apart, joined by the id, lets each be checked.
- **Append only when recording.** A policy threshold or a check moves the metrics with the same
  recordings; that change would go unrecorded.
- **Append without a note, or a default note.** The history would fill with entries nobody can
  explain, which is the problem this solves.
- **Retire prompts and models automatically on a metric drop.** With 31 offline cases, one
  case moves accuracy by 3–5 points. Retiring needs the admin agreement rate, which needs
  production.
- **Store full-precision metrics.** Floating-point noise in the last digits would read as a change
  and demand an entry; 4 decimals are finer than the report shows.
- **A database or a dashboard now.** Brief §8 brings Postgres and a dashboard later; a JSON Lines
  file in the repo is reviewable in the PR that changes it.

## Consequences

- Every PR that moves a metric carries a history line, an experiment section and the report diff.
  CI fails until all three agree.
- `evals/history.jsonl` is excluded from Prettier: it is machine-written, one entry per line.
- The latency mean is part of the stored metrics, so re-recording almost always appends an entry,
  even when no decision changed. That is intended: a new recording is a new measurement.
- Rewriting a past entry can only be caught in review: CI checks that the latest entry matches,
  not that earlier lines are untouched. The PR diff of `evals/history.jsonl` shows it.
- The first entry, E001, is the 2026-11-02 baseline, with its diagnosis in `docs/experiments.md`.

## Amendment (2026-11-04, #42): an entry can be the mean of repeated runs, with its spread

Claude Haiku 5.5 can't be pinned (API version 2026-10-21 rejects `temperature`), and a set
recorded once can't tell the model's noise from a real change: with 30 gated cases, one case moves
accuracy by 3.3 points. Each case can now be recorded several times in the same set. This extends
point 2 and point 4; nothing before it changes.

1. **Repeats live in the set.** Run 1 stays `<id>-<slug>.json`; run n is `<id>-<slug>.run-<n>.json`
   next to it, with `run: n` in the recording. Each run's fence nonce derives from the case id and
   the run index, so each repeat sends a different request, as each production review does, and
   still replays. Run 1 keeps the nonce it had, so every existing recording stays valid.
   `pnpm eval --runs N` (or `A-B`) records runs 1…N; without it, as many as the set already has
   (3 for a new set), so re-recording one case keeps its set whole.
2. **An entry gains optional `runs` and `spread`.** With `runs` (2 or more), `gated` and `all` are
   the means over the runs, and `spread` holds, for the gated and all cases, the minimum and maximum
   across runs of accuracy, approved-fraud rate, auto-approved fraud rate and autonomy accuracy.
   `cases` is one run's, `scored` the fewest any run scored and `failed` the most. Without `runs`,
   the entry is one run: E001–E013 stay as written and read that way. The two fields go together,
   or the line doesn't parse.
3. **`--check` compares means and ranges.** A set differs from its latest entry when a mean, a
   range or the number of runs moved.
4. **The CI gate reads each case's majority.** A gated fraud case fails the check when more than
   half of its runs approved it as `auto_resolved`; a single run is its own majority. Per case, the
   report counts how many runs agree (`reject 2/3`) and marks the case right only when a majority
   of its runs gave an expected decision: a tie is wrong.
5. **The report tells a mean from a single run.** The history table gains a **Runs** column, and a
   mean's cell shows its range: `90.0 % (86.7–93.3)`. Two entries differ only where their ranges
   don't overlap; a single run has no range to compare, which the Runs column makes visible.

### Alternatives rejected

- **Every run's full metrics in the entry.** The recordings already hold them, and the entry would
  grow with each run for numbers no decision reads.
- **The spread only in the report.** It would vanish with each re-recording; keeping the spread
  next to the mean is the point.
- **A standard deviation.** With 3 runs, the range is what reads honestly.
- **The gate fails on any run's auto-approved fraud.** One run in three would fail CI on noise the
  majority doesn't share. The report still shows it (`approve 1/3`).
- **Repeats as separate sets** (`claude-haiku-5-5#2`). The history would split one model into three
  series, and the report would show three tables to compare by eye.

## Amendment (2026-11-05, #57): the CI gate fails on any run that auto-approved fraud

This replaces the gate in point 4 of the #42 amendment. The report's per-case majority stays as it
is.

- **The gate.** A gated fraud case now fails `--check` when **any** of its runs approved it as
  `auto_resolved`. Before, it failed only when more than half of them did.
- **Why.** Majorities exist so that one noisy run doesn't move an accuracy metric. The gate
  guards the only outcome that skips the admin, and there a fraud case auto-approved in one run
  of three is a rate of about a third, not noise. An independent review of the repo (#57)
  flagged it.
- **Effect today.** None: every recorded run has an auto-approved fraud rate of 0 %.

**Rejected:** keeping the majority and reporting minority runs as a warning. A warning in CI
doesn't block a PR, and this is the one metric meant to block.

## Amendment (2026-11-07, #102): generated SVG charts replace the Mermaid chart

This replaces the Mermaid `xychart-beta` of point 6. The «History» table of each set stays.

- **The charts are SVG files drawn from the history.** `pnpm eval:replay` writes
  `evals/charts/accuracy-*.svg` (gated accuracy per entry, one line per set, the min–max band of
  repeated entries) and `evals/charts/rates-*.svg` (approved fraud with auto-approved fraud
  dashed, escalation, and the number of gated cases). Each comes in a light and a dark file that
  `<picture>` picks by `prefers-color-scheme`, which GitHub maps to the reader's theme.
- **The README carries a generated summary.** Each set's latest entry (gated cases, accuracy,
  approved and auto-approved fraud with their ranges, escalation) sits between two markers in
  `README.md`, rewritten by the same command.
- **CI checks both byte for byte.** `pnpm eval:replay --check` fails when a chart file or the
  README block differs from what the history draws, as it does for the report. They read only the
  history, so a code change that leaves the metrics alone leaves them alone too.
- **Why.** The README is what a visitor reads first, and it now opens with the results. A Mermaid
  chart can't draw a range, a legend or end labels, and it plots a missing value as 0. A
  screenshot would go stale on the next entry. Numbers typed into the README would drift from
  the history, which is what point 1 forbids.

### Alternatives rejected

- **An interactive page on GitHub Pages embedded in the README.** GitHub strips scripts and
  iframes from a README, so it could only be linked, and Pages on the free plan needs the repo
  public.
- **One SVG with a `prefers-color-scheme` media query inside.** In an `<img>` it follows the
  operating system, not the GitHub theme, so a reader with a dark GitHub on a light system would
  get dark text on a dark page.
- **A charting library to draw them.** The charts need a few lines, dots and labels; drawing them
  by hand keeps them deterministic with no dependency, at the cost of estimated text widths.
