# Inspect the video processing queue

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize implementation.

## Problem

The library shows a status on each video and permits an explicit retry for a failed video, but the
owner must scan pages to see what is queued, waiting for a provider or due to retry. `nextAttemptAt`,
stage and bounded failure details are already stored. No alerting or throughput target was given.

The owner will open one view of non-ready videos, see each stage and next retry time, filter by
status, and retry a failed video using the existing route.

## Flow

Reuse stored Video state, existing retry and authenticated APIs, and the single worker.

1. `GET /api/v1/work` in `api/app.ts` (exists) authenticates and reads non-ready Videos in one
SQLite snapshot, ordered by status then `nextAttemptAt` and stable video ID.
2. The response includes counts for all processing statuses and at most 100 video rows with the
existing title/ID, status, stage, attempt count, next attempt and sanitized failure fields.
3. `web/main.tsx` (exists) adds a Work view, status selector, loading/empty/error states and
per-row retry for failed/unavailable states.
4. Retry calls existing `POST /api/v1/videos/:videoId/retry`; its response refreshes the view and
existing worker schedules work. This feature does not cancel, reprioritize or parallelize work.
5. Poll the queue every five seconds using existing session/revision guards; never put source text,
provider body, credentials or job IDs into the response or telemetry.

## Impact

| Front | What changes |
| --- | --- |
| API | New read-only authenticated queue summary; no writes, migration or provider calls. |
| UI | New Work navigation with count, status, stage, retry schedule and explicit eligible retry. |
| ordering | Failed/unavailable first, then due/active/waiting rows by `nextAttemptAt`, then video ID; counts cover the entire non-ready set even though the first page is capped at 100. |
| retry | Existing per-video retry semantics, 30-mutation/minute limit, `Retry-After` and worker behavior remain. |
| privacy | Return only existing safe failure `{code,message}` and no provider bodies or source content, consistent with AD-009. |

## Relations

None - no stored-data shape change. Read existing Videos and failure metadata; retry still updates
the same Video through the existing worker.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `GET /api/v1/work` | optional `status` from non-ready VideoStatus values | `{ counts: Record<VideoStatus, number>, items: VideoWork[], total, limit: 100 }` | 200, 400 invalid/ready status, 401 unauthorized, 503 configuration/storage failure |
| `POST /api/v1/videos/:videoId/retry` | existing video ID | existing `{ videoId, status }` | existing 202, 400 invalid ID, 401, 404, 409 not retryable, 429, 503 |

`VideoWork` contains video ID/title, status/stage, stage attempt count, nextAttemptAt, failure
code/message, and a Boolean indicating an active local attempt. It excludes job ID and transcript.

## Landing

None - no one-way door. The new read route projects current fields and the UI uses existing state and
retry contracts.

## Criteria

### S1: See pending and failed video work together (P1)

**Acceptance Criteria**

1. WHEN an authenticated owner requests `/api/v1/work` THEN the API SHALL return counts for all seven VideoStatus values and all non-ready videos through the existing `{ counts, items, total, limit }` envelope.
2. WHEN queue items exceed 100 THEN the API SHALL return 100 rows with `total` equal to the full count and a deterministic priority/next-attempt/video-ID order.
3. WHEN a status filter is provided THEN the API SHALL accept exactly one non-ready VideoStatus and return only rows/count for that status; IF invalid, `ready`, repeated or non-scalar THEN it SHALL return 400 `INVALID_REQUEST`.
4. WHEN returned work is serialized THEN each row SHALL include the fields in Surface and exclude job IDs, transcript text, notes, provider request/response bodies and credentials.
5. WHEN a row is `retry_wait` THEN its next attempt value SHALL be the stored UTC millisecond timestamp; other states SHALL preserve the stored value without fabricating a schedule.
6. WHEN the route executes THEN it SHALL perform zero provider calls and zero database writes.
7. WHEN the library is unconfigured, unauthorized or storage is unavailable THEN the existing hook SHALL return 503/401 in its current error envelope.

**Independent test:** Seed contrasting statuses and retry timestamps in temporary SQLite, call the
authenticated route, inspect full counts and first 100 deterministic rows, then verify a GET adds
no writes or remote calls.

### S2: Act on failed work from the queue (P1)

**Acceptance Criteria**

8. WHEN an unlocked owner opens Work THEN the UI SHALL show status counts, a status filter, and one row for each returned item with an accessible video-opening action.
9. WHEN a video is active or waiting for automatic retry THEN its row SHALL show the existing stage and status and SHALL NOT offer the manual retry action.
10. WHEN a failed or unavailable video is shown THEN its row SHALL show the sanitized failure and `Retry processing` action.
11. WHEN `Retry processing` succeeds THEN the UI SHALL call the existing retry endpoint, update the row to its returned state and display the existing success/error feedback.
12. IF retry returns 409 or 429 THEN the UI SHALL preserve queue state, display the error and allow a later retry without creating a new attempt.
13. WHEN polling refreshes Work every five seconds THEN a failed background refresh SHALL retain previously loaded rows and show a visible alert.
14. IF the session receives 401 THEN the UI SHALL clear all owner data and return to access lock.
15. WHEN there is no non-ready work THEN the UI SHALL show `No videos are being processed.` with a link to the library.
16. WHEN keyboard actions are used at 390 pixels THEN the queue filter, rows and retry action SHALL remain accessible without horizontal overflow.
17. WHEN the run guide documents Work THEN it SHALL explain status meanings, the next-retry display, that retries are per-video, and that provider availability is not established by local queue status.

**Independent test:** Operate the Work view in a real browser against controlled videos at pending,
retry_wait, failed, unavailable and ready states; retry one failure and verify persisted worker state.

## Out of scope

| Excluded | Why |
| --- | --- |
| Collection-run queue management | Channel collection is a separate pipeline and should get a separately reviewed view. |
| Cancellation, reprioritization, worker concurrency or automatic retry policy changes | Existing AD-008 lifecycle and retry rules stay authoritative. |
| Alerts, dashboards and throughput/service-level targets | No operator threshold or measurement source was supplied. |
| Exposing request IDs, provider payloads or transcript content | Violates fixed telemetry/data disclosure constraints. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Initial result bound | 100 rows; no additional queue pagination in this slice. | Allows a useful backlog view without an unbounded response; total/counts preserve aggregate visibility. | y — owner delegated task details. |
| Retry action | Only failed/unavailable rows expose the existing manual retry; no confirmation dialog. | It reuses the established eligibility contract and is reversible. | y — user delegated. |

**Open questions:** none - bounds and retry semantics were delegated.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Work view | empty/loading/error/unauthorized | AC 8, 13–16 |
| Work view | ordering and density | AC 1–5, 8 |
| Work view | retry confirmation and response | AC 9–12 |
| Work API | shape, status errors, auth, version and rate limit | Surface, AC 1–7 |
| queue collection | counts, upper bound and sort | AC 1–5 |
| provider failures | sanitized outcomes only | AC 4, 7, 12, 17 |
| guide | state meanings and action | AC 17 |
| destructive action | n/a - queue actions do not delete or cancel work |
| command/scheduled task | n/a - no new command or schedule |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- Existing status, retry and recovery contracts in
  [types.ts](../../../services/channel-library/api/types.ts),
  [worker.ts](../../../services/channel-library/api/worker.ts),
  [app.ts](../../../services/channel-library/api/app.ts) and
  [store.ts](../../../services/channel-library/api/store.ts); AD-008/009/016.
