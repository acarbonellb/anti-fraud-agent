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

## Gaps in the checks

- **The alcohol-to-minors rule reads one clause, and a colon doesn't end one** (#82).
  - **Symptom:** clauses end at `.`, `!`, `?`, `;`, `,` and line breaks, so "Fiesta +14, barra
    libre", a real offer split by a comma, gives no finding and rests on the model. The colon
    joins what follows to its head, so "Menores: zona infantil, cerveza para adultos", a benign
    sentence, fires a `minors_alcohol` rule `fail`, a hard signal that can let a model `reject`
    resolve on its own.
  - **Why:** case 24 needs the colon join ("para +14: música, cervezas y barra libre"), and the
    comma cut is what keeps "zona infantil para menores, y cerveza para adultos" quiet. Neither
    cost appears in the cases today (ADR 0012, amendment of #82).
  - **Fix:** an eval case for each sentence (group 10 of #81), then a clause rule that tells a
    list after a colon from a heading.
- **The organizer-history guard on event reviews is covered by unit tests only** (#82).
  - **Symptom:** removing `organizer_history` from event reviews fails no fooled-model run. Case
    23, the case it was meant for, still escalates on the exposure cap and the failed searches.
    No gated case pairs an otherwise clean event with a bad organizer history.
  - **Fix:** add that case (group 10 of #81), declared code-decided, so the fooled-model gate
    feels the guard (ADR 0013, amendment of #82).

## Costs the admin time

- **Only parks reach the open-space exposure cap** (#78).
  - **Symptom:** `OPEN_SPACE_TYPES` lists `leisure=recreation_ground` and `place=square`, but the
    venue check's `VENUE_TYPES` doesn't, so `nearestVenue` never matches a square or a recreation
    ground and a festival there keeps the 300-ticket cap.
  - **Fix:** add both to `VENUE_TYPES` when a real case needs them, with a venue lookup recording
    that shows the tags.

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
