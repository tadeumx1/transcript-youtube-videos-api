# Export a selected set of readings

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize implementation.

## Problem

The authenticated Markdown export handles one video at a time. An owner collecting a short set
must download and organize every file manually, and individual files lose the selected set's
shared order. No archive format or typical selection size was specified.

The owner will select up to 20 library videos and download their complete available readings and
notes as one ordered Markdown document. Existing per-video export remains.

## Flow

Reuse the library selection state, current authenticated video/source/enrichment records and
`exportMarkdown` escaping/section renderer.

1. Cards in `web/main.tsx` (exists) expose labeled selection checkboxes; selection survives list
pagination and filters until clear or owner session lock, with a hard 20-video cap.
2. The library screen calls the new authenticated read-only batch export route in `api/app.ts` (new route); it sends the selected video IDs.
3. `api/app.ts` (exists) validates 1–20 unique supported IDs, loads each Video/Original/Enrichment
from one read transaction and assembles one Markdown file in current library order.
4. Each section uses existing `exportMarkdown` output, prefixed with its ordinal and separated by
a horizontal rule. Missing content retains the existing `Not available yet.` labels.
5. If the final UTF-8 document exceeds 10 MiB, return 413 without a partial download. Otherwise
respond `text/markdown` with a fixed safe filename. The browser streams the authenticated blob and
revokes its object URL after download.
6. The guide documents selection bounds, contents, file handling and private notes.

## Impact

| Front | What changes |
| --- | --- |
| API | New read-only authenticated batch export route; no mutation slot consumed. |
| selection | Up to 20 distinct IDs per request; result ordering follows current library order regardless of checkbox/pagination order. |
| content | Includes current title, link, dates, summary, key points, corrected/original transcripts and owner notes exactly as single export. |
| safety | Reuse existing Markdown escaping. Generic filename never includes video title or owner content. |
| size | At most 10 MiB UTF-8 output; never return a partial document. |
| storage | No migration, external service or new package. |

## Relations

None - no stored-data shape change. The requested Videos, optional Originals, optional Enrichments
and owner ReadingStates are read together; the export does not create another stored copy.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `GET /api/v1/videos/export` | `ids` comma-separated, 1–20 distinct 11-character YouTube IDs | ordered Markdown attachment `margin-library-selection.md` | 200, 400 invalid/missing/repeated/over-limit IDs, 401 unauthorized, 404 any video missing, 413 generated document over 10 MiB, 503 configuration/storage failure |

Requests with any missing ID fail wholly without a partial document. Authentication and no-store
headers are the existing route policy.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: selected-set representation | One UTF-8 Markdown file named `margin-library-selection.md`, with numbered per-video sections in library order and `---` separators. | A ZIP adds a dependency and a per-file naming/path safety contract when the existing API already supplies complete Markdown. |

No persisted or API schema door; the endpoint is reversible.

## Criteria

### S1: Select and download multiple readings (P1)

**Acceptance Criteria**

1. WHEN the owner views the library THEN each video card SHALL include a labeled selection control that does not activate card navigation when toggled.
2. WHEN the owner selects a 21st video THEN the UI SHALL refuse that selection and explain the 20-video maximum.
3. WHEN the owner selects videos across pages or filters THEN selection SHALL remain until deselected, cleared or the session locks.
4. WHEN at least one and at most 20 videos are selected THEN the UI SHALL enable `Download selected readings` and show the exact selected count.
5. WHEN selection is empty THEN the download action SHALL be disabled.
6. WHEN download is activated THEN the browser SHALL make one authenticated GET to `/api/v1/videos/export` with the selected IDs and shall not include the token in the URL.
7. WHEN one or more videos lack Original or Enrichment data THEN the export SHALL include the same `Not available yet.` section for each missing value as the existing single-video exporter.
8. WHEN selection is requested THEN the route SHALL require exactly 1–20 unique valid video IDs; duplicate, missing, malformed or 21+ IDs SHALL return 400 with no file body.
9. IF any well-formed requested ID is absent from the library THEN the route SHALL return 404 and SHALL NOT generate a partial export.
10. WHEN all IDs exist THEN the file SHALL follow library order, include an ordinal/title/video link and the complete existing single-video sections for every requested video.
11. WHEN generating the file THEN API source/model text and personal notes SHALL be escaped using existing `exportMarkdown` behavior and content SHALL remain `text/markdown`, never HTML.
12. IF UTF-8 output exceeds 10 MiB THEN the route SHALL return 413 before sending any document bytes.
13. WHEN responding to export THEN the route SHALL set `Cache-Control: no-store` and fixed `Content-Disposition` filename `margin-library-selection.md` without incorporating input strings.
14. WHEN authenticated status is missing/invalid or storage is unavailable THEN the route SHALL return existing 401/503 errors and no file.

**Independent test:** Create two contrasting videos with source, enrichment, unsafe Markdown text
and notes; download one batch and inspect exact section order, escaping, attachment headers and
omission of missing items.

### S2: Keep selection private and bounded in the reader (P1)

**Acceptance Criteria**

15. WHEN the owner locks the library or receives 401 THEN the UI SHALL clear the selected IDs and any export blob state.
16. IF the export request fails THEN the UI SHALL retain selected IDs, show an accessible alert and allow retry.
17. WHEN export is pending THEN the UI SHALL disable duplicate downloads and show `Preparing Markdown…`.
18. WHEN keyboard controls are used at 390 pixels THEN each selection control and download action SHALL be reachable without horizontal page overflow.
19. WHEN the guide explains selected export THEN it SHALL document the 20-video and 10-MiB limits, file sections, missing-content labels and that notes/transcripts are private data in the download.

**Independent test:** Use Chromium to select across pages, download the real fixture file, verify
its contents, and test failure, lock, 20/21 selection boundary and mobile keyboard controls.

## Out of scope

| Excluded | Why |
| --- | --- |
| ZIP or per-video files, PDF, JSON or CSV | One dependency-free Markdown artifact meets the selected-set use case. |
| Exporting all library records or over 20 videos | The request is for a bounded selection. |
| Background generation, pagination token or queued download | At most 10 MiB is safe to generate synchronously. |
| Importing exports back into another service | The export is portable Markdown, not a synchronization format. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Container format | One ordered Markdown document, not ZIP. | Existing single-video renderer already defines a safe portable format. | y — owner delegated task details. |
| Bounds | 20 videos and 10 MiB encoded output. | Caps synchronous storage and response work. | y — user delegated. |
| Missing requested video | Fail whole request with 404. | An incomplete selection should be visible rather than silently omitted. | y — user delegated. |

**Open questions:** none - format and bounds were delegated.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Library screen | empty/loading/error/download state | AC 4–5, 16–18 |
| Library screen | selection density/order | AC 1–3, 10 |
| Library screen | destructive confirmation | n/a - selection does not mutate saved content |
| Export GET | input/error/auth/version/rate limit | Surface, AC 6, 8–14; read-only existing v1 policy |
| Export collection | ordering, duplicates, missing source | AC 7–12 |
| Download document | format, escaping and next action | AC 10–13, 19 |
| Data lifecycle and privacy | in-memory generation and session lock | AC 15–16; no persisted duplicate |
| command/scheduled task | n/a - no new command or schedule |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- Existing authenticated single-video export and escaping in
  [export.ts](../../../services/channel-library/api/export.ts),
  [app.ts](../../../services/channel-library/api/app.ts) and
  [main.tsx](../../../services/channel-library/web/main.tsx).
- AD-009 and AD-017 in [project state](../../STATE.md).
