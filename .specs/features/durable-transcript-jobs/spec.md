# Durable Transcript Jobs and Artifact Cache Specification

**Status:** Approved by user on 2026-08-26

## Problem Statement

Long synchronous transcription requests can outlive clients or hosting timeouts, and repeated
requests for the same public video and language preference repeat YouTube, media, Muse, and PDF
work. The API needs a durable asynchronous job contract and a persistent artifact cache without
introducing a paid provider, a native database dependency, or an unsafe automatic retry after an
uncertain provider call.

## Goals

- [ ] Accept durable transcript jobs and expose authenticated status, JSON, and PDF retrieval.
- [ ] Persist job state and artifacts atomically on the approved Railway Volume.
- [ ] Recover queued and partially published work after restart without silently repeating Muse.
- [ ] Deduplicate active/completed submissions and cache successful artifacts for a fixed TTL.
- [ ] Reuse the persistent transcript/PDF cache from the existing synchronous endpoints.
- [ ] Bound the durable queue and preserve the existing global execution limit.
- [ ] Publish the additive HTTP/OpenAPI, readiness, metrics, retention, and privacy contracts.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| LanceDB, chunking, embeddings, and retrieval | Owned by IMP-10 after durable source artifacts exist. |
| Multiple application replicas or distributed writers | A filesystem-backed repository is safe only for the approved single Railway replica. |
| Exactly-once delivery to YouTube or Muse | A process crash can make an external side effect unknowable; this feature prevents automatic uncertain retries. |
| Automatic retry of failed/interrupted jobs | Retrying can repeat OpenCode Go quota consumption; a new authenticated submission is explicit caller intent. |
| Job cancellation or priority APIs | They add state/race semantics not required by IMP-03/IMP-04. |
| Per-user ownership or quotas | The service retains its single owner-managed Bearer credential. |
| Private/restricted YouTube access | The public-video-only policy remains unchanged. |
| Volume backup or cross-region disaster recovery | Railway backup/export policy is an operator concern and must be documented separately. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Durable store | Application-owned, versioned JSON records plus immutable JSON/PDF artifacts written atomically on one Railway Volume | Avoids Redis/Postgres/API spend and native SQLite build risk while remaining testable with real temporary directories. | yes, user approved Volume; file layout pending design approval |
| Production topology | Exactly one application replica and one mounted volume | Railway Volumes are service-local and the store has one writer. | yes, user approved Volume/LanceDB architecture |
| Job endpoints | `POST /v1/jobs`, `GET /v1/jobs/{jobId}`, and JSON/PDF result endpoints | Matches IMP-03 without replacing the compatible synchronous contract. | yes, approved with spec on 2026-08-26 |
| Submission response | Always HTTP 202 with `Location`, `Retry-After: 2`, a non-enumerable UUID job ID, and `miss`, `joined`, or `hit` disposition | The caller can use one polling flow for new, active, and completed work. | yes, approved with spec on 2026-08-26 |
| Queue capacity | `MAX_QUEUED_JOBS=100`, configurable from 1 through 10000 | Persistent work must remain disk/resource bounded; deduplication is evaluated before capacity. | yes, approved with spec on 2026-08-26 |
| Cache identity | SHA-256 over cache schema version, transcript policy version, canonical video ID, and ordered canonical languages | It hides identifiers from filenames, preserves preference order, and supports future invalidation. | yes, approved with spec on 2026-08-26 |
| Language normalization | Omitted languages equal `pt-BR, pt, en`; BCP-47 case is canonicalized, duplicates after canonicalization are rejected, and order is preserved | Equivalent requests deduplicate while language preference remains semantic. | yes, approved with spec on 2026-08-26 |
| Completed artifact TTL | Seven days from transcript publication, non-sliding | Provides useful reuse with bounded retention and an explicit privacy lifecycle. | yes, approved with spec on 2026-08-26 |
| Failed-job retention | 24 hours, followed by a 24-hour expired tombstone | Clients can diagnose failures and distinguish expired from unknown IDs without retaining content indefinitely. | yes, approved with spec on 2026-08-26 |
| Crash recovery | Complete artifact -> completed; transcript-only -> render PDF and complete; no transcript -> failed `JOB_INTERRUPTED` | Avoids an invisible second Muse call after an uncertain crash. | yes, approved with spec on 2026-08-26 |
| Synchronous cache behavior | Read/write successful persistent artifacts, but keep request-owned cancellation and do not join an active durable producer | Repeated completed work is reused without invalidating the verified request-abort contract. | yes, approved with spec on 2026-08-26 |
| Volume size/layout | One 1024 MB volume mounted at `/data`; transcripts use `/data/transcripts` and IMP-10 reserves `/data/lancedb` | Keeps initial storage cost bounded and separates operational records from vectors. | yes, approved with spec on 2026-08-26 |

**Open questions:** none blocking. Defaults are deliberately reversible; exact component boundaries
and file schema will be frozen in Design after this specification is approved.

---

## User Stories

### P1: Submit and retrieve durable transcript jobs ⭐ MVP

**User Story**: As a RAG client, I want to submit a video once and poll durable results so that a
client or proxy timeout does not discard completed transcript work.

**Why P1**: Long media/provider operations do not fit a reliable synchronous-only lifecycle.

**Acceptance Criteria**:

1. **JOB-01** WHEN an authenticated client posts a valid transcript request to `POST /v1/jobs` THEN the system SHALL return HTTP 202, `Location: /v1/jobs/{jobId}`, `Retry-After: 2`, and a submission resource containing exactly `jobId`, `status`, `disposition`, timestamps, and relative status/transcript/PDF links.
2. **JOB-02** WHEN a retained job is read through `GET /v1/jobs/{jobId}` THEN the system SHALL return HTTP 200 with one of `queued`, `processing`, `completed`, or `failed`, its state timestamps, nullable expiry, links, and only a sanitized public failure code/message when failed.
3. **JOB-03** WHEN a completed job's transcript or PDF endpoint is read THEN the system SHALL return the existing `Transcript` JSON contract or byte-identical cached `application/pdf` with the existing safe attachment filename.
4. **JOB-04** WHILE a job is queued or processing, WHEN a result endpoint is read THEN the system SHALL return HTTP 409 `JOB_NOT_COMPLETED` with `Retry-After: 2`; WHEN it is failed THEN the system SHALL return HTTP 409 `JOB_FAILED` without provider diagnostics.
5. **JOB-05** WHEN a syntactically valid but unknown job ID is read THEN the system SHALL return HTTP 404 `JOB_NOT_FOUND`; WHEN a retained tombstone is read THEN the system SHALL return HTTP 410 `JOB_EXPIRED`.
6. **JOB-06** WHEN any job route is called THEN the existing Bearer authentication SHALL run before body, identifier, repository, artifact, or worker access, and missing server authentication SHALL fail closed with the existing 503 envelope.
7. **JOB-07** WHEN a job failure is persisted or exposed THEN it SHALL contain only an allowlisted application error code and fixed public message and SHALL exclude URL, video ID, languages, transcript/PDF/audio, filesystem paths, credentials, provider bodies, stack, and nested cause.

**Independent Test**: Inject a fake coordinator through Fastify, exercise every state and result
boundary, and assert exact status, headers, schemas, authentication order, binary bytes, and
redaction.

---

### P1: Execute one durable worker safely ⭐ MVP

**User Story**: As the operator, I want durable state transitions and conservative restart recovery
so that deploys do not create ambiguous or duplicate provider work.

**Why P1**: A queue is only durable if a process restart cannot silently lose or repeat claimed work.

**Acceptance Criteria**:

1. **WORK-01** WHEN application startup runs THEN the coordinator SHALL initialize and validate the persistent store, reconcile incomplete jobs/artifacts, rebuild active cache-key ownership, and start exactly one worker before durable readiness becomes true.
2. **WORK-02** WHEN a queued job reaches the head of the durable FIFO queue and global transcript capacity is available THEN the worker SHALL acquire one lifecycle-managed permit, atomically claim the job as `processing`, and propagate that permit's `AbortSignal` and metrics through transcript and PDF work.
3. **WORK-03** WHILE global transcript capacity is unavailable THEN the worker SHALL leave the job durably `queued`, wait without incrementing HTTP capacity-rejection metrics, and perform no YouTube, media, Muse, PDF, or artifact publication work.
4. **WORK-04** WHEN a job is already `completed` or `failed`, or its persisted revision/state no longer matches the expected transition, THEN a worker tick SHALL perform no external, PDF, or artifact work and SHALL not overwrite the terminal state.
5. **WORK-05** WHEN the client that received HTTP 202 disconnects THEN the durable job SHALL continue independently; WHEN application shutdown begins THEN readiness SHALL become false, new claims SHALL stop, the active permit SHALL abort, and any claimed job without a complete result SHALL persist a sanitized `JOB_INTERRUPTED` failure before the store closes when possible.
6. **WORK-06** WHEN startup finds a `processing` job THEN a complete verified transcript/PDF bundle SHALL reconcile to `completed`, a verified transcript without PDF SHALL render/persist only the PDF and complete without calling the transcript provider, and a job without a verified transcript SHALL become failed `JOB_INTERRUPTED` without an automatic provider retry.
7. **WORK-07** WHEN the worker succeeds or fails THEN it SHALL release its execution permit exactly once, update active-key ownership and job metrics exactly once, and leave no timer, listener, temporary file, or unhandled rejection.

**Independent Test**: Drive a fake clock, permit source, provider, renderer, and real temporary
filesystem through claim races, no-capacity waiting, success, typed failure, abort, shutdown, and
all three restart-reconciliation branches.

---

### P1: Persist records and artifacts atomically ⭐ MVP

**User Story**: As the API owner, I want crash-consistent files on the Volume so that completed jobs
never point at partial or silently corrupted artifacts.

**Why P1**: Plain direct writes can leave truncated JSON/PDF or an invalid completed state.

**Acceptance Criteria**:

1. **STORE-01** WHEN the store writes a mutable job, cache pointer, manifest, transcript, or PDF THEN it SHALL create a unique temporary file on the same filesystem, sync and close it, atomically rename it, and publish the manifest/cache pointer/completed job only after referenced content is durable.
2. **STORE-02** WHEN artifacts are published THEN their versioned manifest SHALL contain the producer job ID, cache/policy schema versions, creation/expiry timestamps, byte sizes, and SHA-256 checksums for the transcript and optional PDF.
3. **STORE-03** WHEN the store reads an artifact THEN schema, size, and checksum SHALL be verified; incomplete or corrupt content SHALL be quarantined with a content-free name and SHALL never be returned as a cache hit.
4. **STORE-04** WHEN a completed job references missing or corrupt content THEN result retrieval SHALL return sanitized 503 `JOB_STORAGE_UNAVAILABLE` and SHALL not silently retranscribe or change that job to completed with new content.
5. **STORE-05** WHEN startup runs THEN stale temporary files SHALL be removed, corrupt records SHALL be quarantined without logging their contents, and duplicate active jobs for one cache key SHALL deterministically retain the oldest owner while later duplicates become failed `JOB_INTERRUPTED`.
6. **STORE-06** IF the Volume is unavailable, read-only, full, or fails its bounded local write probe THEN durable readiness SHALL be false, new cache-miss job submission SHALL return sanitized 503 `JOB_STORAGE_UNAVAILABLE`, and `/health` plus existing non-storage operational routes SHALL remain callable.
7. **STORE-07** WHILE one replica reads an immutable artifact or publishes it, WHEN expiry runs THEN an application-owned per-key lock SHALL prevent partial read/delete races; expiry SHALL remove the cache pointer before content and retain only a bounded tombstone.
8. **STORE-08** WHEN filesystem paths are derived THEN they SHALL use only validated UUIDs, SHA-256 keys, fixed versioned directory names, and two-character shards under the configured root, never request text or path traversal input.

**Independent Test**: Use real temporary directories and injected failure points around sync/rename,
publish/read/expiry to prove atomic visibility, checksums, quarantine, recovery, `ENOSPC` mapping,
lock behavior, and path confinement.

---

### P2: Deduplicate and cache successful artifacts

**User Story**: As the API owner, I want equivalent requests to reuse prior work so that captions,
Muse quota, and local processing are not consumed repeatedly.

**Why P2**: Durable jobs without canonical identity can still enqueue the same expensive video many
times.

**Acceptance Criteria**:

1. **CACHE-01** WHEN a cache key is computed THEN it SHALL be SHA-256 over canonical JSON containing fixed cache schema and transcript policy versions, canonical video ID, and the canonical language list in caller preference order, without exposing the preimage in a filename, response, log, or metric.
2. **CACHE-02** WHEN languages are omitted THEN they SHALL canonicalize to `pt-BR`, `pt`, `en`; equivalent BCP-47 case SHALL produce the same list/key, order changes SHALL produce a different key, and duplicates after canonicalization SHALL fail validation before repository/provider access.
3. **CACHE-03** WHEN concurrent submissions have the same key THEN exactly one new job SHALL be durably created and returned with `miss`, all concurrent callers SHALL receive that same job ID with `joined`, and exactly one worker execution SHALL be eligible.
4. **CACHE-04** WHEN an unexpired queued or processing owner exists THEN a later equivalent submission SHALL return its job ID with `joined`; WHEN an unexpired completed artifact/job exists THEN it SHALL return the same job ID with `hit`; WHEN only failed, interrupted, corrupt, or expired state exists THEN a new job SHALL be eligible and failures SHALL never become cache entries.
5. **CACHE-05** WHEN `MAX_QUEUED_JOBS` non-terminal jobs exist THEN a new cache miss SHALL return HTTP 429 `JOB_QUEUE_CAPACITY_EXCEEDED` with `Retry-After: 30` before creating a record or calling dependencies, while `joined` and `hit` submissions SHALL still succeed.
6. **CACHE-06** WHEN cached transcript or PDF content is returned THEN its original `source`, `language`, `isGenerated`, `timestampPrecision`, `extractedAt`, segments, text, and PDF bytes SHALL remain unchanged and cache access SHALL not extend expiry.
7. **CACHE-07** WHEN the completed-artifact TTL elapses THEN the cache pointer and JSON/PDF SHALL expire, the completed job SHALL become a 24-hour tombstone, and a later equivalent submission SHALL create new work; failed jobs SHALL expire after 24 hours and their tombstones after another 24 hours.
8. **CACHE-08** WHEN an existing synchronous JSON/PDF request is made THEN it SHALL reuse a verified completed transcript/PDF cache entry before provider work and SHALL publish successful new transcript/PDF content for later reuse, while cache miss/error paths preserve existing auth, admission, cancellation, response, and failure contracts.

**Independent Test**: Use URL variants, canonical/default/reordered languages, concurrent submits,
fake time, failures, corruption, and the existing synchronous routes to prove exact job identity,
single-flight, fixed TTL, metadata/byte preservation, provider call counts, and no failure caching.

---

### P2: Operate the durable subsystem safely

**User Story**: As the operator, I want bounded configuration, readiness, metrics, and an executable
OpenAPI contract so that jobs can be deployed and diagnosed without inspecting source content.

**Why P2**: Persistent work adds disk, queue, worker, expiry, and API states that existing metrics do
not describe.

**Acceptance Criteria**:

1. **OPS-01** WHEN configuration loads THEN `DATA_ROOT`, `MAX_QUEUED_JOBS`, completed/failed/tombstone TTLs, and sweep interval SHALL use documented defaults and strict bounded validation with sanitized variable-name-only errors.
2. **OPS-02** WHEN Railway IaC is inspected THEN it SHALL declare one 1024 MB Volume mounted at `/data`, one application replica, `DATA_ROOT=/data/transcripts`, preserved existing secrets, and no database or public storage resource.
3. **OPS-03** WHEN `GET /ready` is called THEN it SHALL return 200 only while lifecycle, initialized writable storage, and worker state are ready; it SHALL return the existing exact 503 body without calling YouTube, media, Muse, or another network dependency otherwise.
4. **OPS-04** WHEN job/cache metrics are rendered THEN they SHALL expose fixed-label submission disposition, current queued/processing counts, terminal duration/outcome, cache outcome, recovery outcome, and storage health without job IDs, video IDs/URLs, languages, cache keys, paths, content, credentials, or exception messages.
5. **OPS-05** WHEN the OpenAPI document is generated THEN it SHALL use additive version `1.1.0`, describe all four protected job operations, exact schemas/headers/statuses/error codes, retain existing operations, and pass parser, snapshot, route-parity, security, and secret-absence tests.
6. **OPS-06** WHEN logs or public errors cover submission, state transitions, recovery, cache, storage, or expiry THEN they SHALL use only fixed event/outcome/reason values and SHALL exclude all persisted request/artifact content and identifiers prohibited by AD-009.
7. **OPS-07** WHEN local development or tests run without a Railway mount THEN the default data root SHALL stay gitignored and replaceable by a temporary directory; deterministic tests and OpenAPI generation SHALL require no provider credential or network access.
8. **OPS-08** WHEN retention and deployment are documented THEN README/runbook SHALL state fixed non-sliding TTLs, single-replica/Volume constraints, no automatic retry after interrupted work, possible data loss without Volume backup, and the reserved `/data/lancedb` namespace for IMP-10.

**Independent Test**: Validate every config boundary and IaC field statically; inject coordinator
health into Fastify; assert metric label allowlists/log redaction; and parse/snapshot the complete
OpenAPI document without credentials.

---

## Edge Cases

- **EDGE-01** IF a valid submission joins or hits an existing key while the queue is full THEN it SHALL return HTTP 202 for that existing job instead of 429.
- **EDGE-02** IF a process dies after transcript persistence but before PDF/completed publication THEN restart SHALL render only the PDF and SHALL not call YouTube, media, or Muse again.
- **EDGE-03** IF a process dies after an external call but before transcript persistence THEN restart SHALL fail the job as `JOB_INTERRUPTED` and SHALL not infer success or retry automatically.
- **EDGE-04** IF a cached artifact expires while a response is reading it THEN the per-key lock SHALL allow either the complete old artifact or the post-expiry result, never partial bytes or an unhandled filesystem error.
- **EDGE-05** IF equivalent language tags differ only in case or default omission THEN they SHALL deduplicate, while a different preference order SHALL remain a cache miss.
- **EDGE-06** IF a cache/store write fails after a synchronous transcript was already produced THEN the original synchronous response contract SHALL remain available and the cache failure SHALL be sanitized/observable without changing the provider result.
- **EDGE-07** IF two active records for one key are found after a crash THEN only the oldest created job SHALL remain runnable and every later duplicate SHALL become sanitized failed state without provider work.
- **EDGE-08** IF a job ID or cache key does not match its strict format THEN no filesystem path SHALL be accessed.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| JOB-01 | Submit/retrieve durable jobs | T11, T12 | Planned |
| JOB-02 | Submit/retrieve durable jobs | T2, T11, T12 | Partial (T2 complete) |
| JOB-03 | Submit/retrieve durable jobs | T11, T12 | Planned |
| JOB-04 | Submit/retrieve durable jobs | T11, T12 | Planned |
| JOB-05 | Submit/retrieve durable jobs | T8, T11, T12 | Partial (T8 complete) |
| JOB-06 | Submit/retrieve durable jobs | T12, T13 | Planned |
| JOB-07 | Submit/retrieve durable jobs | T2, T11, T12 | Partial (T2 complete) |
| WORK-01 | Durable worker lifecycle | T10, T15 | Planned |
| WORK-02 | Durable worker lifecycle | T5, T10 | Partial (T5 complete) |
| WORK-03 | Durable worker lifecycle | T5, T10 | Partial (T5 complete) |
| WORK-04 | Durable worker lifecycle | T2, T10 | Partial (T2 complete) |
| WORK-05 | Durable worker lifecycle | T5, T10, T13, T15 | Partial (T5 complete) |
| WORK-06 | Durable worker lifecycle | T10 | Planned |
| WORK-07 | Durable worker lifecycle | T5, T10 | Partial (T5 complete) |
| STORE-01 | Atomic persistent store | T6 | Completed |
| STORE-02 | Atomic persistent store | T7 | Completed |
| STORE-03 | Atomic persistent store | T7 | Completed |
| STORE-04 | Atomic persistent store | T7 | Completed |
| STORE-05 | Atomic persistent store | T8 | Completed |
| STORE-06 | Atomic persistent store | T7, T15 | Partial (T7 complete) |
| STORE-07 | Atomic persistent store | T7, T8 | Completed |
| STORE-08 | Atomic persistent store | T6, T7, T8 | Completed |
| CACHE-01 | Deduplication/cache | T1 | Completed |
| CACHE-02 | Deduplication/cache | T1 | Completed |
| CACHE-03 | Deduplication/cache | T11 | Planned |
| CACHE-04 | Deduplication/cache | T11 | Planned |
| CACHE-05 | Deduplication/cache | T11 | Planned |
| CACHE-06 | Deduplication/cache | T7, T9 | Partial (T7 complete) |
| CACHE-07 | Deduplication/cache | T8, T11 | Partial (T8 complete) |
| CACHE-08 | Deduplication/cache | T9, T13 | Planned |
| OPS-01 | Durable operations | T3 | Completed |
| OPS-02 | Durable operations | T16, T17, T18 | Planned |
| OPS-03 | Durable operations | T13, T15 | Planned |
| OPS-04 | Durable operations | T4 | Completed |
| OPS-05 | Durable operations | T14 | Planned |
| OPS-06 | Durable operations | T4, T13, T20 | Partial (T4 complete) |
| OPS-07 | Durable operations | T3, T17, T18, T19 | Partial (T3 complete) |
| OPS-08 | Durable operations | T20 | Planned |
| EDGE-01 | Queue capacity edge case | T11 | Planned |
| EDGE-02 | Partial publication edge case | T7, T10 | Partial (T7 complete) |
| EDGE-03 | Uncertain external side effect edge case | T10 | Planned |
| EDGE-04 | Read/expiry race edge case | T7 | Completed |
| EDGE-05 | Language identity edge case | T1 | Completed |
| EDGE-06 | Synchronous cache-write edge case | T7, T9, T13 | Partial (T7 complete) |
| EDGE-07 | Duplicate recovery edge case | T8, T11 | Partial (T8 complete) |
| EDGE-08 | Path-confinement edge case | T2, T6, T7, T8, T12 | Partial (T2, T6, T7, T8 complete) |

**Coverage:** 46 total requirements, 46 listed, 0 unmapped after Tasks assigns implementation phases.

---

## Success Criteria

- [ ] All four job operations pass authenticated integration tests for every state/header/status.
- [ ] Worker tests prove capacity waiting, claim idempotency, conservative restart, shutdown, and exact permit release.
- [ ] Real-filesystem tests prove atomic visibility, checksum validation, quarantine, recovery, expiry, and path confinement.
- [ ] Cache tests prove canonical identity, concurrent single-flight, hit/miss/failure/expiry, and synchronous reuse.
- [ ] Queue and storage failures remain bounded, sanitized, observable, and readiness-aware.
- [ ] OpenAPI 1.1, IaC Volume, metrics, documentation, and all prior contracts pass deterministic gates.
- [ ] Independent verification maps all 46 requirements and kills mutations across state, storage, cache, HTTP, and IaC.
