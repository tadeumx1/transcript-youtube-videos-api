# Import a bounded batch of YouTube video URLs

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize implementation.

## Problem

The library accepts one video URL per submission. Owners collecting a small set of references
must repeat the same form, and cannot review duplicates or invalid entries together before work
is queued. The existing API limits mutations to 30 requests per minute and video IDs deduplicate
globally. No batch size preference or throughput measurement was supplied.

The owner will paste and preview up to 20 URLs, explicitly submit valid unique entries and see a
result for every input row. The existing worker handles new videos; no parallel provider calls are
introduced.

## Flow

Reuse `parseVideoUrl`, existing admission/SQLite transaction and worker, with one authenticated
batch request.

1. `web/main.tsx` (exists) parses lines locally for preview, labels valid, invalid and duplicate
video IDs, then asks the owner to submit the preview.
2. `POST /api/v1/videos/batch` in `api/app.ts` (exists) checks the owner, total request limit and
array bounds, validates every URL with existing `parseVideoUrl` and calls a store transaction.
3. `Store.addIndividualVideos` (exists) inserts every new global YouTube ID once; IDs already in
the library or earlier in the same batch return `existing`. Invalid rows are returned per input
without aborting valid unique rows.
4. The endpoint returns ordered outcomes matching input positions. New videos enter the current
worker with no channel subscription or collection. The browser displays created/existing/invalid
counts and retains the preview until the response is received.
5. The guide documents the limit and per-row semantics; processing and credentials remain the
same as individual import.

## Impact

| Front | What changes |
| --- | --- |
| admission | One request can contain 1–20 URL strings; duplicate IDs are admitted once across existing data and the batch. |
| API | New owner-authenticated `POST /api/v1/videos/batch`, body limit 65,536 bytes; a single accepted request consumes one existing mutation slot. |
| storage | No schema change; each new Video uses the current individual admission transaction and video ID primary key. |
| UI | A multiline batch preview and per-input result list appear alongside the existing single-video and channel forms; the single-video route and behavior stay available. |
| worker | Existing one-at-a-time transcription/enrichment worker is reused. Batch acceptance does not promise parallel processing or completion order. |
| failure | Envelope/auth/storage/rate-limit errors reject the whole request before writes; individual invalid URLs are row results and do not roll back valid rows. |

## Relations

None - no stored-data shape change. Every accepted URL resolves to the existing globally unique
Video; there is no Batch entity or persistent batch run.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `POST /api/v1/videos/batch` | `{ items: string[] }`, 1–20 entries, at most 65,536 body bytes | `{ items: [{ index, videoId, outcome, video? , error? }] }` in input order | 200 all rows processed, 400 invalid envelope/count/oversized entry, 401 unauthorized, 413 oversized body, 429 rate limited, 503 configuration/storage failure |

Per-row `outcome` is `created`, `existing` or `invalid`. Invalid rows carry
`{ error: { code: 'INVALID_REQUEST', message } }`; messages contain no submitted URL. A valid
batch with only invalid entries still returns 200 and no writes. Envelope errors retain the
existing `{ error, requestId }` form.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: batch result contract | `POST /api/v1/videos/batch` accepts `{ items: string[] }`; response has one ordered row per input with `index`, optional normalized `videoId`, `outcome: created|existing|invalid`, optional Video or sanitized error. | All-or-nothing input validation gives no useful partial result and would discard valid links because one pasted line is malformed. |
| 2: admission atomicity | The whole envelope is validated before one SQLite transaction inserts unique valid IDs; row-level URL invalidity is a result, not an exception. | One transaction per line exposes partial writes on storage failure and complicates retry/dedup reasoning. |

## Criteria

### S1: Preview and submit a bounded video set (P1)

**Acceptance Criteria**

1. WHEN the batch control is displayed THEN it SHALL provide a labeled multiline input accepting no more than 20 nonblank URL lines and a `Preview videos` action.
2. WHEN preview is requested THEN the UI SHALL show one ordered row per nonblank input with its normalized video ID or `Invalid URL`, and mark repeated IDs in the same input as duplicates before submission.
3. WHEN a preview is submitted THEN the browser SHALL send one authenticated request to `POST /api/v1/videos/batch`; it SHALL not make one request per URL.
4. WHEN the request is pending THEN the browser SHALL disable repeat submission and show `Adding videos…`; it SHALL preserve input and preview on failure.
5. WHEN a batch has 1–20 strings and at most 65,536 JSON bytes THEN the route SHALL validate the envelope before storage writes and return 200 with exactly one ordered outcome for every input row.
6. WHEN a valid new video ID occurs once in the batch and not in the database THEN the store SHALL create one pending unattached Video and return `created` for that row.
7. WHEN a video ID already exists in the database or appears earlier in the batch THEN the route SHALL return `existing`, reference the same video and create no duplicate or collection.
8. IF an individual URL is malformed, unsupported or outside the existing `parseVideoUrl` allowlist THEN its row SHALL return `invalid` with `INVALID_REQUEST`, the normalized ID SHALL be absent and valid other rows SHALL still be stored.
9. WHEN input contains an invalid row before a valid row with the same normalized ID THEN the valid row SHALL be treated as the first valid occurrence and may be created once.
10. IF the envelope is missing, has unknown keys, includes non-string items, is empty or has over 20 rows THEN the route SHALL return 400 and perform zero writes; a body over 65,536 bytes SHALL return 413 before writes.
11. WHEN API key authentication is wrong or missing THEN the route SHALL return 401 and perform zero writes; absent server auth/storage returns existing 503; the mutation budget returns 429 with existing `Retry-After`.
12. WHEN batch submission completes THEN all newly created videos SHALL use the existing worker and processing state; the route SHALL not call transcript, YouTube or LLM providers synchronously.

**Independent test:** Submit valid, invalid, existing and duplicate lines in one HTTP request. Assert
the ordered row results, exact database video count, one mutation-budget increment and no provider
calls from the HTTP request itself.

### S2: Review per-row outcomes in the reader (P1)

**Acceptance Criteria**

13. WHEN the owner previews a batch THEN the UI SHALL show the parsed input count and the created, existing and invalid counts after response.
14. WHEN submission succeeds THEN each row SHALL show its title/ID and its created, already-in-library or validation-failure result without exposing credentials.
15. WHEN the batch has no valid unique IDs THEN the UI SHALL not submit it and SHALL explain that at least one valid video is required.
16. WHEN any row is invalid but other rows succeed THEN the UI SHALL retain and display every row outcome and link created videos to the existing reader.
17. IF the API request fails before row results are returned THEN the UI SHALL preserve all text, show an alert and allow retry without silently clearing inputs.
18. IF the response is 401 THEN the UI SHALL clear private state and return to the existing access screen.
19. WHEN the owner uses preview and outcome controls at 390 pixels or by keyboard THEN all rows and actions SHALL be usable without horizontal page overflow.
20. WHEN the guide describes batch import THEN it SHALL state the 20-line/65,536-byte bounds, supported URL families, row-level validation, duplicate behavior, one-request rate-limit behavior and sequential worker processing.

**Independent test:** In a browser fixture, paste multiple rows with malformed and repeated URLs,
preview them, submit once and inspect the per-row results and opened created reading.

## Out of scope

| Excluded | Why |
| --- | --- |
| Playlist or channel crawling | The batch accepts explicit video URLs only. |
| More than 20 videos, file upload or clipboard import from arbitrary documents | A bounded paste operation is the single supported intake surface. |
| Parallel transcription or provider scheduling changes | Existing single-worker order and quota controls remain authoritative. |
| Rollback of successfully admitted rows after one provider later fails | Provider processing already has per-video retries and outcomes. |
| Persistent Batch entity or resumable batch job | Each Video's existing durable admission is sufficient and deduplicates retries. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Row and byte bounds | 20 rows and 65,536 JSON bytes. | Fits one concise paste while protecting route memory and per-request work. | y — owner delegated task details. |
| Partial validity | Accept valid unique IDs and return per-line invalid results in the same 200 response. | One typo should not require re-pasting accepted links. | y — user delegated. |
| Within-batch duplicate | First valid occurrence is `created` if new; subsequent valid occurrences are `existing`. | Input-order results are deterministic. | y — user delegated. |

**Open questions:** none - bounds and partial-success behavior were delegated.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Library screen | empty/loading/error and response states | AC 1–4, 13–18 |
| Library screen | result order and grouping | AC 2, 13–16; original line order |
| Library screen | duplicate/outlier behavior | AC 7–9, 15–16 |
| Library screen | destructive-action confirmation | n/a - batch admission only adds videos |
| Library screen | keyboard and viewport | AC 19 |
| Batch POST route | envelope, row response and errors | Surface, AC 5–11 |
| Batch POST route | authorization and rate limit | AC 11 |
| Batch items collection | order, uniqueness and partial invalid rows | Landing 1–2, AC 6–9 |
| Video lifecycle | sequential processing and no synchronous providers | AC 12 |
| Guide | bounds and next action | AC 20 |
| command/scheduled task | output/flags/exit/partial failure | n/a - no new command or schedule |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- Existing admission rules and duplicate behavior in
  [video-url.ts](../../../services/channel-library/api/video-url.ts),
  [app.ts](../../../services/channel-library/api/app.ts),
  [store.ts](../../../services/channel-library/api/store.ts), and
  [individual-video-import plan](../individual-video-import/plan.md).
- [Active decisions](../../STATE.md), especially AD-016 and AD-018.
