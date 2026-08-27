# Production Improvement Backlog

**Source:** Repository audit for Railway production deployment on 2026-08-25
**Status:** Delivered and independently verified on 2026-08-27

These follow-up tasks were delivered through three cohesive TLC features. The original problem,
outcome, acceptance checks, and dependency notes remain below as the historical delivery contract;
the table is the authoritative completion index.

## Delivery Traceability

| Improvement | Delivery feature | Verified requirements | Independent evidence | Status |
| ----------- | ---------------- | --------------------- | -------------------- | ------ |
| IMP-01 | production-runtime-hardening | HARD-01..06 | [validation](../production-runtime-hardening/validation.md) | Verified |
| IMP-02 | production-runtime-hardening | PROC-01..07 | [validation](../production-runtime-hardening/validation.md) | Verified |
| IMP-03 | durable-transcript-jobs | JOB-01..07, WORK-01..07, STORE-01..08, CACHE-03..07, OPS-02..05 | [validation](../durable-transcript-jobs/validation.md) | Verified |
| IMP-04 | durable-transcript-jobs | CACHE-01..08 | [validation](../durable-transcript-jobs/validation.md) | Verified |
| IMP-05 | production-runtime-hardening | PROV-01..07 | [validation](../production-runtime-hardening/validation.md) | Verified |
| IMP-06 | production-runtime-hardening | OBS-01..07 | [validation](../production-runtime-hardening/validation.md) | Verified |
| IMP-07 | production-runtime-hardening | API-01..07 | [validation](../production-runtime-hardening/validation.md) | Verified |
| IMP-08 | production-runtime-hardening + rag-lancedb | CI-01..07, OPS-10 | [hardening](../production-runtime-hardening/validation.md), [RAG](../rag-lancedb/validation.md) | Verified |
| IMP-09 | production-runtime-hardening | OPS-01..05 | [validation](../production-runtime-hardening/validation.md) | Verified |
| IMP-10 | rag-lancedb | ING-01..08, VER-01..08, CHUNK-01..06, EMB-01..04, SEARCH-01..08, LIFE-01..06, CAP-01..02, OPS-01..10, EDGE-01..10 | [validation](../rag-lancedb/validation.md) | Verified |

## Prioritized Tasks

### IMP-01: Bound concurrent media/transcription jobs — P1

**Problem:** Every authenticated request can start `yt-dlp`, FFmpeg, Base64 buffering, and Muse calls.
**Outcome:** A configurable global concurrency limit admits bounded work and rejects overflow with
HTTP 429 plus `Retry-After`, without affecting `/health`.
**Acceptance checks:** concurrent integration tests prove the cap, slot release after success/error,
and no media/provider calls for rejected work.
**Depends on:** Railway production baseline.

### IMP-02: Add subprocess timeout and cancellation — P1

**Problem:** `NodeProcessRunner` has no upper time bound, so a stuck media process can hold resources
and delay temporary-file cleanup indefinitely.
**Outcome:** `yt-dlp` and FFmpeg receive explicit operation timeouts, terminate on abort/shutdown,
and map timeout to a stable sanitized error.
**Acceptance checks:** fake-child tests prove graceful termination, forced kill fallback, single
promise settlement, bounded stderr, and cleanup after timeout.
**Depends on:** None.

### IMP-03: Introduce durable asynchronous transcript jobs — P1

**Problem:** A synchronous long-video request can exceed client or platform timeouts.
**Outcome:** `POST /v1/jobs` returns 202 and a job ID; authenticated status/result endpoints expose
queued, processing, completed, and failed states; a worker processes one video independently.
**Acceptance checks:** state-transition integration tests, idempotent worker execution, restart
recovery, expiry policy, and separate JSON/PDF result retrieval.
**Depends on:** IMP-01 and a confirmed Redis/database/object-storage choice.

### IMP-04: Deduplicate and cache transcript artifacts — P2

**Problem:** Repeated requests for the same video/language set repeat YouTube and possibly Muse work.
**Outcome:** A normalized video/language cache key reuses successful JSON/PDF artifacts for a defined
TTL while never caching transient failures.
**Acceptance checks:** hit/miss/expiry tests, language-order semantics, concurrent single-flight
behavior, and explicit source/extraction metadata policy.
**Depends on:** Storage choice; ideally IMP-03.

### IMP-05: Classify provider failures and quota signals — P2

**Problem:** Muse authentication, quota/rate limit, server, malformed, and network failures currently
collapse into one 502 code, limiting operational diagnosis.
**Outcome:** Internal structured reason codes distinguish configuration, quota/429, timeout, and
transient provider failures while public messages remain sanitized and automatic retries remain off
unless separately approved.
**Acceptance checks:** exact status/reason tests for 401/403/429/5xx/network/timeout/malformed output;
provider response bodies and credentials never appear in logs.
**Depends on:** None.

### IMP-06: Add production observability and readiness — P2

**Problem:** Logs show request duration/source but not queue pressure, media duration, chunk count,
per-stage latency, or dependency readiness.
**Outcome:** Structured counters/timers and a readiness endpoint expose resource saturation and stage
failures without transcript/audio/credential content.
**Acceptance checks:** metric-label allowlist tests, readiness degradation tests, and log-redaction
regression tests.
**Depends on:** IMP-01; coordinate with IMP-03 if jobs are introduced.

### IMP-07: Publish an OpenAPI contract — P2

**Problem:** RAG clients must infer request/response/error shapes from README examples.
**Outcome:** Versioned OpenAPI documents health, authenticated JSON/PDF endpoints, Bearer security,
all error envelopes, and transcript schemas.
**Acceptance checks:** schema snapshot/validation, route-schema parity, and no production secrets in
the document.
**Depends on:** Production auth baseline.

### IMP-08: Add continuous integration and container build gates — P2

**Problem:** `npm run check` and Docker compatibility currently depend on manual execution.
**Outcome:** CI runs `npm ci`, `npm run check`, and a Docker build on pushes and pull requests with
dependency caching but no provider secrets.
**Acceptance checks:** workflow syntax validation, no secret requirement for tests, and protected
branch documentation.
**Depends on:** None.

### IMP-09: Define YouTube datacenter-blocking operations — P3

**Problem:** YouTube may block Railway egress IPs even when the API itself is healthy.
**Outcome:** An operator runbook distinguishes caption vs download blocking, documents supported
cookie/proxy boundaries, and prevents unsafe restriction bypass.
**Acceptance checks:** sanitized error examples, bounded diagnostic commands, and a clear supported
public-video policy.
**Depends on:** Live Railway evidence from T6.

### IMP-10: Add RAG-native artifact ingestion — P3

**Problem:** The API returns PDF/JSON but does not chunk, embed, version, or ingest automotive source
documents into the agent's vector store.
**Outcome:** A separate ingestion service persists source/provenance, produces retrieval-aware chunks,
and updates a selected vector database without repeating transcription.
**Acceptance checks:** confirmed storage/provider decision, deterministic chunk coverage, provenance
links, idempotent re-ingestion, deletion/expiry behavior, and retrieval evaluation on Brazilian
vehicle questions.
**Depends on:** IMP-03/IMP-04 and a confirmed RAG platform.
