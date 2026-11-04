# ADR 0015 — External evidence: venue checks run in code and can be required, web search can only hold back

- **Date:** 2026-11-03
- **Status:** accepted · amendment 2026-11-03 (#24) · amendment 2026-11-03 (#25) · amendment 2026-11-04 (#31)
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
