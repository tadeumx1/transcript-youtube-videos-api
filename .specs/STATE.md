# Project State

## Decisions

### AD-001: Use replaceable external adapters

- **Status:** superseded by AD-004
- **Decision:** Caption retrieval, media extraction, and OpenAI transcription are accessed through application-owned interfaces.
- **Reason:** YouTube's unofficial transcript surface and media tools can change independently of the API contract.

### AD-002: Keep request processing stateless

- **Status:** superseded by AD-010
- **Decision:** Transcript results and PDFs are returned synchronously; temporary audio exists only in request-specific directories and is always removed.
- **Reason:** The MVP needs no database and must not retain downloaded media.

### AD-003: Separate free and billable paths

- **Status:** superseded by AD-005
- **Decision:** OpenAI is called only after a known captions-unavailable result, never after an unexpected caption-provider failure.
- **Reason:** This prevents accidental charges and makes failures observable.

### AD-004

- **Decision**: Caption retrieval, media extraction, and Muse transcription use application-owned adapters.
- **Reason**: YouTube, local media tools, and OpenCode Go can change independently of the HTTP contract.
- **Trade-off**: The application maintains explicit translation code for each external boundary.
- **Scope**: Caption and audio transcription infrastructure.
- **Date**: 2026-08-25
- **Status**: active

### AD-005

- **Decision**: Muse consumes OpenCode Go quota only after a typed captions-unavailable result.
- **Reason**: Captions are faster and avoid sending audio to a Contributor model when they are usable.
- **Trade-off**: Caption provider classification must remain precise so unexpected failures never trigger Muse.
- **Scope**: Hybrid transcript orchestration.
- **Date**: 2026-08-25
- **Status**: active

### AD-006

- **Decision**: Every transcript-producing HTTP route requires a server-managed Bearer token, while `/health` remains public and missing auth configuration fails closed.
- **Reason**: Public media processing can exhaust CPU, bandwidth, and the owner's OpenCode Go quota.
- **Trade-off**: Every RAG client must securely store and send one additional credential.
- **Scope**: Fastify transcript and PDF routes in all hosted environments.
- **Date**: 2026-08-25
- **Status**: active

### AD-007

- **Decision**: Railway production infrastructure is managed through `.railway/railway.ts` and builds the checked-in Dockerfile.
- **Reason**: The container owns FFmpeg and pinned `yt-dlp`; current Railway IaC replaces Config as Code before its 2026-12-01 cutoff.
- **Trade-off**: The repository carries the Railway TypeScript SDK as a development dependency and deploy configuration is Railway-specific.
- **Scope**: Production hosting, health checks, service variables, and future Railway configuration changes.
- **Date**: 2026-08-25
- **Status**: active

### AD-008

- **Decision**: Expensive transcript work is admitted and cancelled by an application-owned execution controller using idempotent permits and standard `AbortSignal` propagation.
- **Reason**: The same bounded lifecycle must protect synchronous HTTP routes and future durable workers without depending on Fastify internals.
- **Trade-off**: Every external adapter and application boundary must accept and correctly clean up an optional cancellation signal.
- **Scope**: Transcript HTTP routes, media subprocesses, provider calls, shutdown, and durable job workers.
- **Date**: 2026-08-26
- **Status**: active

### AD-009

- **Decision**: Operational metrics and logs use fixed low-cardinality labels and never include video identifiers, URLs, transcript/audio/PDF content, credentials, provider bodies, or nested cause messages.
- **Reason**: Production diagnosis must not create a second store of source content or secrets and must remain safe for metrics aggregation.
- **Trade-off**: Per-video debugging requires correlation outside application telemetry and bounded operator probes.
- **Scope**: HTTP logging, provider/media diagnostics, Prometheus metrics, readiness, and future worker instrumentation.
- **Date**: 2026-08-26
- **Status**: active

### AD-010

- **Decision**: Successful transcript JSON/PDF artifacts and durable job metadata are retained for bounded TTLs in an application-owned atomic file store on one Railway Volume; temporary audio remains request-scoped and is always removed.
- **Reason**: Durable jobs, restart recovery, deduplication, and local LanceDB ingestion require persistent source artifacts without a new paid database or storage provider.
- **Trade-off**: The service is constrained to one Volume-backed replica, incurs brief redeploy downtime, and needs explicit retention, corruption handling, and backup operations.
- **Scope**: Durable transcript jobs, synchronous artifact cache, Railway deployment topology, and future local RAG ingestion.
- **Date**: 2026-08-26
- **Status**: active

### AD-011

- **Decision**: RAG materializations use one application-owned embedded LanceDB active-chunk table plus atomic file-backed ingestion/recovery state, one local pinned multilingual encoder, and a single writer inside the existing Volume-backed service.
- **Reason**: One per-document Lance transaction gives old-or-new searchable visibility without a paid remote vector/embedding provider or a cross-service store.
- **Trade-off**: The service remains single-replica, the container carries native/model assets, provenance is repeated per chunk, and local storage needs explicit capacity/backup/compaction operations.
- **Scope**: RAG ingestion, retrieval, deletion, model/index evolution, and Railway topology.
- **Date**: 2026-08-26
- **Status**: active

## Handoff

- **Feature**: rag-lancedb (IMP-10)
- **Phase / Task**: Execute / validation round 1 fix loop; T30 next
- **Completed**: T1-T29; T29 gates passed 729/729 local tests and 30/30 offline RAG tests with real post-start fatal, fail-closed HTTP, bounded restart, and post-admission storage evidence
- **In-progress** (file:line): none
- **Next step**: implement T30 production-path telemetry and scrape assertions, then continue T31-T34 in order before independent re-verification
- **Blockers**: GitHub Actions has repository/account-level `startup_failure` with zero jobs and needs owner-side resolution for real container evidence; Railway apply/deploy remains separately approval-gated after the verified fix commit
- **Uncommitted files**: T29 implementation, tests, task evidence, and this Handoff pending atomic commit
- **Branch**: `main`
