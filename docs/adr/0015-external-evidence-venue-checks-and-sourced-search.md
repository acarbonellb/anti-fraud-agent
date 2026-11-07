# ADR 0015 — External evidence: venue checks run in code and can be required, web search can only hold back

- **Date:** 2026-11-03
- **Status:** accepted · amendment 2026-11-03 (#24) · amendment 2026-11-03 (#25) · amendment 2026-11-04 (#31) · amendment 2026-11-04 (#37) · amendment 2026-11-05 (#57) · amendment 2026-11-06 (#79) · amendment 2026-11-06 (#78) · amendment 2026-11-06 (#74) · amendment 2026-11-07 (#82)
- **Related:** brief §4.1, §4.2, §5 and §10.7; ADR 0008 (provider-neutral agent); ADR 0012 (the
  policy weighs evidence, not claims); ADR 0013 (recorded responses, external cases); ADR 0014
  (each change states its hypothesis); issue #7.

## Context

Brief §4.1 plans seven external tools: `verifyVenue`, `estimateVenueCapacity`,
`checkOrganizerPresence`, `checkArtistAvailability`, `checkTextOriginality`, `checkImages` and
`webSearch`. Brief §10.7 left their providers open. The first baseline (E001, ADR 0014) showed
where the exposure is: 7 of the 26 problem cases end `approve` + `auto_resolved` (26.9 %), and
every one is an external case (01, 02, 04, 05, 06, 08, 09). Without external evidence a confident
approval resolves on its own.

Four facts shaped the decision, gathered on 2026-11-02 from the providers' own pages:

- **Recorded responses meet licences.** Nearly every commercial geo, search and image API forbids
  storing or redistributing its results. Google Maps allows caching coordinates for 30 days, and
  Brave forbids caching and using results to benchmark AI. Only open data can be committed raw to
  a public repo: OpenStreetMap (ODbL, with attribution), Wikidata (CC0) and RDAP.
- **Venue capacity is rare in open data.** Of 7,706 venues in Spain in OSM, 46 (0.6 %) carry a
  `capacity` tag. Wikidata has 768 Spanish items with a maximum capacity (P1083), mostly stadiums
  and theatres. Bars and rooms almost never have one.
- **Built-in model search can't be replayed.** Anthropic's and OpenAI's search tools cost about
  $10 per 1,000 searches plus tokens, differ between providers, and Anthropic returns results
  encrypted. The local model (ADR 0008) has none. Bing's search API was retired on 2025-08-11 and
  Google's Custom Search API is closed to new customers.
- **The problem cases use invented organizers and artists** (CLAUDE.md §5). A real search for
  them finds nothing, so the fixtures for presence, tours and copied text must be written by hand
  anyway.

The model also invents passes: in #5 it marked `impersonation` as `pass` with no tool behind it.
ADR 0012 already counts a model `pass` for nothing. It left external evidence for this ADR.

## Decision

1. **Two external tools, not seven.**
   - **Venue checks**: `verifyVenue` and `estimateVenueCapacity`. Their input is the review
     context.
   - **`webSearch`**: a provider-neutral tool the model calls. It covers organizer presence,
     artist tour dates and copied text (cases 05, 06, 08 and 20), with sources.
   - `checkOrganizerPresence`, `checkArtistAvailability` and `checkTextOriginality` fold into
     `webSearch`. `checkImages` and domain age are dropped.
2. **Venue checks run in code, before the model, as system findings with sources** (as ADR 0012
   point 1 does for deterministic checks).
   - They run in parallel, each with a timeout.
   - A timeout, a `429` or a provider error yields `unknown`, with a `detail` that says so. There
     is no unbounded retry, and nothing is approved for lack of data.
3. **`verifyVenue` verdicts.**
   - **`pass`**: found, with a compatible place type (music venue, bar, theatre, events venue…),
     within about 200 m of the stored coordinates.
   - **`fail`**, as a heuristic: the address is a residential building, or the coordinates fall
     in water (case 04). It is not a hard signal, because OSM data can be wrong.
   - **`unknown`**: not found (case N5).
   - `permanentlyClosed` stays `null`: OSM rarely knows it, and the tool doesn't guess.
4. **`estimateVenueCapacity` tries a fixed order**: Wikidata P1083, then the OSM `capacity` tag,
   then `webSearch` with extraction and the source URL. If none has it, `unknown`. The comparison
   is per session, with the session's tickets on sale against the venue's capacity:
   - **at most 1×**: `pass`;
   - **above 1× and below 2×**: `warn`, a heuristic that escalates (case 02);
   - **2× or more**: `fail` and a hard signal with a source, so a `reject` may resolve on its own
     (case 01; brief §4.2's «several times the venue's»).
   - The 1× and 2× factors are provisional until the evals tune them.
5. **An event's auto-approval requires venue evidence** (ADR 0012's consequence):
   - `verifyVenue` is `pass`; and
   - capacity is `pass`, or it is `unknown` with **at most 300 tickets on sale per session**, the
     smallest `capacityBand`. This is the **exposure cap**.
   - Anything else escalates. A bar with 80 tickets and no published capacity can still resolve on
     its own (N3). 50,000 tickets in a warehouse of unknown capacity cannot (case 16). The cap is
     provisional.
6. **`webSearch` findings can hold back, never let through.**
   - A model finding backed by a `webSearch` source may escalate. On a hard-signal check it may
     resolve a `reject` on its own (ADR 0012 point 3).
   - It never counts towards an auto-approval.
   - Searches are bounded by `AGENT_MAX_WEB_SEARCHES`, and the results reach the model fenced as
     untrusted (brief D9).
7. **An organizer review never resolves on its own.** No structured evidence backs a new
   organizer once the presence tool is gone, so every organizer recommendation escalates, with
   the agent's proposal. No brief §5 case expects an automatic organizer approval.
8. **Providers.**
   - **Nominatim and Overpass** (OpenStreetMap) for the venue: free, no key, at most 1 request per
     second, attribution. The policy asks for a `User-Agent` that identifies the application, not
     an email, so the agent sends a fixed one with the repo URL and no personal data.
   - **Wikidata** for capacity: free and CC0.
   - **Tavily** behind `webSearch`: the free plan's 1,000 credits a month with no card is a hard
     spend cap. The adapter is replaceable without touching the tool.
   - Google Places, Brave and SerpApi are rejected for their terms.
9. **Recordings are taken at the provider boundary, with the request hash and staleness of ADR 0013.** Replay therefore exercises the code that reads and scores each response.
   - Each fixture carries `origin: "recorded" | "authored"`.
   - Open-data responses are committed as recorded, with attribution.
   - A commercial provider's response is committed only reduced to the fields the tool uses, or
     written by hand. The raw response stays out of git.
   - Responses about invented organizers, artists and texts are `authored`, and the report says
     so.
   - Recording against a provider needs the author's go-ahead per session (#7). The cap is about
     €10 overall.
10. **External cases lose their tag with the tool that settles them** (ADR 0013 point 5):
    - 01, 02, 04 and N5 with the venue checks;
    - 05, 06, 08 and 20 with `webSearch`;
    - 09 keeps it: it is the known gap (point 1).

## Alternatives rejected

- **The seven tools of brief §4.1.** Five providers, three keys and a card for about the same
  cases. Presence, tours and copied text would be structured, but their fixtures are written by
  hand, so the structure would prove little.
- **Let the model call every external tool** (brief §4.1 as written). The policy couldn't tell a
  check that ran from one the model skipped or claimed, the risk ADR 0012 closed for the
  deterministic checks.
- **Run `webSearch` in code too.** Its queries depend on what the case is about. Fixing them in
  code either misses what matters or spends the search budget on every review.
- **Require a known capacity for any auto-approval.** Open data has almost no capacity for bars
  and rooms. Every small legitimate event (N3) would escalate, for little exposure.
- **Ignore an unknown capacity once the venue is verified.** Case 16 (50,000 free tickets in a
  warehouse) would resolve on its own.
- **Treat a residential address or a point in water as a hard signal.** An auto-resolved `reject`
  would then hang on OSM data a volunteer may have mistyped.
- **The model's built-in search.** It can't be replayed (encrypted results), it differs per
  provider and it costs about $10 per 1,000 searches.
- **Google Places for the venue.** It has the best POI data, with business status and types, but
  its responses can't be committed, and its budgets only alert.
- **Reverse image search with Cloud Vision** (`checkImages`). It needs a GCP project with billing
  and a card, for one case (09). Too fine-grained for now.
- **Domain age via RDAP.** `.es` and `.eu` aren't in IANA's RDAP bootstrap, and the `.es` WHOIS
  answers only pre-authorised IPs. The fallback, the first capture in the Wayback Machine, means
  "first seen", not "registered".

## Consequences

- Brief §4.1 and §10.7 stay as design history. This ADR records where the agent departs from
  them.
- One new variable: `TAVILY_API_KEY` for `webSearch`. The venue checks need none.
- Nominatim's policy limits scheduled tasks to 4 requests per minute and asks clients to cache.
  Recordings cover the evals. The scheduled agent (#8) will need a cache, and if volume grows, a
  contact email or its own Nominatim instance.
- Case 09 (a poster with another ticketing site's logo and QR code) stays external and ungated: a
  known gap. A vision-capable model could close it later with no new provider.
- Hypotheses, measured against E001 (ADR 0014):
  - **Venue checks:** cases 01, 02, 04 and N5 join the gate, and the all-cases auto-approved fraud
    rate drops from 26.9 % to 15.4 %. N1 and N3 stay automatic approvals, which needs N1 at a real
    room with a published capacity.
  - **`webSearch`:** the rate drops towards 3.8 % (case 09 only), if the model uses search well.
    A small local model may not, and that is a result too.
- Case 20 (a homoglyph in the promoter's name) could also be caught by a deterministic
  mixed-script check, without search. That is left open.
- The 300-ticket exposure cap and the capacity factors are thresholds the evals should tune, like
  ADR 0012's.

## Amendment (2026-11-03, #24): Nominatim's reverse lookup replaces Overpass

Point 8 named Overpass for what lies at the event's coordinates (building tags, water). While
#24 was built, on 2026-11-03, every public Overpass instance tried (`overpass-api.de`,
`overpass.private.coffee`, `overpass.kumi.systems`, `maps.mail.ru`) answered `502 … at capacity`
or timed out, and the main one asks automated clients to run their own instance. A check that
depends on it would mostly yield `unknown`, and the recordings would show that, not the agent.

1. **Nominatim's `reverse` (zoom 18, with the address) answers the same two questions**, and is
   asked only when the name search doesn't verify the venue:
   - a `building` of a residential type (`apartments`, `house`, `residential`…) is the
     residential `fail` of point 3;
   - no city, town, village or municipality in the address, a water feature, or nothing found
     at all is the "in water" `fail`. Spanish municipalities end at the coast, so a point at sea
     resolves to the country only (case 04 does).
2. **One OSM provider instead of two.** Both calls share Nominatim's throttle (1 request per
   second) and the run's memo, so the usage policy of point 8 covers them.
3. **Unchanged:** both verdicts stay heuristics (OSM data can be wrong), and a failure of the
   lookup is `unknown` with a `detail` that says so.

Rejected: keeping Overpass with retries (point 2 forbids unbounded retries, and a review would
wait on an overloaded server); running our own Overpass instance (an operation to run for two
heuristics, deferred to the scheduled agent, #8, if volume grows).

## Amendment (2026-11-03, #24): organizer requests escalate too

Point 7 overrides ADR 0012 point 3 for organizers: a mechanical `request_info` about an
organizer (case 22, a wrong tax-id checksum) now escalates too, as #24 asks ("An organizer
review never resolves on its own"). The case keeps the brief's expected `auto_resolved`, so the
eval reports what the rule costs instead of hiding it. Whether a rule finding about an organizer
should resolve a request on its own again is open: it is the one place the two ADRs disagree.

## Amendment (2026-11-03, #25): what counts as a `webSearch` source, and where searches are recorded

1. **A model finding is sourced only by a URL a tool retrieved in the same run.** Point 6 lets a
   finding "backed by a `webSearch` source" resolve a `reject`. Since #5, the policy had counted
   any URL the model wrote. The loop now collects the URLs that tools return (`web_search`
   results), and the policy counts a model source only if it is one of them. A URL the model
   wrote from memory or invented is a claim, like a model `pass` (ADR 0012).
2. **Searches are recorded at the `WebSearch` boundary, inside each model's recording.** The
   model chooses the queries, so the searches of one model's run don't apply to another's. The
   record keeps only url, title and a snippet of up to 500 characters, never Tavily's raw
   response. The venue providers' HTTP responses stay shared per case
   (`evals/tool-responses/`).
3. **Authored cases search authored pages in both modes.** Cases 05, 06, 08 and 20 carry hand-
   written pages on `.test` domains, built from the case's clock. Any query, from the model or
   the capacity fallback, is matched against them by its words, in code. Nothing about invented
   entities is sent to Tavily, and the report marks those cases "authored web results".
4. **The capacity fallback reads a number only from a page that names the venue**, and only next
   to a unit («400 personas») or right after «aforo de» or «aforo:». The page is the finding's
   source. It runs only when Wikidata and OSM publish nothing, and only for a verified venue.

## Amendment (2026-11-04, #31): the search budget is soft, and repeats are refused

Refines point 6's bound on searches. In E004 a review cost about 39.6k input tokens instead of
about 10.4k. The whole conversation is sent again on every step, so each search costs more than
the last. Seven of the 31 cases spent all 10 searches, mostly rewording one query (case 14 sent
the same query three times). The 11th search ended the run, so the model's decision was lost
and replaced by a `request_info` at confidence 0.

1. **A search past `AGENT_MAX_WEB_SEARCHES` is refused, not run, and the run goes on.** The model
   is told no searches are left and decides with what it found. An approval then escalates,
   with the reason «web search budget spent» before any reason the policy gives: it may rest on
   what the model didn't get to read. A rejection or a request is weighed by the policy as
   usual, since more searching can't weaken a rule-based hard signal. In E005, escalating every
   such run turned the hard-signal rejections of 01 and 10 into escalations. Tool calls and
   tokens stay hard limits that end the run.
2. **The default budget drops from 10 to 4.** That is cheap now that spending it no longer ends
   the run. A budget of 2 was tried and reverted: it cut tokens by another 26 %, but gated
   accuracy fell from 65.5 % to 51.7 % (E008).
3. **A repeated query is answered from the run, not searched.** A query with the same words as an
   earlier one (lowercased, without accents, punctuation or word order) gets "already searched"
   instead of results. It spends no search and no credit, and it still counts as a tool call. It
   doesn't catch near-misses such as an added word: those spend the budget.
4. **Each search gives the model 3 results by default, with 300-character snippets.** It used to
   give 5 results with 500 characters. The recorded search keeps 500 characters (amendment #25,
   point 2): the capacity fallback reads its number from the longer text.

Rejected:

- **A lower hard limit:** it would end more runs and lose more decisions.
- **A budget of 2:** see point 2, E008.
- **Escalating every run that spent the budget:** see point 1, cases 01 and 10 in E005.
- **Fuzzy matching of repeats** (word overlap): it would refuse a search that adds the word that
  matters, such as a city or a date.

## Amendment (2026-11-04, #37): one mechanical search runs in code, for copied text

Refines the rejected option «run `webSearch` in code too». It was rejected because queries depend
on the case. One query doesn't: whether a description was copied is asked the same way of every
event. Left to the model, case 08 (a description copied word for word from another ticketing
site) was approved at 0.95 in E004: the 9B model searched the theatre's capacity, never the text.

1. **`copiedTextCheck` searches the description's longest sentence, quoted, before the model.**
   It takes the first 25 words of that sentence. A description whose longest sentence has fewer
   than 8 words isn't searched: «Plazas limitadas» is boilerplate, not a fingerprint. It costs
   1 search per event (1 Tavily credit), outside the model's search budget.
2. **A result counts only if it holds the whole sentence word for word**, ignoring case, accents
   and punctuation. A search engine answers a long query with pages that merely share its words.
3. **A copy gives a heuristic `text_originality` `warn`, with the pages as sources.** It is not a
   hard signal: an organizer may publish its own text elsewhere. A heuristic system warning
   already holds back an approval (ADR 0012 amendment, #33) and escalates, which is what case 08
   expects. No copy found gives no finding, since it proves nothing; neither does search being
   down.
4. **The check's search is recorded like any other, inside the model's recording.** Adding it
   didn't change what the 20 real-web event cases send the model (no copy found), so only that
   search was recorded for them, without re-running the model. Case 08 has authored pages and was
   re-recorded. It joins the gate (E012).

Rejected:

- **A prompt that tells the model to search the text:** free, but it rests on a 9B model
  remembering to, which E004 showed it doesn't.
- **A `pass` when no copy is found:** system findings win, so it would silence a model finding of
  a copy found with other words or on another page.
- **Searching every sentence:** more credits per event for texts that copy one paragraph whole.

Open: an edited event that is already published may find its own page on Satella. The check can't
tell that page from a copy without Satella's public host, which this repo doesn't hold.

## Amendment (2026-11-05, #57): a capacity read from the web only holds back

This brings point 4's third step into line with point 6. Before, a capacity extracted from a
search snippet scored like Wikidata's or OSM's. Within it, it gave `venue_capacity: pass`, which
satisfies point 5's venue evidence for an auto-approval. At 2× or more it gave a sourced
`capacity_far_above_venue: fail`, a hard signal that could resolve a `reject` on its own. An
independent review of the repo (#57) pointed out that the organizer names the venue, and a
snippet only has to contain that name. One page saying "Sala X, aforo de 5.000 personas" could
clear the exposure cap.

1. **Within a web capacity, the finding is `venue_capacity: unknown`.** It keeps the source and
   says the figure, but point 5's exposure cap decides the approval as if no one published one.
2. **Above it, at any factor, the finding is `venue_capacity: warn`.** It escalates, and the
   admin reads the web's figure with its source. It is never a hard `fail`.
3. **Wikidata and OSM are unchanged.** Point 4's 1× and 2× factors still apply to them.

**Rejected:**

- **A stricter name match for the snippet.** It would still let one page vouch for the venue.
- **Dropping the web step.** The admin would lose a sourced figure that often explains an
  escalation.

The change rewords a system finding the model sees, so the 14 affected cases were re-recorded
(E015 for Haiku 5.5, E016 for qwen). The gate holds, and in E016 a wrong automatic rejection
(case 17) now escalates.

## Amendment (2026-11-06, #79): a mechanical organizer request resolves on its own

Replaces point 7 and the amendment «organizer requests escalate too» (#24) for `request_info`,
which settles the disagreement with ADR 0012 point 3 that amendment left open. Point 7's reason
is that no structured evidence backs a new organizer. That reason holds for an `approve` and a
`reject`, which judge who the organizer is. It doesn't hold for a mechanical request (glossary),
which asks the organizer to fix what a rule found: a CIF whose control letter doesn't match
(case 22) is wrong whoever the organizer is, and anyone can check it with the rule.

1. **An organizer `request_info` is weighed like an event's** (ADR 0012 point 3): it resolves on
   its own only when every negative finding is a `rule` system finding, there is at least one,
   no model finding is negative, and confidence is at the threshold.
2. **Any other organizer review still escalates**: an `approve`, a `reject`, and a request with
   a heuristic finding (case 21's `organizer_history`, an owner with a rejected organization) or
   a negative model finding.
3. **Nothing reaches Satella differently.** In Satella only an auto-resolved approval skips the
   admin (ADR 0012), so the request still waits for an admin there. What changes is the
   recorded autonomy, and with it the escalation rate the evals report.

Rejected:

- **Keep every organizer review escalated.** The eval then counts case 22 as an escalation the
  admin didn't need, and the escalation rate overstates the admin's work by that case.
- **Also resolve an organizer `reject` on a rule-based hard signal.** No organizer check yields
  one today, and a rejection of a new organizer is the decision point 7 meant to keep human.

Hypothesis (ADR 0014): case 22 resolves on its own and the escalation rate falls by that case.
Accuracy and the auto-approved fraud rate (0 %) don't move, since only the autonomy changes.

## Amendment (2026-11-06, #78): the exposure cap depends on the venue type

This refines point 5. A festival in a park has no published capacity, so with a flat cap of 300
it escalated whenever a session put more on sale. N2 (a three-day festival in a park, 6,000
tickets in its first session) escalated in every run for that reason, and so would any open-air
festival in the feed.

1. **The cap goes by the verified venue's OpenStreetMap `category=type`.**
   - **Open space** (`leisure=park`, `leisure=recreation_ground`, `place=square`): **10,000**
     tickets on sale per session (`OPEN_SPACE_EXPOSURE_CAP_TICKETS`).
   - **Any other or unknown type:** the 300 of point 5 (`EXPOSURE_CAP_TICKETS`). A venue that
     doesn't verify has no type, and keeps the prudent cap.
   - The list (`OPEN_SPACE_TYPES`) is short and grows when a real case needs it (a beach, a
     fairground).
2. **10,000 is a starting value chosen from one case.** N2 puts 6,000 on sale in one session,
   so 5,000 would leave it escalating. To be revised with real festivals from the feed.
3. **The capacity finding carries the type** (`SystemFinding.venueType`), so the policy reads
   it with the verdict it already weighs. Only a verified match sets it.

Point 3's venue types include `leisure=park` but not yet `leisure=recreation_ground` or
`place=square`: a venue tagged so doesn't verify, and escalates before the cap matters. They are
listed so the cap is ready when point 3 admits them.

**Rejected:**

- **A cap per capacity band** (the spec's other option). The band comes from the tickets the
  organizer puts on sale, so it would raise the cap exactly when the organizer asks for more.
  The venue type comes from OSM.
- **No cap for open spaces.** Any "park" with 50,000 tickets would resolve on its own.
- **5,000.** Below N2's 6,000 per session.

Case 16 (a free rave with 50,000 tickets) is in a pub and still escalates.

## Amendment (2026-11-06, #74): a venue without coordinates is verified by name and town

Extends point 3. Point 3's `pass` needs the stored coordinates, and until now a venue without
them was `unknown` with no lookup at all. On the first staging pass (2026-11-05) a real theatre
stored without coordinates was reported as unknown, and the review escalated on it.

1. **Without coordinates, the name search adds the province** (`name, town, province`; left out
   when it repeats the town). It shares the throttle, the timeout, the User-Agent and the run's
   memo with the other Nominatim calls (points 2 and 8). A venue with coordinates is looked up
   exactly as before, so its recordings stay valid.
2. **A `pass` needs a place of a compatible type that carries the venue's name and lies in its
   town.**
   - The name matches when its words are the same, or when the shorter name's words, at least
     two, are all in the longer one (`Teatro Principal` and `Teatro Principal de Zamora`).
     `Teatro` alone matches only a place named just that: it is in every theatre's name.
   - The town must be one of the components of Nominatim's address (`display_name`).
   - The finding's source is the place's OSM page, and its `detail` says it was matched by name
     because the event has no coordinates.
3. **Anything else stays `unknown`**, with a `detail` that says the event has no coordinates. With
   no point to look at, there is no reverse lookup and so no residential or in-water `fail`.
4. **The match feeds `estimateVenueCapacity`** as a coordinate match does (point 4): the same
   Wikidata, OSM tag and web steps, and the same exposure cap (point 5).

Rejected:

- **Accept the first compatible result.** Nominatim ranks loosely: a search for one theatre of a
  town may return another, and an invented venue would borrow a real one's verification.
- **Put the postal code in the query.** The organizer types it, and case 03 is a postal code of
  another province: a wrong one can push the real venue out of the results. The postal code
  check (`postal_code_province`) already judges it.
- **Geocode the street address.** It finds a point, not a venue, and the point would then need
  the 200 m test against a place found by the same organizer-typed text.

Hypothesis (ADR 0014): the new case N6 (a real theatre without coordinates, invented company)
verifies the venue and resolves its approval on its own instead of escalating on an unknown
venue, so the escalation rate falls by that case. The auto-approved fraud rate stays at 0 %:
the cap of point 5 still applies, and a venue no source names stays `unknown`.

## Amendment (2026-11-07, #82): search fails closed, every search is counted, money has a cap, history runs on events

Four changes from the review of #81 (groups 1 and 2). Every live search in both committed
recording sets had returned `quota_exceeded` (176 of 176 for Haiku, 109 of 109 for qwen), and
nothing showed it: a search outage read as "nothing found".

**1. A failed search fails closed, for approvals only.** This extends point 6: web search can only
hold back, and now its absence holds back too.

- The policy input gains `searchUnavailable`: true when any search of the run failed (the
  copied-text check's, the capacity fallback's or the model's). Like `searchBudgetSpent`
  (amendment of #31), it holds back an `approve` only, with the reason `web search unavailable`.
  A rejection or a request is decided by its evidence, as before: a missing search can't make a
  fraud signal weaker.
- The copied-text check (amendment of #37) returns `text_originality: unknown` (heuristic), with a
  Spanish detail saying the search couldn't run, instead of no finding. It is not a negative by
  itself; `searchUnavailable` does the holding back.
- The model's `web_search` still tells the model the search is unavailable. Its trace entry is
  now `ok: false` with the stable code `WEB_SEARCH_FAILED`.
- **Why approvals only.** An approval nobody could check against the web shouldn't skip the
  admin, which is how an unverified venue is already treated (point 5). With the search quota
  exhausted, no event approval resolves on its own: every one reaches the admin. That is the
  intended trade; alerting on it is the next spec (group 6 of #81).

**2. Every search a review runs is counted.** `reviewEvidence` wraps the search once per review
(`countSearches`, `src/search/counting.ts`): every call through it is counted, and every
`WebSearchError` it sees counts as failed. `RunResult.searches` and the run document carry
`{ total, failed }`, the credits the review spent. `webSearches` keeps meaning the model's
searches, the budget of the amendment of #31. The counts are per attempt: a re-review after a
stale subject starts from zero, and a review that failed adds nothing to the pass totals. The
pass report sums both, and `evals/report.md` gets one line per recording set, "Live web searches:
X failed of Y attempted", over recorded searches only (the authored corpus never fails). A set
recorded while every search failed says so next to its metrics.

**3. A money cap next to the ticket cap.** This refines point 5 and the amendment of #78. The
per-session ticket cap stays: it is the room-overselling guard (case 16). It doesn't see money
or sessions: ten sessions of 300, or 300 tickets at 950 €, resolved as readily as one session of
300 at 8 €.

- **Money on sale** is the sum, over scheduled sessions, of each standard ticket type's capacity
  × price, in integer cents (`moneyOnSaleCents`, next to `maxTicketsOnSale` in
  `src/checks/tickets-on-sale.ts`). The policy's event subject carries it, so the reason and the
  decision read the same number.
- When the venue's capacity is `unknown`, an approval also escalates when the money on sale is
  above the cap, with a reason that states both amounts in euros ("capacity unknown with
  16.800,00 € on sale, above the money cap of 15.000,00 €"). A free event puts nothing on sale and
  is judged by the ticket cap alone.
- **Two caps, by venue type**, as the ticket cap goes (amendment of #78): **15.000 €**
  (`MONEY_CAP_CENTS`), the 300-ticket cap at 50 € a ticket, and **1.000.000 €** for an open space
  (`OPEN_SPACE_MONEY_CAP_CENTS`). One cap can't do both: N2, a legitimate three-day festival in a
  park, puts 590.000 € on sale and must resolve, while case 13 puts 266.000 € on sale in a room
  and must escalate. Both values are provisional, like the ticket caps.

The evidence, money on sale per case with the capacity the venue checks reach (fooled-model run,
web as recorded; computed from the case fixtures):

| Case | Expected                  | Venue (capacity)      | Most tickets per session | Money on sale |
| ---- | ------------------------- | --------------------- | -----------------------: | ------------: |
| N1   | approve, auto             | pass                  |                      350 |       6.300 € |
| N2   | approve, auto             | park, unknown         |                    6.000 |     590.000 € |
| N3   | approve, auto             | unknown               |                       80 |         640 € |
| N4   | approve, auto             | unknown               |                      250 |      0 (free) |
| N5   | request_info, escalated   | not verified, unknown |                      300 |       3.600 € |
| N6   | approve, auto             | unknown               |                      250 |       3.720 € |
| 04   | reject or request, escal. | fails, unknown        |                      600 |      15.000 € |
| 05   | reject, escalated         | unknown               |                      250 |       3.750 € |
| 06   | reject, escalated         | unknown               |                      700 |      16.800 € |
| 07   | reject, auto              | unknown               |                      400 |      14.000 € |
| 08   | request_info, escalated   | unknown               |                      180 |       5.040 € |
| 10   | reject, auto              | unknown               |                      150 |       2.700 € |
| 11   | request_info, escalated   | unknown               |                      450 |       7.200 € |
| 12   | request_info, auto        | unknown               |                      120 |       1.680 € |
| 13   | request_info, escalated   | unknown               |                      280 |     266.000 € |
| 14   | request_info, auto        | unknown               |                      400 |       9.650 € |
| 16   | request_info, escalated   | unknown               |                   50.000 |      0 (free) |
| 17   | request_info, escalated   | unknown               |                    3.000 |      45.000 € |
| 19   | request_info, auto        | unknown               |                      300 |      13.200 € |
| 23   | request_info, escalated   | unknown               |                      500 |      10.000 € |
| 24   | reject, auto              | unknown               |                      800 |       8.000 € |
| 25   | reject or request, escal. | unknown               |                      140 |       2.240 € |
| 26   | reject, auto              | unknown               |                      160 |       2.400 € |
| 27   | request_info, escalated   | unknown               |                      600 |      10.800 € |
| 28   | request_info, escalated   | unknown               |                      300 |       6.600 € |

- Every legitimate case resolves as before: the most a legitimate case of unknown capacity
  outside an open space puts on sale is 3.720 € (N6), and N2 is 410.000 € under the open-space
  cap.
- Above 15.000 € with capacity unknown: case 06 (16.800 €, also above the ticket cap), case 13
  (266.000 €) and case 17 (45.000 €, also above the ticket cap). For case 13 the money cap is the
  guard the code adds: before it, the case's approval was stopped only by `price_benchmark`, which
  needs a benchmark sample. The others of unknown capacity are held by their own findings (the
  fooled-model gate, ADR 0013 amendment of #82, checks it), and case 04 sits exactly at the cap,
  which is not above it.

**4. The organizer's history runs on event reviews.** Event preparation now reads the organizer's
review context (the event context carries `organizerId`) alongside the price benchmark and the
similar events, and runs the history part of the organizer checks on it
(`organizerHistoryChecks`): the same `organizer_history` heuristic findings, a `warn` for each of
rejected organizations of the owner and fraud reports on the organizer's events, a `pass`
otherwise. Its `warn` holds back an approval through `holdBackApproval` like any system negative.
If Satella can't serve the organizer's context, there is no history finding and the review goes
on, as with the other Satella reads. One more free read per event review, within the agent's
scopes.

- **Every fraud-category report counts, whatever its status**, as the organizer checks always
  counted them (the author's decision, 2026-11-07). An open report nobody has judged yet can be
  unfounded, but the finding is a heuristic `warn`: it only sends the review to the admin, who
  reads the count in its detail. Counting only actioned reports would leave the most recent
  fraud, the one not handled yet, to the model.

**Rejected:**

- **Treating a failed search as "nothing found"**, as before. It let an approval resolve on the
  web evidence nobody got, and it hid the outage from every metric.
- **Failing closed on every decision.** A `reject` resting on a rule or a sourced finding doesn't
  need the web; holding it back would only add admin work.
- **Counting the searches in each caller.** Three callers, three counts to keep in step; one
  wrapper per review is where they all pass.
- **One money cap for every venue.** No value lets N2 (590.000 €, park) resolve and keeps case 13
  (266.000 €, room) escalating.
- **A money cap without the ticket cap.** A free event of 50,000 tickets (case 16) puts nothing on
  sale.
- **Counting only actioned fraud reports** for `organizer_history`. See point 4.
- **Leaving the organizer's history to the model on event reviews.** It counted only if the model
  called `get_organizer_context` and chose to warn.
