# Search library transcripts by meaning

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize implementation.

## Problem

The reader has literal title/content search but cannot locate an idea expressed with different
wording. The transcript API already owns a local E5 encoder and LanceDB index; its authenticated
RAG ingestion consumes completed transcript job IDs. The channel library retains its own Original
transcripts after those upstream jobs expire, so late re-ingestion cannot rely on the transcript
service retaining source artifacts forever. No retrieval-quality target was supplied.

The owner will search by meaning in the existing library, see matched transcript passages with
video/title/time attribution, and open the corresponding Original transcript. New sources are
ingested while their upstream job is available; an expired source is clearly marked unindexed.

## Flow

Reuse authenticated transcript API RAG ingestion/search, the existing job-ID source artifacts,
the one library writer, and current video reader. Do not add another encoder, vector store or LLM.

1. When a library Original is saved, `Worker` in `services/channel-library/api/worker.ts` (exists)
   records one local `RagIndex` entry referencing the same completed `jobId`, source video and job
   `expiresAt`; this does not delay/save-fail transcription or enrichment.
2. A single library RAG-index worker (door 1) submits the existing authenticated
   `POST /v1/rag/ingestions` before the source-job expiry, stores returned document/ingestion IDs
   and polls `GET /v1/rag/ingestions/:ingestionId`. Retries are bounded to three with existing
   60/300-second delays and stop at source expiry. Submission is idempotent by job ID.
3. On schema migration, a one-time bounded backfill registers existing Videos with both a stored
   Original and a retained job ID. The existing transcript job status supplies expiry. An expired
   or missing job is marked `source_expired`; no re-transcription or LLM call is started.
4. A protected `POST /api/v1/search` accepts query and existing library filters. The library API
   lists ready `RagIndex` document IDs, splits them into groups of at most 50, and calls the
   existing transcript API `/v1/rag/search` for each group. It deduplicates chunks and merges by
   score/rank to the requested top 20.
5. Search results are intersected with locally existing Videos and requested channel/favorite/read
   filters, returned with indexed/pending/failed counts and only the source fields/passage already
   returned by RAG. No raw transcript enters logs or a new database copy.
6. The reader renders literal match snippets, score/order, YouTube source link and timestamp when
   available. Selecting a result opens that Video's Original transcript tab; time ranges remain
   original-source timestamps, never corrected-prose offsets.
7. RAG capacity/storage/model errors show a sanitized retryable search error. Search results do
   not trigger a new provider generation or answer.
8. Schema version advances one version for the RAGIndex relation; the stopped library is backed
   up before migration. The guide explains that expired upstream jobs cannot be backfilled.

## Impact

| Front | What changes |
| --- | --- |
| domain | Each Video may have one RAGIndex entry with queued/processing/retry_wait/ready/failed/source_expired state; its `jobId` remains the transcript source identity. |
| stored data | New `rag_index` table stores job ID, expiry, ingestion ID, document ID, state, retry time/count and sanitized failure; no transcript text or vectors. Schema migration and stopped-writer backup required. Older binaries cannot reopen the new version. |
| upstream contract | Reuse authenticated `POST /v1/rag/ingestions`, `GET /v1/rag/ingestions/:id`, and `POST /v1/rag/search`; no change to root API or its index schema. |
| library API | Add owner-authenticated `POST /api/v1/search` and read-only `GET /api/v1/rag-index` status; the search route is read-only and does not spend the existing mutation limit. |
| search behavior | Local top-20 semantic results grouped over all indexed documents in batches of at most 50 IDs; user filters intersect hits after retrieval. |
| availability | RAG ingestion/search failures never change video transcript/enrichment status. Videos whose job expires before ingestion completes remain readable and are reported `source_expired` or failed. |
| storage topology | Reuses existing single-owner library DB and transcript service RAG volume under AD-010/011/016. |
| privacy | Passage text is returned only to authenticated owner and never logged. RAG backups retain indexed content under existing RAG lifecycle. |

## Relations

`Video` has zero or one `RagIndex` record. A `RagIndex` points to one transcript job and, after
submission, one RAG document/ingestion. RAG documents/chunks remain owned by the transcript API;
the library stores identifiers and state only. Deleting a library record is not introduced by
this feature.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `POST /api/v1/search` | `{ query, topK?, channelId?, favorite?, read? }`; query 1–1000 code points, topK 1–20 | `{ results, indexed, pending, unavailable }`; result has videoId, title, passage text, score/rank, timestamp range and existing YouTube URL | 200, 400 invalid input, 401 unauthorized, 429 RAG capacity, 502 upstream unavailable, 503 library configuration/storage failure |
| `GET /api/v1/rag-index` | optional status | `{ counts, items }` with video ID/title, state and sanitized failure | 200, 400 invalid status, 401, 503 |
| existing transcript `POST /v1/rag/ingestions` | existing `{ jobId }` | existing submission / idempotent join/hit | 202 accepted, 400 invalid job ID, 401 unauthorized, 404 source unavailable, 409 update in progress, 429 queue capacity, 503 storage/model unavailable |
| existing transcript `GET /v1/rag/ingestions/:ingestionId` | existing ID | existing ingestion state | 200 found, 400 invalid ID, 401 unauthorized, 404 missing, 410 expired, 503 storage unavailable |
| existing transcript `POST /v1/rag/search` | existing query, topK and at most 50 document IDs per call | existing ranked RAG results | 200 results, 400 invalid body, 401 unauthorized, 409 document update in progress, 429 search capacity, 503 storage/model unavailable |

Search rejects an empty indexed set with 200 and `results: []`, plus counts explaining availability;
it never falls back to an unfiltered global RAG search. Error envelopes use existing sanitized
library shape and `Retry-After` for capacity errors.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: persisted indexing lifecycle | Library SQLite `rag_index(video_id TEXT PRIMARY KEY REFERENCES videos, job_id TEXT NOT NULL UNIQUE, source_expires_at TEXT, ingestion_id TEXT, document_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, failure TEXT)`; one row tracks one video's RAG lifecycle, no transcript body. | Store only an ingestion ID on Video JSON: it cannot durably represent pre-submission retries, source expiry, failure state or backfill without changing the public Video contract. |
| 2: transcript-job source boundary | Use existing transcript job ID as source; submit before `source_expires_at`; when unavailable mark `source_expired`. RAG service copies verified source into its own index on accepted ingestion, which then survives source-job TTL. | Copy library Original text into a new endpoint duplicates source ingestion, provenance fields and contracts across services. |
| 3: document-isolated search | Pass only known ready `documentIds`, in groups of at most 50, to the existing RAG route; merge and filter by library Video IDs. | Unfiltered global search could return documents outside this library and cannot guarantee attributable reader navigation. |

These doors shape future indexing/recovery and are recorded here for owner review under the
delegated planning approval. Implementing a broader transcript source contract requires a new
decision before this feature.

## Criteria

### S1: Index originals without changing video processing (P1)

**Acceptance Criteria**

1. WHEN the library saves a completed Original with a source job ID and expiry THEN it SHALL create one `rag_index` row in `queued` state without copying transcript text.
2. WHEN the index worker submits a valid job ID THEN it SHALL use the existing authenticated transcript ingestion endpoint and save the returned ingestion ID/document ID before polling it.
3. WHEN the same submission is repeated after restart THEN the library SHALL reuse the existing job-ID submission so the transcript API returns its existing hit/join instead of creating a second document.
4. WHILE an ingestion is queued or processing THEN the library SHALL persist its state and poll at no less than the existing two-second lower bound.
5. WHEN an ingestion completes THEN the library SHALL mark the row ready and search SHALL include that document ID.
6. IF submission/status receives a retryable network, timeout, 429 or 5xx failure THEN the index worker SHALL retry no more than three times with 60/300-second delays and SHALL stop attempts at `source_expires_at`.
7. WHEN the source is expired, absent or returns a non-retryable RAG/source error THEN the library SHALL persist `source_expired` or `failed` with a sanitized code and leave Video processing/readable content unchanged.
8. IF indexing storage/model/queue is unavailable THEN the library SHALL not set Video status, failure or stage to a RAG-specific value and SHALL continue existing transcript/enrichment work.
9. WHEN schema migration backfills an existing Video THEN it SHALL create a queued RAGIndex only when the Video has an Original and a source job ID; missing/expired jobs SHALL be labeled unavailable without provider reprocessing.
10. WHEN the library stops and starts during ingestion THEN the one-writer recovery SHALL preserve `rag_index` rows and resume or poll their saved state without duplicate source submission.
11. WHEN RAG-index status is serialized THEN it SHALL expose no job key, transcript text, credentials, request body or vector data.

**Independent test:** Use a controlled transcript API implementing the real ingestion/status
contracts, index an Original, restart between 202 and status completion, and assert one document,
one source mapping and unchanged Video transcript/read state.

### S2: Find and open attributable semantic matches (P1)

**Acceptance Criteria**

12. WHEN the owner submits a query of 1–1000 Unicode code points THEN the authenticated library search SHALL call RAG only with ready document IDs associated with this library and SHALL return at most topK results, with default 10 and maximum 20.
13. WHEN ready document IDs exceed 50 THEN the library SHALL issue bounded groups of at most 50 to the existing search endpoint, merge by descending score then video ID/chunk ID, deduplicate chunk IDs and return the requested global topK.
14. WHEN channel, favorite or read filters are supplied THEN each result SHALL also satisfy the matching local Video filter; `indexed`, `pending` and `unavailable` counts SHALL reflect the whole library independent of those result filters.
15. WHEN no ready indexed IDs exist THEN search SHALL return 200 with an empty result array and accurate availability counts without calling global/unfiltered RAG search.
16. WHEN RAG returns a result whose Video ID is not in the authenticated library or no longer has an Original THEN the library SHALL omit it.
17. WHEN a returned result is opened THEN the reader SHALL select that Video and Original transcript tab and show the literal passage, score/rank and source timestamp link when timestamps exist.
18. WHEN RAG reports capacity or storage/model errors THEN search SHALL return a sanitized error preserving safe HTTP status/Retry-After and SHALL not include provider/store messages or query text in logs.
19. WHEN search is requested THEN the route SHALL require the library owner Bearer key, validate the query/body exactly, and SHALL not increment the 30-mutations-per-minute counter.
20. WHEN requests/results are logged THEN telemetry SHALL omit query, passage, title, video ID, notes, credentials and vector content under AD-009.
21. WHEN the reader has empty, loading, successful, failed or expired-session search state THEN its controls/result list SHALL expose corresponding accessible text and retain previously displayed results on a transient failure.
22. WHEN a semantic result passage is rendered THEN it SHALL be escaped/rendered as text, never HTML, and the timestamp SHALL refer only to the immutable Original transcript.
23. WHEN owner config documentation describes semantic search THEN it SHALL state local E5/LanceDB reuse, source-job expiry/backfill limits, provider-free retrieval, the library access key and stopped-writer schema backup.

**Independent test:** Index controlled transcripts with contrasting vocabulary and timestamps; search
through authenticated browser/API fixtures, verify ranking, document isolation, filters, a >50-doc
batch merge, unavailable states and a result opening the exact original passage.

## Out of scope

| Excluded | Why |
| --- | --- |
| Generated answers, chat, external embedding/model providers or prompt calls | This is retrieval-only reuse of the existing local E5/LanceDB index. |
| Arbitrary-text ingestion contract or re-transcribing expired historical jobs | Requires a separate source-provenance decision and can consume provider quota. |
| Search across unrelated transcript/RAG documents | Results must map to authenticated library Videos. |
| Re-embedding/model namespace migration and cross-replica indexing | AD-011/012 and single-replica storage remain authoritative. |
| Automatic deletion from shared RAG index when a library Video is removed | No video deletion route or RAG ownership policy exists. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Source contract | Reuse completed source job IDs and submit immediately when the library receives Original; mark expired jobs unindexed rather than send duplicate transcript content. | Existing RAG verifies/copies source provenance and indexes persist beyond source TTL. | y — owner delegated task details. |
| Search result scope | Restrict each remote request to ready document IDs stored for this library; group IDs by 50 and merge locally. | Prevent unrelated RAG documents from appearing and honor existing API limit. | y — user delegated. |
| Retry policy | Up to three ingestion submission/status attempts before source expiry; RAG never gates Video readiness. | Bounded source job lifecycle and existing provider retry vocabulary. | y — user delegated. |
| Query presentation | Return retrieval passages and citations, no synthesized answer. | Keeps attribution verifiable and adds no LLM call or quota. | y — user delegated. |

**Open questions:** none in the delegated scope. A different source-ingestion architecture that
changes AD-011 requires a separate decision before implementation.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| reader semantic search | empty/loading/error/unauthorized | AC 15, 18–22 |
| reader semantic search | ordering and passage density | AC 12–17, 22 |
| reader semantic search | destructive confirmation | n/a - search and open do not mutate or delete a Video |
| reader semantic search | keyboard and mobile operation | AC 21; existing reader controls |
| library search POST | body/response/error/authorization/rate limit | Surface, AC 12–20 |
| library index GET | response, status selection and error | Surface, AC 11, 23 |
| RAG ingestion collection | idempotency, retry, expiry and recovery | AC 1–11 |
| search-result collection | document grouping/order/dedup/filter | AC 12–17 |
| data lifecycle | source TTL, index retention and backfill | Landing 2, AC 6–10 |
| observability | fixed safe labels and no user content | AC 11, 18, 20 |
| operator guide | configuration, limits, backup and next step | AC 23 |
| command/scheduled task | n/a - reuses the existing library worker; adds no user command or schedule |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- Existing authenticated RAG ingestion/search contracts and search limit in
  [rag-routes.ts](../../../src/http/rag-routes.ts) and [rag domain](../../../src/domain/rag.ts).
- Existing durable source verification and job-expiry handling in
  [rag-ingestion-coordinator.ts](../../../src/application/rag-ingestion-coordinator.ts),
  [job-routes.ts](../../../src/http/job-routes.ts) and `README.md` RAG lifecycle guidance.
- Library `Original`, job ID, retries, SQLite and owner API in
  [types.ts](../../../services/channel-library/api/types.ts),
  [worker.ts](../../../services/channel-library/api/worker.ts),
  [store.ts](../../../services/channel-library/api/store.ts) and AD-009–AD-012/015–017.
