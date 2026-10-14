# Resume the original transcript reading position

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize implementation.

## Problem

An owner can mark a video read but cannot save where they stopped in its long original transcript.
Returning to the video opens the Summary tab at the top, so the owner must find the place again.
Corrected prose is not time-aligned to the original; storing a timestamp as if it applied across
all four reader tabs would promise navigation the data cannot support. No reading-time data was
provided.

The reader will preserve a coarse scroll position only for the immutable Original transcript and
offer an explicit way to resume it. Other tabs keep their current opening behavior.

## Flow

Reuse the existing reader tabs, Original transcript text, owner `ReadingState`, partial PATCH and
SQLite schema migration.

1. The Original transcript `tabpanel` in `web/main.tsx` (exists) places its long prose and segments
   in one dedicated scrollable region, maximum height 65vh on desktop and 70vh on mobile; it
   measures scroll progress as integer basis points 0–10000 from that region's scroll extent.
2. When progress changes, a debounced writer persists the latest value in the existing owner's
reading state through `PATCH /api/v1/videos/:videoId/reading`; it sends at most one progress
mutation per 15 seconds while scrolling and flushes once on reader departure.
3. Store migrations add nullable `position` to every reading record at the next schema version;
old records become `null`, and old service binaries refuse the migrated database. Back up the
stopped library first.
4. On opening a video, the reader remains on Summary. A saved nonzero original position exposes a
`Resume original transcript` action; activating it selects Original transcript and restores that
position in the reader panel.
5. Scrolling to the end records 10000 and clears the resume action. A missing Original transcript
or a null/zero position exposes no resume action.
6. The guide explains this position belongs only to the immutable original text; tab changes do
not reinterpret it for corrected text.

## Impact

| Front | What changes |
| --- | --- |
| domain | Reading position is optional owner state for the Original transcript only, expressed as basis points from 0 to 10000. |
| stored data | Schema advances one version; `reading.position` is nullable integer, existing rows backfill null. Back up before migration; older binaries cannot reopen the upgraded store. |
| API | Existing `PATCH .../reading` permits `position` with bounds; existing detail/list Video shapes include the new ReadingState field. Authentication and mutation limit remain. |
| UI | Reader saves progress at a bounded cadence and offers an explicit resume control. Opening and tab defaults remain unchanged. |
| rate limit | At most four timed position writes/minute plus one departure flush; existing 30 mutations/minute limit leaves room for normal reader actions. |
| immutable source | No transcript, segment timestamp or enrichment text changes. |

## Relations

Each Video has one ReadingState with zero or one Original-transcript position. Position is owner
state attached to the same video as favorite/read/notes; it is not a mutation of Original or
Enrichment.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `PATCH /api/v1/videos/:videoId/reading` | existing partial reading fields plus optional integer `position` from 0 to 10000 or null | existing `{ reading }`, now including `position` | 200, 400 invalid/bounds, 401 unauthorized, 404 missing video, 413 oversized, 429 mutation limit, 503 configuration/storage failure |
| `GET /api/v1/videos/:videoId` | existing video ID | existing detail shape with `reading.position` | 200, 400 invalid ID, 401, 404, 503 |

The new JSON member is optional on incoming PATCH and present in newly returned ReadingState; old
schema migrations populate it as null. Error envelope and route version remain unchanged.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: saved transcript position | SQLite schema advances by one; `Video.reading.position` is nullable integer basis points 0–10000. Existing records backfill null atomically. | A timestamp cannot navigate long transcript prose because segments do not map to offsets in the original text; a per-tab offset would imply false alignment to corrected prose. |
| 2: upgrade compatibility | Stop writer and back up the whole library before the migration; newer binary migrates atomically and older schema binary cannot reopen it. | Silently optional JSON fields without migration leave mixed defaults and undocumented rolling-back behavior. |

## Criteria

### S1: Persist and resume original reading progress (P1)

**Acceptance Criteria**

1. WHEN a video has no original transcript or a null/zero saved position THEN the detail screen SHALL show no `Resume original transcript` action.
2. WHEN the owner opens any video THEN the reader SHALL continue to select the Summary tab initially, regardless of saved position.
3. WHEN the owner activates `Resume original transcript` on a video with an original and saved position from 1 to 9999 THEN the reader SHALL select Original transcript and restore the panel to that proportional content position within one visible paragraph height.
4. WHEN the owner scrolls the Original transcript THEN the reader SHALL map its scroll progress to integer basis points in the inclusive range 0–10000 using the dedicated region's scrollable content extent.
5. WHILE the owner scrolls continuously THEN the client SHALL issue at most one position PATCH per 15-second interval and SHALL send no position PATCH if the rounded progress has not changed since the last successful save.
6. WHEN the owner leaves the reader while position is dirty THEN the reader SHALL send one final position update before completing its in-app navigation, without prompting for confirmation.
7. WHEN the owner switches from Original transcript to another tab THEN the reader SHALL retain the saved Original position and SHALL NOT apply it to corrected text, Summary or Key points.
8. WHEN a position PATCH succeeds THEN the returned saved value SHALL become the new progress baseline without changing favorite, read state or notes.
9. IF a position is not an integer, below 0 or above 10000, or the body contains an unknown field THEN the API SHALL return 400 `INVALID_REQUEST` and preserve the saved reading record.
10. WHEN the 15-second writer approaches the existing 30 mutations-per-minute route limit THEN it SHALL continue to send no more than four timed writes/minute plus one leave flush.
11. IF a progress PATCH fails THEN the UI SHALL retain its in-memory position, show a sanitized save alert, and retry only after the next 15-second interval or reader departure.
12. WHEN the reader is locked or receives 401 THEN the app SHALL clear session data and any in-memory progress under the existing session behavior.
13. WHEN the browser is reloaded after a successful position save THEN the same video SHALL offer Resume at the persisted proportional location.
14. WHEN progress reaches 10000 THEN the reader SHALL treat the Original transcript as complete and hide the resume action.
15. WHEN schema versions before this migration open under the new service THEN all existing Video, source, enrichment, reading, attempt, chunk and collection records SHALL be preserved and position SHALL default to null.
16. WHEN the guide describes progress THEN it SHALL state that it applies only to Original transcript, uses a coarse percentage, does not seek a YouTube player, and requires a stopped-writer backup for upgrade.

**Independent test:** Save progress near one-third through a real fixture original, reopen the browser
and video, resume near the same proportion, and assert the exact persisted basis-point value and
unchanged transcript/notes/favorite/read state.

## Out of scope

| Excluded | Why |
| --- | --- |
| Resume positions for Summary, Key points and corrected transcript | No stable content anchors or correspondence with the original transcript exist. |
| YouTube playback seeking or segment timestamp editing | This feature tracks the reader's scroll, not video playback. |
| Automatic selection of the Original transcript tab on open | An explicit resume choice preserves the current Summary-first behavior. |
| Cross-device sync or offline persistence of unsaved progress | Existing owner API persistence is sufficient for this slice. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Persisted position scale | Integer basis points 0–10000; clamp to current scroll extent. | Stable in the database and proportional across viewport sizes. | y — owner delegated task details. |
| Save cadence | At most one write per 15 seconds while changed, plus one flush when leaving the reader. | Four or fewer scheduled writes per minute stays below existing route limit. | y — user delegated. |
| Resume behavior | Summary remains selected; owner chooses `Resume original transcript`. | Avoid surprise navigation on every open. | y — user delegated. |

**Open questions:** none - behavior was delegated and is bounded above.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Reader screen | empty, loading and error | AC 1, 11–12 |
| Reader screen | initial tab and resume action | AC 1–3, 13–14 |
| Reader screen | position/ordering density | AC 3–7 |
| Reader screen | destructive action confirmation | n/a - progress saving performs no destructive action |
| Reader screen | viewport and keyboard control | existing keyboard-accessible tabs plus AC 3 |
| Reading PATCH API | response/error, authorization, bounds and version | Surface, AC 8–12 |
| progress collection | update cadence, duplicate values and latest ordering | AC 4–6, 10–11 |
| stored reading relation | cardinality and migration | Relations, Landing, AC 15 |
| library guide | boundaries and operator step | AC 16 |
| command/scheduled task | output/flags/exit/partial failure | n/a - no new command or schedule |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- [Active project decisions](../../STATE.md), especially AD-016 and AD-017.
- Existing Original rendering, `ReadingState`, PATCH route, migration and reader tests in
  [main.tsx](../../../services/channel-library/web/main.tsx),
  [types.ts](../../../services/channel-library/api/types.ts),
  [app.ts](../../../services/channel-library/api/app.ts),
  [store.ts](../../../services/channel-library/api/store.ts) and
  [reading.spec.ts](../../../services/channel-library/browser/reading.spec.ts).
