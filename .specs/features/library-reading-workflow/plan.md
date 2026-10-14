# Library reading workflow and integration validation

## Problem

The owner requests 15 tasks: five review/fix outcomes, five integration-validation outcomes and
five new reader capabilities, executed continuously with routine approvals delegated. Existing
readers cannot save favorites, reading state or notes, or export a portable reading document.
Review found terminal failed transcript jobs being reused and the root Vite wrapper losing flags.

## Flow

Reuse the current SQLite store, Fastify auth, provider adapters and React reader.

1. Root package scripts and CI (exists) run locked dependency checks and forward development arguments (AC 1–2).
2. Worker, config and reader fetch lifecycle (exists) enforce retry identity, input validation and session isolation (AC 3–5).
3. Provider adapters and both API assemblies (exists) run preflight, bounded live probes and a controlled HTTP integration proof (AC 6–10).
4. SQLite Store (exists, door 1) migrates per-video reading state; library routes (exists, door 2) publish owner-only edits and filters (AC 11–13, 15).
5. React reader (exists) edits that state and downloads escaped Markdown from the library route (door 3) (AC 11–15).

## Impact

| Front | What changes |
| --- | --- |
| runtime | Failed terminal job retries submit a fresh job; pending-job polls keep their ID; credentials trim whitespace; invalid query shapes return 400 |
| UI | Session responses cannot cross a lock/unlock boundary; new reading actions retain unsaved notes across polling and errors |
| stored data | Schema 1 to 2 adds a reading object to video JSON; originals, enrichment, progress and existing metadata preserved |
| operations | Full dependency audit CI, corrected Vite wrapper, stage-specific live probe commands and documented evidence |

## Relations

Video has exactly one ReadingState; defaults favorite=false, read=false, notes="", updatedAt=null.
Original and Enrichment remain immutable with respect to reading edits. There is still one owner.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| PATCH /api/v1/videos/:videoId/reading | partial favorite/read/notes; at least one known field | reading state | 200, 400, 401, 404, 413, 429, 503 |
| GET /api/v1/videos/:videoId/export | video ID | Markdown attachment video-ID.md | 200, 400, 401, 404, 503 |
| GET /api/v1/videos | additive favorite=true/false and read=true/false filters | existing paginated envelope, videos include reading state | 200, 400, 401, 503 |

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1 persistent reading state | user_version=2; video JSON reading={favorite:boolean,read:boolean,notes:string,updatedAt:ISO-or-null} | Browser-only state is lost between sessions; changing original transcript would destroy source fidelity |
| 2 owner reading API | PATCH /api/v1/videos/:videoId/reading; notes max 10000 Unicode code points; body max 65536 bytes; writes share 30/min admission budget | Whole-video updates expose worker state to client writes |
| 4 keyless discovery | YOUTUBE_DISCOVERY_MODE=rss or data_api (existing default); local setup selects rss without a key; bounded public Atom feed with no pagination | Requiring a new Google key blocks the owner; arbitrary channel scraping or bypassing restrictions is excluded |
| 3 portable export | GET /api/v1/videos/:videoId/export; text/markdown UTF-8; attachment video-ID.md; escaped source/model/note text | HTML export can activate untrusted content; query-string owner tokens leak credentials |

## Criteria

### S1: Review and fix (five tasks)

**Acceptance Criteria**

1. The project SHALL retain patched locked dependency versions and configure full dependency audits in both CI workflows; a fresh audit must report its actual result, including network failure, without claiming zero from a failed request.
2. WHEN the root library:dev:web command receives --port and --strictPort THEN Vite SHALL receive both flags unchanged.
3. WHEN a terminal failed transcript job is retried THEN the worker SHALL submit a fresh job, while queued/processing polls SHALL retain the existing job ID.
4. The library SHALL trim configured credentials and reject repeated, unknown or invalid video filter parameters with 400 INVALID_REQUEST.
5. WHEN the owner locks or changes the session THEN late requests from the old session SHALL neither restore content nor log out the new session.

### S2: Validate integration (five tasks)

**Acceptance Criteria**

6. A preflight command SHALL report missing credential names without values and exit 2 when required configuration is absent; a safe local setup command SHALL generate missing owner tokens without replacing existing values.
7. The live discovery probe SHALL resolve a public channel and obtain up to ten recent video identities using the actual YouTube adapter in explicit public RSS mode without an API key (channel ID URLs and resolved handles); missing credentials/network SHALL remain blocked, never simulated PASS.
8. The live transcript probe SHALL submit and poll one actual transcript API job with a bounded deadline, validate source identity and preserve the source in an ignored validation artifact; unavailable credentials/network SHALL remain blocked.
9. The live LLM probe SHALL use the saved transcript (or an explicitly labeled fixed smoke sample), validate corrected text/summary/key points with the configured actual OpenCode adapter and never print content or credentials; network failure SHALL remain blocked.
10. The controlled integration proof SHALL run the real transcript and library HTTP assemblies, persist original/enrichment and verify restart/duplicate discovery without a second completed-video enrichment; external provider fixtures SHALL be explicitly distinguished from live evidence.

### S3: Five reading features

**Acceptance Criteria**

11. The owner SHALL toggle a persistent favorite in the reader; schema 1 migration and restart SHALL retain existing content and default missing reading state to false/false/empty/null.
12. The owner SHALL toggle persistent read/unread state independently of favorites and processing status.
13. The owner SHALL save notes of 0–10000 Unicode code points, retain unsaved drafts during polling/failures, and receive 400 for unknown fields or invalid types; notes SHALL not alter source or enrichment.
14. The owner SHALL download authenticated Markdown with title, canonical video URL, summary, key points, corrected/original text and notes; missing sections SHALL be labeled unavailable and untrusted text escaped.
15. The library SHALL combine favorite/read filters with channel/status/search and pagination; clearing filters SHALL reset all filters and page to 1, and reader controls SHALL remain usable at 360px and by keyboard.

**Independent test:** targeted backend/browser proofs, full regression, actual local HTTP integration and separately recorded live probe results.

## Out of scope

| Excluded | Why |
| --- | --- |
| multi-user accounts, deployment, data deletion | Not needed for the requested reader improvements |
| arbitrary bulk provider processing | Live probes bound calls to one selected video to limit quota usage |
| old spec rewrites | User explicitly preserves historical specs |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| new feature selection | Favorites, read status, notes, Markdown export, reading filters | Owner requested five tasks per suggested objective and delegated routine decisions | y |
| workflow format | Explicit 15-task status table in checks | User explicitly requested tasks; overrides skill's preference against task lists |
| approvals | Continue without routine approval stops | User explicitly granted them |
| environment | Report sandbox/network constraints honestly | Current .git is read-only and network/DNS restricted |

| # | Kind | Question | Until answered |
| --- | --- | --- | --- |
| 1 | open | Public channel/video selection | Default to Google Developers public channel for discovery; process only one explicitly selected video |
| 2 | blocks | Network/DNS access for actual providers | Tasks 7–9 remain blocked if outbound requests fail |

**Open questions:** live network access is blocked in the current session; no YouTube key is required in RSS mode.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| reader | favorite/read controls, note draft, save/error states, authenticated export | AC 11–14 |
| library | combined filters and empty-state reset, mobile layout | AC 15 |
| reading API | limits, error envelopes, auth, idempotency | AC 11–15, doors 1–3 |
| probes | missing config, timeout, quota bounds and secret-free reports | AC 6–10 |
| existing runtime | retry and session consistency | AC 3–5 |

## Sources

- Owner's request for 15 tasks and continuous execution; prior approval delegation.
- AGENTS.md and active AD-004 through AD-016; historical plans remain untouched.
- Existing api/{app,store,worker,remote,config}.ts and web/main.tsx define current behavior.

**Open questions:** network availability blocks live proof only. Owner confirmed no YouTube key; explicit RSS mode is the chosen solution. Owner also requires Playwright CLI interaction against the real local reader; use the installed playwright-cli skill and record separate browser evidence.
