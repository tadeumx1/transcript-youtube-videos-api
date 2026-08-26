# Project State

## Decisions

### AD-001: Use replaceable external adapters

- **Status:** superseded by AD-004
- **Decision:** Caption retrieval, media extraction, and OpenAI transcription are accessed through application-owned interfaces.
- **Reason:** YouTube's unofficial transcript surface and media tools can change independently of the API contract.

### AD-002: Keep request processing stateless

- **Status:** active
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

## Handoff

- **Feature**: production-runtime-hardening
- **Phase / Task**: Execute approved; batch 1 (T1-T7) ready to dispatch
- **Completed**: validated 46-requirement spec, approved context/design, AD-008/AD-009, and validated 11-task/two-batch execution plan
- **In-progress** (file:line): none
- **Next step**: dispatch approved batch 1 for T1-T7, verify its commits/gates, then dispatch batch 2 for T8-T11
- **Blockers**: none
- **Uncommitted files**: `.specs/STATE.md` and `tasks.md` approval status pending execution-start commit
- **Branch**: `main`
