# Known limitations

What the review agent doesn't do well yet, and what was chosen not to do. Each entry gives the
symptom, its evidence and the fix that would close it. The list started in #29. An entry that gets
fixed moves to its own issue and leaves this page.

None of these lets gated fraud skip the admin: the auto-approved fraud rate is 0 % for every
recorded model (`evals/report.md`). Most of them cost the admin time, because a case escalates that could
have resolved itself.

## Chosen not to do

- **Images aren't analysed** (case 09, a poster with another ticketing site's logo or QR code).
  - **Why not:** image analysis is out of scope at this stage (decided 2026-11-04). Case 09 stays
    `requires: ["external"]`, outside the gate. This is ADR 0015's known gap.
  - **Fix:** a vision-capable model reads the cover. It needs no new provider.
- **No check for mixed scripts in a name** (case 20, a promoter's name with a Cyrillic letter).
  - **Why not:** it is a rare edge case on this platform, and a check isn't worth its upkeep
    (decided 2026-11-04).
  - **Today:** web search settles the case.

## Costs the admin time

- **Festivals in open spaces escalate** (N2).
  - **Symptom:** a park has no published capacity, and the event puts 6,000 tickets on sale per
    session. That is above the 300-ticket exposure cap (`EXPOSURE_CAP_TICKETS`).
  - **Fix:** a cap per capacity band or per venue type (`leisure=park`). Or accept this
    as the price of catching case 16.
- **Confidence is poorly calibrated.**
  - **Symptom:** in E014, Haiku 5.5 is right 86.7 % of the time but reports 0.60–0.80, so it
    escalates 85.6 % of gated cases. N3 and N4 escalate a correct approval at 0.80 in all three
    runs.
  - **Why it waits:** over-escalation is the safe error, since no gated fraud was approved in any
    of E014's three runs. Tuning the threshold on 31 cases would fit it to the test set, where one
    case is 3.3 points. So it waits for the deployed agent's own cases and the admin agreement
    rate.
  - **Fix:** tune `AGENT_AUTO_APPROVE_THRESHOLD` over several runs, or derive confidence from
    the evidence instead of the model's number.

## Seen on the first reviews of staging

Both reviews were escalated, so neither resolved anything on its own. They point at
calibration, above.

- **An already-held session passes.** `session_timing` measures sessions against publication,
  not against the review, so an event whose only session is in the past raises nothing. Such
  events only reach the agent on a first pass over an old feed, or after an edit. Fix: a check
  that a session has already started at review time.
- **A `reject` without direct evidence.**
  - **Symptom:** the model admitted there was no direct evidence of fraud and drafted a
    `request_info`, but still recommended `reject`.
  - **Fix:** the prompt prefers `request_info` in that case. The change has to be measured on
    the evals.
- **Noise in the findings.** The model also lists what it didn't check ("not searched") and adds
  weak arguments, such as how many tickets sold. Fix: prompt rules, measured on the evals.

## Operation

- **Public OpenStreetMap services aren't meant for production volume.**
  - **Symptom:** Overpass was at capacity and was replaced by Nominatim's reverse lookup
    (ADR 0015 amendment). Nominatim allows 1 request per second and asks scheduled tasks to
    cache.
  - **Fix:** a cache in the agent's store, or a Nominatim instance of its own.
  - **Today:** a pass reviews at most 10 subjects, throttled per provider.
- **A check's timeout is per HTTP request, not per check.** A check that makes several requests
  can take several times `PROVIDER_TIMEOUT_MS` (10 s).
- **An abandoned subject only shows in the logs.** After three transient failures the pass gives
  up on a subject and logs `run.abandoned` (ADR 0017 amendment). No alert is set on that line
  yet. Fix: a log-based alert in Cloud Monitoring.
- **The `unknown` capacity detail doesn't mention the exposure cap.** The policy then applies
  the 300-ticket cap, so the admin reads the reason in the escalation, not in the finding.
