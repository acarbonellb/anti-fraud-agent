# ADR 0013 — Offline evals replay recorded model responses, and CI gates on fraud that skips the admin

- **Date:** 2026-11-02
- **Status:** accepted · amendment 2026-11-03 (#7) · amendment 2026-11-06 (#57)
- **Related:** brief §4.3, §5 and D8; ADR 0008 (local model first; the evals choose the default
  model); ADR 0012 (the autonomy policy the gate leans on); issues #6 and #7.

## Context

Brief §4.3 asks for the §5 dataset to run in CI per model and prompt version, with the
approved-fraud rate as the critical metric. Two facts constrain how:

- **A real model can't run in CI for free.** The local model (`qwen/qwen3.5-9b`, ADR 0008) needs
  a GPU, and a paid one costs money on every PR. A full run of the 31 cases takes about 20
  minutes, roughly 39 s per case and 10,700 input tokens per review. Two runs can also disagree.
- **Most of the agent isn't the model.** The Satella client and mock, the deterministic checks,
  the loop and the policy are ordinary code that a PR can break, and they decide what reaches
  the admin.

The first full recording, on 2026-11-02, produced these figures:

- **Gated cases:** 59.1 % accuracy and a Brier score of 0.302.
- **Approved fraud:** the model approved 7 of the 18 gated fraud cases (03, 11, 15, 16, 17, 18,
  23). Case 03's postal code belongs to another province, a rule finding the model ignored.
- **The policy:** it escalated all 7, so the admin would have seen each one.
- **External cases:** the only fraud that ended `approve` + `auto_resolved` was in them (01, 02,
  04–06, 08, 09). Those cases need the external tools of #7 to be caught, which makes 26.9 % of
  all fraud cases.

Issue #6 asked CI to fail when the gated approved-fraud rate is above 0. With honest recordings
that would keep CI red on every PR, over a number the policy already contains.

## Decision

1. **Two modes, one agent.** `pnpm eval` runs every case through the real agent and the configured
   model on the developer's machine, and records each response. That means `reviewSubject`, the
   Satella mock, the checks and the policy. `pnpm eval:replay` runs the same code with a provider
   that returns the recorded responses in order. Only the model is replaced; nothing in the
   agent knows it is being evaluated.
2. **A recording is valid only for the request it answered.** Each call is stored with the
   SHA-256 of the canonical JSON of its request (messages, tools, `maxOutputTokens`). If the
   prompt, a tool, a check's wording or a fixture changes the request, replay fails as
   **stale** instead of reusing an answer to a different question. A missing recording is stale
   too.
3. **Requests are reproducible by construction.**
   - Fixtures come from a clock the recording stores, and replay reuses it.
   - The untrusted fence's nonce and the run id derive from the case id.
   - Run limits and the threshold are the defaults, never the machine's environment.
   - `runReview` and `reviewSubject` take the prompt as an optional input, so a prompt change
     is visible to the hash.
4. **CI (`pnpm eval:replay --check`) fails on three things:**
   - a stale or missing recording;
   - any gated fraud case that ends `approve` + `auto_resolved`, the **auto-approved fraud
     rate**. In Satella that is the only outcome that skips the admin (ADR 0012).
   - an `evals/report.md` that differs from the replayed one.

   This refines #6. The approved-fraud rate stays in the report as the model-quality number,
   and it is not a gate.

5. **External cases run but aren't gated.** The 9 cases only #7's tools can settle carry
   `requires: ["external"]`. They are recorded, listed apart and measured in the «All cases»
   column, but stay out of the gate. They lose the tag when #7 lands.
6. **The report is committed.** Every behaviour change shows up in the PR diff as changed rows
   and metrics, and recordings and report are re-recorded together in the same PR.

## Alternatives rejected

- **Run the real model in CI.** It needs a GPU runner or a paid key on every PR, takes about 20
  minutes, and its nondeterminism would make a red build mean «try again».
- **Hand-written scripted responses per case.** They test the script, not a model, and produce
  no metric worth reporting. They stay where they belong, in the loop's unit tests.
- **Snapshot the final outcomes only, without request hashes.** A prompt change would replay
  old answers to questions no longer asked, and CI would stay green on a stale picture.
- **Re-record automatically when stale.** It costs money or GPU time, and it hides the very
  change the diff should show.
- **Gate on the approved-fraud rate at 0 (#6 as written).** It blocks every PR on model quality
  while the policy already escalates all 7 of those approvals. Better prompts and models move
  that number; the gate exists to stop code changes from letting fraud past the admin.
- **A ratchet on the approved-fraud rate.** It would accept 38.9 % today and still gate on the
  wrong outcome.
- **Leave the external cases out of the dataset until #7.** That loses the baseline that will
  show whether #7 works, and the 26.9 % that argues for prioritising it.

## Consequences

- Changing the prompt, a tool description, a check's `detail` text or a fixture means
  re-recording the affected cases locally: free on LM Studio, about 40 s each. Recording with a
  paid provider needs the author's go-ahead (CLAUDE.md §8).
- Recordings take about 290 KB per model and live in `evals/recordings/<provider>/<model>/`. The
  generated recordings and the report are excluded from Prettier, because CI compares the report
  byte for byte.
- Comparing models (ADR 0008 point 5) is one recording set per provider/model: the report has a
  section per set.
- The model's confidence is poorly calibrated (Brier 0.302), and the policy's
  `AGENT_AUTO_APPROVE_THRESHOLD` trusts it. Choosing that threshold, or a better source of
  confidence, is open.
- Rationale quality (an LLM judge plus a manual sample) is still unmeasured, a follow-up of #6.
- When #7 removes the `external` tags, those cases join the gate. If their approvals still
  resolve on their own then, CI goes red until the external evidence is required for an
  auto-approval (ADR 0012, consequences).

## Amendment (2026-11-03, #7): external evidence

ADR 0015 refines point 5: each external case loses its tag with the tool that settles it (venue
checks: 01, 02, 04, N5; `webSearch`: 05, 06, 08, 20), and case 09 stays external as a known gap.
External tool responses are recorded at the provider boundary with the same request hash and
staleness.

## Amendment (2026-11-06, #57): the cost of finding wording in the hash

The consequences above list a check's `detail` text among the changes that need re-recording.
That cost is wider than it looks. The system findings travel inside the first user message, so
rewording one Spanish `detail` stales every recording of every case where that check runs, not
only the case that motivated the change. A check that runs on every event stales the whole set.
For a paid recording set (Haiku 5.5 today), that means paid calls, which need the author's
go-ahead (CLAUDE.md §8).

The strict hash stays. The wording is what the model reads, so an answer recorded for other words
answers a different question, which point 2 exists to refuse.

- **Keep finding wording stable.** Change a `detail` text only when the change is worth a
  re-recording, and batch such changes so one re-recording pays for several.
- **Order the re-recording.** Record the free local set first, then the paid set once, then write
  the single history entry (ADR 0014), so no entry is written from a stale set.

**Rejected:** hashing a normalized request (wording stripped or templated). Replay would then
reuse an answer to words the model never saw, and a wording change that moves the model would
stay green in CI.
