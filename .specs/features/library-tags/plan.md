# Organize library videos with owner tags

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Approval is for planning; implementation is not authorized.

## Problem

An owner can filter the library by channel, processing status, favorite and read state but cannot
group videos across channels around their own interests or projects. Finding a manually curated
set requires remembering individual titles or using the existing single text query. No usage data
was supplied.

The owner will name reusable tags, assign several tags to a video, filter the library to one tag
and remove a tag without deleting any videos.

## Flow

Reuse owner-authenticated library routes, `Store.videos` filtering, SQLite migrations and existing
reader card/navigation behavior.

1. Existing `GET/POST /api/v1/tags` routes in `api/app.ts` authenticate, validate and return the
owner's alphabetically ordered tags; POST creates a unique normalized name.
2. DELETE /api/v1/tags/:tagId removes the named tag and its links in one SQLite transaction,
never its videos.
3. PUT /api/v1/videos/:videoId/tags replaces that video's complete tag set in one transaction;
`GET /api/v1/videos?tagId=...` joins the existing page/count query to those links and combines the
tag with all current filters.
4. Existing video cards/detail in `web/main.tsx` (exists) show tags, allow an owner to add/remove
   them and supply a labeled tag filter; a `Manage tags` dialog (new UI) creates and deletes tags.
   Empty/error and clear-filter behavior stays in the library.
5. SQLite schema version 4 adds `tags` and `video_tags`. Migration preserves every current row
and does not rewrite original/enrichment/reading content.
6. The library guide and schema-upgrade guide describe tag normalization, the 20-tag per-video
bound and the required stopped-writer backup before migration.

## Impact

| Front | What changes |
| --- | --- |
| domain | A Tag is an owner-defined reusable label. A Video can have zero to 20 Tags and a Tag can label zero to all saved Videos. |
| stored data | Schema 4 adds `tags` and `video_tags`, with a unique case-insensitive normalized tag name and a unique `(video_id, tag_id)` pair. Existing rows remain unchanged; back up the stopped library before upgrade. Schema-3 binaries cannot open schema 4. |
| API | Add authenticated tag list/create/delete and video-tag replacement routes; add optional `tagId` to `GET /api/v1/videos`. Existing response envelopes, auth, 30 mutation/minute rule and 20/100 pagination remain. |
| UI | Video cards show removable tag chips and an add-tag control; the library filter can select one tag and combines with existing filters. |
| cleanup | Deleting a tag removes only its link rows and tag row; videos and their sources/reading data are unaffected. |
| existing decisions | Conforms to AD-009 and AD-015–AD-018; single owner, one SQLite writer, immutable sources and protected API remain. |

## Relations

`Video` many-to-many `Tag` through `VideoTag`. Each `(videoId, tagId)` pair is unique. Deleting a
Tag cascades only to VideoTag; deleting a Video cascades its links. Tags never own video content.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `GET /api/v1/tags` | none | `{ items: Tag[] }` sorted by normalized name | 200, 401, 503 |
| `POST /api/v1/tags` | `{ name }` | `{ tag }` | 201, 400 invalid/bounds, 409 normalized duplicate, 401, 429, 503 |
| `DELETE /api/v1/tags/:tagId` | tag ID | empty | 204, 400 invalid ID, 404 missing tag, 401, 429, 503 |
| `PUT /api/v1/videos/:videoId/tags` | `{ tagIds: string[] }` replacing the full set | `{ tags: Tag[] }` | 200, 400 invalid/unknown/over-limit set, 404 missing video, 401, 429, 503 |
| `GET /api/v1/videos` | existing filters plus optional one `tagId` | existing page with existing video shape | 200, 400 invalid filter, 401, 503 |

Errors keep `{ error: { code, message }, requestId }`. A failed set replacement changes none of the
links; rate-limited mutations return the existing `Retry-After` behavior.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: stored owner tags | SQLite schema 4, `tags(tag_id TEXT PRIMARY KEY, normalized_name TEXT UNIQUE, name TEXT NOT NULL)` and `video_tags(video_id, tag_id, PRIMARY KEY(video_id,tag_id))` with foreign keys cascading links only. | Store a comma-separated list in Video JSON: it cannot enforce global tag uniqueness or concurrent assignment integrity. |
| 2: migration compatibility | One atomic schema-3-to-4 migration, with backup-before-upgrade instructions; binaries that require schema 3 refuse schema 4. | In-place edits without a schema version make repeat migration and rollback behavior ambiguous. |

No other one-way door. The literal field names above settle identity and uniqueness; ordinary indexes
follow repository query conventions.

## Criteria

### S1: Create and manage reusable tags (P1)

**Acceptance Criteria**

1. WHEN the owner creates a valid tag THEN the API SHALL trim its name, normalize it to Unicode NFKC, and return a stable UUID tag ID.
2. IF a tag name is empty, whitespace-only, over 40 Unicode code points, has control characters or includes unknown body fields THEN the API SHALL return 400 `INVALID_REQUEST` and persist no tag.
3. WHEN an existing normalized tag name is submitted with different case or compatibility characters THEN the API SHALL return 409 `TAG_EXISTS` and leave one tag.
4. WHEN tags are listed THEN the API SHALL return every tag once in normalized-name ascending order.
5. WHEN an owner assigns a complete tag-ID set to a video THEN the API SHALL atomically replace the prior set and preserve all other video fields.
6. IF the video is missing, any tag ID is unknown, IDs repeat or the set contains more than 20 IDs THEN the API SHALL return 404 or 400 as specified in Surface and preserve the prior tag set.
7. WHEN a tag is deleted THEN the API SHALL remove that tag and its links while preserving videos, other tags, transcripts, enrichments and reading state.
8. WHEN tag mutations are called THEN the API SHALL apply existing Bearer auth, request/body validation, storage errors and 30-mutations-per-minute limit.

**Independent test:** Create tags differing by case/Unicode normalization, assign a complete set,
restart SQLite, replace the set and delete one tag while byte-comparing video source and reading
rows.

### S2: Filter and edit tags from the reader (P1)

**Acceptance Criteria**

9. WHEN the owner opens the library THEN each card with tags SHALL show its tags and each card SHALL offer an accessible add-tag action.
10. WHEN a video has no tag THEN its card SHALL display no placeholder chip and SHALL keep its current layout controls accessible.
11. WHEN the owner chooses `Add tag` THEN the UI SHALL offer existing tags and a create-tag action; successful assignment SHALL update the selected video without resetting unrelated filters.
12. WHEN the owner activates a tag's removal control on a card THEN only that tag/video link SHALL be removed.
13. WHEN the tag filter is selected THEN the API SHALL return videos with that tag and intersect it with channel, status, query, favorite and read filters.
14. IF the selected tag filter returns no videos THEN the UI SHALL show `No videos match these filters.` and `Clear filters` SHALL clear the tag along with all existing filters.
15. WHEN a tag is deleted in the tag manager THEN no video SHALL be deleted; cards SHALL refresh without the deleted chip.
16. WHEN the tag manager is opened, loading, empty or fails THEN the UI SHALL expose labeled loading, empty and alert states; a 401 SHALL clear the owner session.
17. WHEN tag controls are used at 390 pixels and by keyboard THEN every add/remove/filter action SHALL be operable without horizontal overflow.
18. WHEN the library guide explains tags THEN it SHALL document normalization, the 40-code-point name limit, 20 tags per video, filters, deletion semantics and the schema backup requirement.

**Independent test:** Use a browser against temporary SQLite to create and assign tags, combine the
tag filter with favorites and unread, remove a link, delete a tag and verify the videos remain.

## Out of scope

| Excluded | Why |
| --- | --- |
| Nested tags, colors, descriptions and shared/multi-owner taxonomies | No current multi-owner or taxonomy model supports them. |
| Tag search expressions or selecting multiple tags | One selected tag gives a bounded, reviewable filter contract. |
| Bulk tagging or automatic tags | Classification rules and batch semantics need their own outcome. |
| Deleting videos or pruning unreferenced transcripts when deleting a tag | A tag is only an owner label, not an owner of video data. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Tag name rules | 1–40 Unicode code points after trim, NFKC normalized, unique case-insensitively, no control characters. | Stable owner labels and database uniqueness with a compact input surface. | y — owner delegated all ten task details on 2026-10-09. |
| Assignment cardinality | At most 20 tags per video; one tag at a time in the library filter. | Keeps cards manageable and API replacement bounded. | y — user delegated. |
| Tag deletion | Detach from all videos and delete only the tag. | A tag is metadata and should not delete saved reading content. | y — user delegated. |

**Open questions:** none - defaults were delegated and recorded above.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Library screen | empty, loading and error tag states | AC 10, 16 |
| Library screen | tag controls and density | AC 9–12, 17 |
| Library screen | filter order, result ordering and clear behavior | AC 13–14; existing date/ID order remains |
| Library screen | destructive-action confirmation | AC 7, 15; tag deletion confirms its impact and states videos remain |
| Tag API | response and error shape | Surface; existing sanitized error envelope |
| Tag API | authorization, versioning and mutation rate | AC 8; existing v1 owner auth/rate limit |
| Tag API | normalization, bounds and duplicates | AC 1–6 |
| Stored tag collection | grouping, uniqueness, order and delete exception | Relations, Landing 1, AC 3–7 |
| Stored data lifecycle | migration and rollback | Landing 2, AC 19 |
| Library guide | steps and next action | AC 18 |
| Command/scheduled task | output, flags, exit codes and partial failure | n/a - this feature adds no command or schedule |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- [Active project decisions](../../STATE.md), especially AD-016 and AD-017.
- Existing schema/migration/query conventions in
  [store.ts](../../../services/channel-library/api/store.ts), tag/filter UI in
  [main.tsx](../../../services/channel-library/web/main.tsx), and API guards in
  [app.ts](../../../services/channel-library/api/app.ts).
