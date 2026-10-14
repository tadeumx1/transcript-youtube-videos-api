# Resolve metadata for individually added videos

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize implementation.

## Problem

When an owner adds a video URL, the library stores the literal title `YouTube video <id>`, an
unknown publication date and no thumbnail. These placeholders remain until a followed channel's
upload feed later discovers that video. An individually saved reading can therefore stay hard to
identify even though YouTube has public metadata for it. No usage or failed-lookup rate was
provided.

When the owner explicitly enables YouTube metadata lookup, a new individual video will display
its public title, publication date and available thumbnail. The video remains individually saved
and is not presented as a followed channel. A missing key, unavailable video or failed lookup
keeps the current placeholders and does not block transcript processing.

## Flow

Reuse the existing library configuration, single worker, persisted `attempts` table, YouTube API
adapter, video fields and browser polling.

1. `readConfig` in `services/channel-library/api/config.ts` (exists) reads
   `YOUTUBE_METADATA_MODE=off|data_api`, defaulting to `off`, independent of
   `YOUTUBE_DISCOVERY_MODE`. The existing server-only `YOUTUBE_API_KEY` is required to make the
   optional metadata request; no browser receives it.
2. The existing worker in `services/channel-library/api/worker.ts` sees a pending, unattached
   individual video before submitting its transcript job. Only when metadata mode is `data_api`
   and that video's metadata attempt has not been recorded does it create an existing-table
   attempt row with stage `metadata` and call `HttpRemote` (exists).
3. `HttpRemote` (exists) calls the official `videos.list` method once with `part=snippet` and
   that video's ID. It accepts exactly the requested public video ID and validates title,
   publication date and thumbnail URL before returning metadata.
4. On success, `Store.updateVideo` (exists) updates the existing `title`, `publishedAt` and
   `thumbnail` properties, leaving `channelId: null`, `channelTitle: 'Added individually'`,
   reading state and processing state intact. On an unavailable or invalid response, configuration
   error, rate limit or upstream failure, it retains all three placeholders and records a
   sanitized outcome.
5. In either outcome, the existing worker proceeds to the authenticated transcript API and
   enrichment stages. The existing five-second list refresh renders newly saved metadata.
6. When normal channel discovery later attaches an actual followed channel, its existing metadata
   association updates the channel link and source label while preserving processing and reading
   state.
7. The library `.env.example` (exists), reader/configuration guide (exists) and all-services
   environment reference (exists)
   explain the explicit opt-in, existing key requirement, one-request quota and fallback.

An attempt marker is written before making the remote request. A restart therefore never repeats
the same optional lookup for an already attempted individual video, even if the request succeeded
but the metadata write did not finish. A new video ID gets its own attempt. The processor uses the
existing one-writer lifecycle; no metadata requests are made for channel-discovered videos or
duplicate individual admissions.

## Impact

| Front | What changes |
| --- | --- |
| configuration | New optional `YOUTUBE_METADATA_MODE`, exactly `off` or `data_api`, default `off`. `data_api` uses the existing server-side `YOUTUBE_API_KEY` even when feed discovery mode is RSS; collection and metadata selection remain separate. |
| external use and quota | An enabled lookup makes one YouTube Data API `videos.list` request per newly admitted individual ID, at the current documented cost of 1 quota unit per call. Disabled mode makes no call. |
| processing | The optional metadata attempt is isolated from transcript/enrichment success: its error does not alter `Video.status`, `Video.failure`, retry budget or transcript-job submission. Its request can wait up to 30 seconds under the existing `HttpRemote` timeout. |
| video API | No route, response key or status changes. Existing `title`, `publishedAt` and `thumbnail` fields may transition from placeholder/null to verified values after admission when the configured lookup succeeds. |
| stored data | No new video JSON fields, columns, schema version, migration or retention rule. A single `stage='metadata'` attempt row in the existing attempts table bounds optional upstream calls across polling and restart. |
| reader | The existing cards/detail render the updated title, publication date and thumbnail automatically; `Added individually` continues to identify an unattached video. |
| privacy and telemetry | The public video ID is sent only to YouTube. Keys, response bodies, titles and thumbnail URLs remain out of logs under AD-009. |
| existing decisions | Conforms to AD-004, AD-009, AD-013, AD-015, AD-016 and AD-018. No channel or collection is created and global video identity is unchanged. |

## Relations

None - no stored-data shape change. Reuse the existing Video row, its nullable followed-channel
relation and existing Attempt rows. `youtube_video_id` remains the global video identity.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `POST /api/v1/videos` | unchanged supported video URL | unchanged `{ video, created }`; new videos still enter as pending and may later expose verified values in the existing `Video` fields | 202 new, 200 duplicate, 400 invalid, 401 unauthorized, 413 oversized, 429 rate limited, 503 configuration/storage failure |
| `GET /api/v1/videos` | existing filters | unchanged `{ items, total, page, pageSize }`; a successfully enriched individual video has updated existing metadata fields | 200 success, 400 invalid query, 401 unauthorized, 503 missing configuration or unavailable storage |
| `GET /api/v1/videos/:videoId` | existing video ID | unchanged detail shape; a successfully enriched individual video has updated existing metadata fields | 200 success, 400 invalid ID, 401 unauthorized, 404 missing video, 503 missing configuration or unavailable storage |

No route is added and no request body, response key, authentication rule or rate limit changes.
Existing API consumers may observe the existing title/date/thumbnail values improve while the
video is processing.

## Landing

None - no one-way door. The config setting defaults off and can be reverted. It reuses the current
YOUTUBE_API_KEY, generic `attempts` table and existing Video fields; there is no new dependency,
persisted entity, column, response key or migration.

## Criteria

### S1: Fill metadata when explicitly configured (P1)

**Acceptance Criteria**

1. WHEN `YOUTUBE_METADATA_MODE` is absent THEN the library SHALL interpret it as `off`.
2. IF `YOUTUBE_METADATA_MODE` is not exactly `off` or `data_api` THEN configuration SHALL fail with an error naming `YOUTUBE_METADATA_MODE` before the application accepts requests.
3. WHILE metadata mode is `off` THEN a newly admitted individual video SHALL retain its ID-based title, null publication date, null thumbnail, and SHALL cause zero YouTube Data API requests.
4. WHILE metadata mode is `data_api` and `YOUTUBE_API_KEY` is non-empty THEN a newly admitted individual video SHALL request metadata using `videos.list`, `part=snippet` and only that video's 11-character ID.
5. WHEN the metadata request returns exactly one item matching the requested video ID with a non-empty title, an RFC 3339 publication date and an allowed `https://i.ytimg.com/` or `https://img.youtube.com/` thumbnail URL THEN the library SHALL save those three values in the existing Video fields.
6. WHEN metadata is saved THEN the Video SHALL retain `channelId: null`, `channelTitle: 'Added individually'`, its original `addedAt`, processing status, stage, job state and owner reading state.
7. WHEN metadata is saved THEN the API SHALL continue to serialize the existing Video shape without adding metadata-status, provider-body or channel-follow fields.
8. WHEN metadata lookup is disabled or has not succeeded THEN the existing individual-video title, date and thumbnail placeholders SHALL remain truthful and readable in cards, details and Markdown export.
9. WHEN channel discovery later returns the same individual video THEN the existing channel association SHALL attach the followed channel and preserve processing state, original transcript, enrichment and owner reading state.

**Independent test:** Configure a fake YouTube videos endpoint that returns a valid snippet, admit
an individual ID, advance the worker and assert the exact existing Video fields plus unchanged
transcript state. Repeat with mode off to prove no HTTP call.

### S2: Keep optional lookup bounded and isolated (P1)

**Acceptance Criteria**

10. WHEN `YOUTUBE_METADATA_MODE=data_api` and `YOUTUBE_API_KEY` is empty THEN the worker SHALL record the metadata outcome as unavailable with `CONFIGURATION_REQUIRED`, retain placeholders and proceed with transcript submission.
11. IF YouTube returns an empty items array, an item with another ID, a malformed response, an invalid title/date or a non-HTTPS/unapproved thumbnail URL THEN the worker SHALL retain all placeholder metadata and proceed with transcript submission.
12. IF YouTube returns 401, 403, 429, 5xx, a network failure or a timeout THEN the worker SHALL retain all placeholder metadata, emit only the existing bounded/sanitized upstream diagnostics and proceed with transcript submission without adding a video failure or transcript retry.
13. WHEN metadata mode is `data_api` THEN the worker SHALL persist one `metadata` attempt marker before the network request, finish that active attempt before opening the existing transcript-stage attempt, and SHALL not issue a second lookup for the same video ID after an error, a successful lookup, a duplicate admission, another worker poll or a process restart.
14. IF the process stops after writing the attempt marker but before saving returned metadata THEN restart recovery SHALL skip a repeated metadata request and SHALL resume the existing transcript workflow.
15. WHEN channel feed discovery returns a video already imported individually THEN the channel ingestion path SHALL make zero additional `videos.list` metadata requests for that video.
16. WHEN optional metadata lookup reaches its outcome, whether success or failure, THEN it SHALL leave the worker eligible to submit or resume the existing transcript job in that same processing cycle.
17. WHEN an individual video with an existing source is explicitly retried THEN the retry SHALL continue enrichment from the existing source without a metadata request or change to existing metadata.
18. WHEN an individual URL is resubmitted for an existing video THEN duplicate handling SHALL return the existing record and SHALL not issue or schedule a metadata lookup.
19. WHEN a metadata request is made THEN its URL SHALL contain only the YouTube API endpoint and public video ID plus query parameters; credentials SHALL remain server-side and telemetry SHALL omit the key, response body, title, thumbnail URL and source content.

**Independent test:** Inject keyless, unavailable, malformed, unauthorized, rate-limited, timed-out
and successful YouTube responses through the real worker and controlled HTTP server. Assert the
attempt row, request count, unchanged fallback fields, transcript submission and restart behavior.

### S3: Configure the opt-in safely (P2)

**Acceptance Criteria**

20. WHEN the operator configures `YOUTUBE_METADATA_MODE=data_api` THEN the English library guide, `.env.example` and all-services configuration reference SHALL explain the required existing `YOUTUBE_API_KEY`, independent discovery mode, one quota-unit lookup, default `off`, and placeholder fallback.
21. WHEN setup or Docker documentation shows `YOUTUBE_DISCOVERY_MODE=rss` THEN it SHALL state that metadata lookup remains off unless the separate `YOUTUBE_METADATA_MODE=data_api` option is selected.
22. WHEN configuration changes from `data_api` to `off` and the library restarts THEN the service SHALL make no new metadata requests; already saved titles, dates and thumbnails SHALL remain available.

**Independent test:** Review the rendered setup and operation instructions against the actual
environment parser and run the library in RSS mode with the metadata setting absent; no key or
upstream metadata request is required for healthy startup and transcript processing.

## Out of scope

| Excluded | Why |
| --- | --- |
| Scraping YouTube page HTML or bypassing access restrictions | The existing codebase has a supported Data API adapter; page markup is an unstable private boundary. |
| Changing `channelId` or auto-following the uploader | A single saved video must not create a channel subscription or collection schedule (AD-018). |
| Metadata lookup for channel-discovered videos | RSS and Data API channel discovery already supply their current metadata; this slice handles individual admission only. |
| Retrying metadata independently, refresh controls or backfilling existing individual videos | The one-request bound prevents unexpected quota use; a user-visible refresh lifecycle is a separate feature. |
| Blocking transcript processing on YouTube metadata success | Metadata enriches display but is not a prerequisite for the requested transcript workflow. |
| YouTube descriptions, view counts, durations or private metadata | The reader only needs values already represented by `Video.title`, `publishedAt` and `thumbnail`. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Whether metadata may consume YouTube quota | Add `YOUTUBE_METADATA_MODE=off|data_api`, default `off`; require explicit `data_api` opt-in even if `YOUTUBE_API_KEY` is present for another purpose. | In RSS mode the current docs say the YouTube key may be unused; an unrelated existing key should not silently incur quota. | n |
| Recovery after one failed optional lookup | Record the outcome and do not retry it on automatic polling or transcript retry. | One bounded attempt per unique video avoids turning each two-second job poll into another quota request; video processing remains independent. A separate refresh feature can address later owner recovery if needed. | n |
| Public metadata dates | Display the Data API snippet `publishedAt` as publication date only; retain `addedAt` as the admission date. | The Data API defines these as distinct times and permits the public date to differ from upload time. | n |
| Metadata not returned for an inaccessible video | Keep placeholders and proceed with transcript processing, whose existing result owns availability. | Metadata access does not establish transcript availability, and these pipelines can have different access outcomes. | n |

**Open questions:** none blocking this draft - the quota/configuration choice and failure policy
are explicit defaults proposed for owner review.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| individual video form | empty, loading, error and success states | n/a - admission form is unchanged; existing status/polling handles metadata update |
| video card/detail | updated title, publication date and thumbnail | AC 5–9; retain `Added individually` source label and addition date |
| video card/detail | privacy of channel subscription identity | AC 6; no channel relation or collection is created |
| POST individual video route | response shape, errors, authorization and rate limit | n/a - route is unchanged and retains its existing envelope and admission guards |
| GET videos routes | response shape and authorization | AC 7; existing Video shape with updated values, existing authenticated routes |
| metadata adapter | query, expected data and malformed/empty response | AC 4–5, 11 |
| metadata adapter | authentication, rate limits, timeout and dependency failure | AC 10–14; metadata failure is isolated from transcript outcomes |
| metadata adapter | credential and source-content logging | AC 19; AD-009 fixed low-cardinality telemetry |
| metadata lifecycle | duplicate, retry, restart and source attachment | AC 9, 13–18 |
| operator configuration guide | format, defaults, key requirement, quota and next action | AC 20–22 |
| command/scheduled task | output, flags, exit codes and partial failure | n/a - no command or new schedule is introduced |

## Sources

- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list): filter by video `id`, request `snippet`, documented quota cost of 1 unit, and response item shape.
- [YouTube Data API video resource](https://developers.google.com/youtube/v3/docs/videos): `snippet.title`, `snippet.publishedAt`, `snippet.thumbnails`; public date may differ from upload time.
- [Active project decisions](../../STATE.md), especially AD-009, AD-013 and AD-015–AD-018.
- Existing adapter and behavior in [remote.ts](../../../services/channel-library/api/remote.ts),
  [worker.ts](../../../services/channel-library/api/worker.ts),
  [store.ts](../../../services/channel-library/api/store.ts) and
  [individual-video-import plan](../individual-video-import/plan.md).
