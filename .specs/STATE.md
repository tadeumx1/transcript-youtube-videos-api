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

### AD-012

- **Decision**: The local multilingual E5 encoder uses the immutable official UINT8 ONNX artifact,
  embedding policy version 2, and isolated RAG storage namespace `v2`; the previous `v1` namespace
  is preserved for backup and explicit source reingestion only.
- **Reason**: Signed INT8 arithmetic produced CPU-ISA-dependent embeddings across GitHub x64 runner
  pools, while the official unsigned artifact is portable and preserves every retrieval threshold.
- **Trade-off**: The first deployment starts with an empty searchable `v2`; retained source jobs must
  be explicitly reingested, and expired sources must be retranscribed before reingestion.
- **Scope**: Local embedding model integrity, fingerprint compatibility, RAG storage evolution, CI,
  and Railway operations.
- **Date**: 2026-08-27
- **Status**: active

### AD-013

- **Decision**: Source code, identifiers, comments, tests, the README, and operational documentation
  use English. Portuguese is limited to transcription prompts and rendered transcription content,
  plus PT-BR RAG corpora, queries, and behavioral fixtures.
- **Reason**: One technical language keeps the repository consistent and accessible while preserving
  the Brazilian Portuguese domain behavior that the API must evaluate and produce.
- **Trade-off**: Tests intentionally retain Portuguese strings when the language itself is part of
  the transcription or retrieval behavior under test.
- **Scope**: Repository documentation, implementation, tests, transcription output, and RAG data.
- **Date**: 2026-08-27
- **Status**: active

### AD-014

- **Decision**: New feature work uses the repository-pinned `tlc-spec-lean` skill in
  `.agents/skills/tlc-spec-lean`; historical tlc-spec-driven artifacts remain unchanged.
- **Reason**: The owner explicitly requested the lean workflow and a complete copy of its files
  in this repository for the channel transcript library and new tasks.
- **Trade-off**: Upstream skill updates must be reviewed and explicitly repinned; the lean
  workflow requires plan review before checks/build and independent verification afterward.
- **Scope**: New feature planning, implementation, and verification.
- **Date**: 2026-10-01
- **Status**: active

### AD-015

- **Decision**: The channel library is an independent Node/Fastify and React/Vite application under
  `services/channel-library`, consuming the existing transcript API only through authenticated HTTP.
- **Reason**: Reading and channel scheduling need an independent lifecycle from media extraction.
- **Trade-off**: Operators configure two API processes and separate owner/upstream credentials.
- **Scope**: Channel library integration and future reader features.
- **Date**: 2026-10-01
- **Status**: active

### AD-016

- **Decision**: The single-owner library retains immutable originals and editorial results in its
  own versioned SQLite database, with one worker process, durable cursors, and unique video/channel IDs.
- **Reason**: Source-job TTLs must not remove reading history; retries and restarts must preserve progress.
- **Trade-off**: Library storage needs its own backup/capacity management; multiple writer replicas
  are unsupported and external calls can repeat after a crash before local persistence.
- **Scope**: Library persistence, collection scheduling, and processing recovery.
- **Date**: 2026-10-01
- **Status**: active

## Handoff

- **Feature**: channel-transcript-library
- **Phase**: Complete — independent Round 3 PASS, 56/56 checks proven at `daf868d`.
- **Completed**: complete pinned lean skill; approved plan and proof-backed checks; separate
  Node API and React/Vite reader; durable SQLite collection, retries and recovery; initial ten
  videos and daily discovery; configurable OpenCode Go correction, summary and key points;
  setup documentation and separate library CI workflow. Historical feature specs are unchanged.
- **Evidence**: independent root 740, library backend 69 and Chromium 17 tests passed (826 total).
  Lint, type checks and builds passed. Production server boot/static/auth/shutdown exercised.
  Completion validator exits 0 with no warnings; see the independent verification.md report.
  Library production audit has zero findings; six root dependency findings predate this feature.
- **Authorization**: owner requested continuous execution and approved routine decisions in advance.
- **In-progress**: none for the local implementation. No live-provider success claimed.
- **Next step**: configure `services/channel-library/.env` using its README, run both API services,
  and perform a real channel import. The library process must stay running for daily collection.
- **Live prerequisites**: YouTube Data API key and transcript-service access credential were not
  present locally. OpenCode key was not printed or used for paid validation. Configure a separate
  library owner key. No deployment or push was performed.
- **Uncommitted files**: none after the final verification-record commit.
- **Feature base**: `8310d8cf7884e77cf79ead213d4706300d6c03d6`
- **Verified implementation**: `daf868d1d118e221f5954c11dc0d9fce1bfdd9fe`
- **Branch**: `main`
