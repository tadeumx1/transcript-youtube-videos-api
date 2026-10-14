# Search saved library content

Status: plan for task 1 of 10 approved by the owner on 2026-10-07 for the planning sequence.
Profile: `light` (repository default). This approval authorizes advancing review to task 2 and
does not authorize implementation.

## Problem

The owner can search a video title but cannot find a phrase saved only in an original transcript,
corrected transcript, summary, key point or personal note. `Store.videos` currently applies
`instr(lower(json_extract(data,'$.title')),lower(?))>0` only to video metadata. The owner has to
open individual readings to locate an idea whose wording is absent from the title. No frequency,
library size or performance measurements were supplied.

The owner will search saved content from the existing library screen, combine the search with
existing filters and open matching readings, including originals whose enrichment has failed.

## Flow

Reuse the existing library listing, authenticated API, SQLite content and session/revision guards.

1. The library search controls in `services/channel-library/web/main.tsx` (exists) send the query,
   selected scope and current filters to the existing list endpoint; query/scope changes reset page 1.
2. `services/channel-library/api/app.ts` (exists) authenticates and validates the request using the
   existing hooks and errors, then passes the selected scope to `Store.videos` (exists).
3. `services/channel-library/api/store.ts` (exists) applies literal matching against stored values,
   combines filters, counts each video once and reads the requested page from one SQLite read
   transaction; the response contains video metadata, not transcript bodies.
4. `services/channel-library/web/main.tsx` (exists) accepts only the current request revision and
   session, renders list/loading/empty/error states and opens the existing reader on selection.
5. `docs/library-reading-workflow.md` (exists) explains search scopes, literal matching and the
   distinction from semantic retrieval using examples that the owner can repeat.

The search reads the current stored content directly. It creates no index or materialized content
copy and invokes no worker/provider operation. A read transaction supplies one snapshot for the
count and page; the existing browser revision and session guards reject obsolete responses.

## Impact

| Front | What changes |
| --- | --- |
| domain | Search scope becomes explicit: `title` retains current title-only matching; `content` covers saved text; `all` covers both. The reader selects `all` by default. |
| API compatibility | Existing requests without `searchIn` retain their current title-only behavior. The existing response envelope and video metadata remain unchanged. |
| stored data | Nothing to migrate or backfill. Existing sources, enrichments and reading notes are searchable immediately; missing content contributes no match. |
| reader | A scope selector joins the existing search controls. Existing channel, status, favorite and read filters continue to combine with the search. |
| runtime | Content matching can scan large locally stored texts on the existing synchronous SQLite connection. This plan makes no latency or corpus-scale guarantee; an indexed search design is a separate proposal if measurements require it. |
| existing decisions | Conforms to AD-009, AD-013 and AD-015–AD-018: private telemetry, English UI/docs, independent storage and immutable originals. |

## Relations

None - no stored-data shape change. Read existing Video metadata, its optional Original and its
optional Enrichment. Reading notes remain owner metadata on the existing Video.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `GET /api/v1/videos` | existing filters and optional `searchIn=title`, `searchIn=content` or `searchIn=all`; omitted scope defaults to `title` | existing `{ items, total, page, pageSize }`; existing `{ error: { code, message }, requestId }` on failure | 200 success, 400 invalid query, 401 unauthorized, 502 unexpected internal failure through the existing handler, 503 missing configuration or unavailable storage |

No new endpoint or payload field. The GET keeps the existing absence of read throttling; the
30-mutations-per-minute budget applies to POST/PATCH and is not consumed by search.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: explicit public search scope | `searchIn` accepts exactly `title`, `content`, `all`; its API default is `title`. The reader explicitly sends `all` by default. `q` and the response envelope retain their existing shapes. | Silently broadening every existing `q` request would change results for clients expecting title-only search. |
| 2: literal content matching contract | For `content` and `all`, normalize each field and `q` with Unicode NFC followed by locale-independent lowercase, then test substring inclusion. Accents and whitespace remain significant; no query operators, stemming or token ranking. For `title`, preserve the existing SQLite `lower`/`instr` semantics. | FTS token syntax would change substring behavior, introduce query-language escaping and require stored index lifecycle work outside this slice. |

No dependency or schema door. If approved, record the public compatibility constraint in the
decision log before building features that consume it; this draft creates no active project decision.

## Criteria

### S1: Find a reading by its saved text (P1)

**Acceptance Criteria**

1. WHEN `searchIn` is absent or equals `title` THEN the API SHALL return the same video IDs and order as the current title-only query for the same data, `q`, filters and pagination.
2. WHEN a nonempty `q` uses `searchIn=content` THEN the API SHALL match a video if at least one individual saved field contains the normalized query: `Original.text`, `Enrichment.correctedText`, `Enrichment.summary`, each member of `Enrichment.keyPoints`, or `Video.reading.notes`.
3. WHEN a nonempty `q` uses `searchIn=all` THEN the API SHALL match the union of the content fields in AC 2 and `Video.title`, using the normalization in door 2 for each field independently.
4. WHEN `content` or `all` evaluates a query THEN the matcher SHALL perform NFC normalization and locale-independent lowercase before literal substring comparison, so `AÇÃO` matches `ação`, `acao` does not match `ação`, and `%`, `_`, quotes and `OR` remain literal text.
5. WHEN `q` is absent or empty THEN the API SHALL return the existing filtered list independently of the valid `searchIn` value.
6. IF `searchIn` is empty, repeated, not a scalar string or outside its three allowed values THEN the API SHALL return 400 with `INVALID_REQUEST` in the existing error envelope.
7. WHEN validating `q` THEN the API SHALL retain the current maximum of 200 JavaScript string code units and the existing rejection of repeated or non-string query values with 400 `INVALID_REQUEST`.
8. WHEN search is combined with channel, processing status, favorite and read filters THEN the API SHALL return only videos satisfying every supplied filter.
9. WHEN one video matches multiple fields or multiple key points THEN the API SHALL include that video once in both `total` and the paginated result set.
10. WHEN returning search results THEN the API SHALL keep the existing order of publication date or addition date descending, with video ID as the tie-breaker, and page-size default 20 and maximum 100.
11. WHEN the search count and page are read THEN the API SHALL derive `total` and `items` from one SQLite read snapshot.
12. WHEN a source, enrichment or notes update has committed before a new search starts THEN that search SHALL use the committed content without a rebuild, process restart or re-enrichment request.
13. IF a video has no original or enrichment, or has a failed processing stage THEN search SHALL evaluate its available fields without excluding it solely because of that missing content or failure.
14. WHEN a search completes THEN the API SHALL return only the existing Video listing shape without adding source text, corrected text, summaries or key-point arrays to list responses; existing owner notes remain part of Video metadata.
15. WHEN any search is served THEN the library SHALL make zero remote transcription, enrichment, discovery or RAG calls for that request.
16. WHEN any search is served THEN the library SHALL leave persisted videos, originals, enrichments, attempts and collection state unchanged.
17. WHEN search uses the existing protected route THEN the API SHALL retain its guard outcomes: 401 `UNAUTHORIZED` for a wrong/missing owner token, 503 `CONFIGURATION_REQUIRED` for absent server auth configuration, and 503 `STORAGE_UNAVAILABLE` for unavailable SQLite storage.
18. WHEN a search request is logged THEN telemetry SHALL omit the query value, saved content and credentials, retaining the existing route-template logging behavior required by AD-009.
19. IF an unexpected non-storage exception reaches the existing list-route error handler THEN the API SHALL return 502 `UPSTREAM_UNAVAILABLE` with the existing sanitized error envelope.

**Independent test:** Use saved videos with one distinct matching phrase in each searchable field,
one title-only match, one failed-enrichment original, one record matching several fields and one
nonmatch. Compare scopes, combine owner filters, paginate and repeat after saving a new note and
reopening the database. No provider access is needed.

### S2: Search from the existing reader interface (P1)

**Acceptance Criteria**

20. WHEN the library screen opens in an unlocked session THEN it SHALL show a selector labeled `Search in` with `All saved text`, `Titles only` and `Content and notes`, mapped respectively to `all`, `title` and `content`, with `All saved text` initially selected.
21. WHEN the owner edits the query or changes the scope THEN the reader SHALL request page 1 using the current query, scope and other filters.
22. WHEN the search input is displayed THEN its placeholder SHALL be `Search titles, transcripts, summaries and notes…` and its accessible name SHALL remain `Search videos`.
23. WHILE a foreground search is awaiting its response THEN the reader SHALL expose `Searching…` as a status message, without announcing old results as matches for the new query.
24. IF an active search completes with zero matches THEN the reader SHALL show `No videos match these filters.` and the existing `Clear filters` action.
25. WHEN `Clear filters` is activated THEN the reader SHALL return to the unfiltered first page with an empty query and `All saved text` selected.
26. IF a search fails with a non-authentication error THEN the reader SHALL preserve the query, scope and existing items while displaying an error that identifies those items as the previous results.
27. IF a search receives 401 THEN the reader SHALL use the existing locked access screen and clear displayed private results.
28. WHEN a delayed search response belongs to an older request revision or session THEN the reader SHALL discard that response through the existing revision/session guards.
29. WHEN an owner selects a search result THEN the reader SHALL open the existing video detail without changing original content or reading state.
30. WHEN the search controls are used at a 390-pixel viewport or through keyboard navigation THEN the reader SHALL keep both search controls operable without horizontal page overflow.
31. WHEN the reading guide describes searching THEN it SHALL include the three scopes, accent-sensitive literal examples, API default `title`, combination with filters and the absence of semantic ranking.

**Independent test:** In the real browser fixture, search for a phrase absent from titles, change
scopes, combine favorites/read filters, open a result and clear filters. Exercise delayed and failed
responses and session lock, then repeat control navigation at 390 pixels using the keyboard.

## Out of scope

| Excluded | Why |
| --- | --- |
| Semantic search or generated answers | Requires the separate RAG integration and retained-source lifecycle decision proposed as task 10. |
| Snippets, highlighted results or automatic jumps to matches | Changes list payloads and reader navigation beyond finding and opening a matching video. |
| Accent-insensitive matching, typo correction and advanced query operators | Each changes the search language beyond the literal matching contract in this plan. |
| Persisted FTS indexes, relevance ranking and corpus-scale latency targets | Requires measured corpus bounds and index lifecycle obligations beyond direct saved-text search. |
| Search across unsaved notes, chunk intermediates or other service stores | Only committed reading content in the library is authoritative for this feature. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Priority across the repository | Review content search first, then the remaining nine candidates in the roadmap. | It addresses a directly observed reader limitation using already retained content and no new provider. | n |
| Corpus performance target | No latency target is asserted; record representative measurements during implementation and return for a scope decision if direct scans cannot support the owner's actual corpus. | Neither the request nor repository specifies a corpus size or response-time budget. | n |

**Open questions:** none blocking this draft - chosen defaults are explicit above and product
behavior is proposed in the criteria. The owner may revise them during the requested plan review.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Library screen | empty state | AC 24–25; existing empty-library admission flow when no search is active |
| Library screen | loading state | AC 23 |
| Library screen | error state | AC 26 |
| Library screen | unauthorized state | AC 27–28 |
| Library screen | density and ordering | AC 10, 20, 22, 30; existing video cards |
| Library screen | destructive-action confirmation | n/a - searching and opening results do not delete or overwrite owner data |
| Library screen | keyboard and viewport access | AC 30 |
| Library screen | query changes and stale results | AC 21, 28 |
| List API | response shape | AC 9–11, 14 |
| List API | error shape and codes | AC 6–7, 17, 19; existing sanitized `{ error: { code, message }, requestId }` |
| List API | who may call it | AC 17; existing owner Bearer authentication |
| List API | versioning | existing - `/api/v1` keeps its title-only default; door 1 adds an optional scope |
| List API | rate-limit behavior | existing - GET reads are not throttled and do not consume the POST/PATCH mutation budget |
| List API | content retention and missing fields | AC 12–13, 16; existing library retention independent of upstream TTL |
| Results collection | grouping and naming | AC 2–3, 20; scopes select fields, while each result remains a video |
| Results collection | ordering | AC 10 |
| Results collection | duplicates | AC 9 |
| Results collection | records without source/enrichment | AC 13 |
| Reading guide | structure, tone and depth | AC 31; existing English operational guide with short examples |
| Reading guide | reader's next action | AC 20, 29, 31; choose a scope, search and open a saved reading |
| Command/scheduled task | output, flags, exit codes and partial failure | n/a - this feature adds no command or scheduled task |

## Sources

- Owner request on 2026-10-06 and [proposed review sequence](../../roadmap-next-10.md): ten tasks,
  individually approved; planning only.
- [Active project decisions](../../STATE.md), especially AD-009, AD-013 and AD-015–AD-018.
- Existing contracts in [Store.videos](../../../services/channel-library/api/store.ts),
  [list-route validation](../../../services/channel-library/api/app.ts), and the
  [reader](../../../services/channel-library/web/main.tsx).
