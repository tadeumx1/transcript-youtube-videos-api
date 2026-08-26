# Production Improvement Backlog

**Source:** Repository audit for Railway production deployment on 2026-08-25
**Status:** Proposed after the initial protected deployment

These are independently deliverable follow-up tasks. Each should become its own TLC feature (or a
small cohesive feature group) before execution so architecture and operational cost can be confirmed.

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
