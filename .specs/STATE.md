# Project State

## Current hosting

- **Reported on 2026-10-13**: The owner removed the Railway deployment because of its costs.
  Railway is no longer the active hosting target (AD-020).
- **Local operation**: The existing host workflow and local Docker Compose setup (AD-019)
  remain available; no replacement hosted environment has been selected.
- **Historical evidence**: Railway feature specs, deployment reports, and checked-in IaC
  describe the former deployment, not a currently running service.
- **Recovery documentation**: [Local Docker operation](../docs/docker.md) covers the same API,
  jobs and RAG capabilities plus the library/reader. The [redeployment procedure](../README.md#redeploy-the-transcript-api)
  records how to restore Railway hosting, configure secrets, recover compatible data and verify
  a new deployment. Updated on 2026-10-13 at the owner's request; no deployment was performed.

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
- **Status**: superseded by AD-020

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
- **Status**: active for persistence and retention; Railway hosting superseded by AD-020

### AD-011

- **Decision**: RAG materializations use one application-owned embedded LanceDB active-chunk table plus atomic file-backed ingestion/recovery state, one local pinned multilingual encoder, and a single writer inside the existing Volume-backed service.
- **Reason**: One per-document Lance transaction gives old-or-new searchable visibility without a paid remote vector/embedding provider or a cross-service store.
- **Trade-off**: The service remains single-replica, the container carries native/model assets, provenance is repeated per chunk, and local storage needs explicit capacity/backup/compaction operations.
- **Scope**: RAG ingestion, retrieval, deletion, model/index evolution, and Railway topology.
- **Date**: 2026-08-26
- **Status**: active for embedded RAG and single-writer storage; Railway hosting superseded by AD-020

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

### AD-017

- **Decision**: Library schema 2 stores owner reading state alongside video metadata; partial owner
  edits never modify immutable source/enrichment. Export remains authenticated and escapes content.
- **Reason**: Favorites, read status and notes must survive browser sessions and worker updates.
- **Trade-off**: Older schema-1 service binaries cannot open the migrated database; backups precede upgrades.
- **Scope**: Library reading metadata, filters and portable Markdown export.
- **Date**: 2026-10-02
- **Status**: active

### AD-018

- **Decision**: Schema 3 permits videos without a followed channel, adds a durable `addedAt`,
  and preserves global YouTube video identity. `POST /api/v1/videos` accepts one supported URL;
  admission creates no channel and uses the existing processing worker. Later channel discovery
  attaches real metadata without resetting processing or owner reading state.
- **Reason**: The owner approved saving an individual video without following its entire channel.
- **Trade-off**: Individual titles initially use the video ID; publication dates remain unknown.
  Schema 1/2 migrate atomically; older binaries require restoring the pre-upgrade backup.
- **Scope**: Individual video admission, library schema, reader and export.
- **Date**: 2026-10-04
- **Status**: active

### AD-019

- **Decision**: Local Docker operation uses three Compose services (`transcript`, `library`, `web`),
  an internal authenticated API network, loopback-only dynamically allocated web publication,
  and project-scoped `transcript-data`/`library-data` named volumes isolated from host development.
- **Reason**: The owner approved one-command container startup with combined logs and coexistence
  with other local applications on 2026-10-05.
- **Trade-off**: Container operation runs production builds; the first build downloads native/model
  assets. Host library data requires an explicit stopped-writer backup/restore to import.
- **Scope**: Local Compose packaging, make targets, WSL prerequisites and persistent local data.
- **Date**: 2026-10-05
- **Status**: active

### AD-020: Retire Railway hosting due to costs

- **Decision**: Record the owner's removal of the Railway deployment and stop treating Railway
  as the active production environment. Existing local host and Docker workflows remain the
  operational baseline; no replacement hosting provider has been selected.
- **Reason**: The owner reported removing the deployment because of its costs.
- **Trade-off**: The former Railway endpoint is no longer an assumed available integration target.
  A future hosted deployment needs a new hosting decision and deployment work.
- **Scope**: Supersedes AD-007 and the Railway-specific hosting assumptions in AD-010 and AD-011.
  Persistence, retention, authentication, embedded RAG, and single-writer requirements remain active.
  Historical feature artifacts and checked-in Railway configuration are retained as reference.
- **Evidence**: Owner report on 2026-10-13; this documentation update does not independently
  verify remote resources, retained data, or billing status.
- **Date**: 2026-10-13
- **Status**: active

## Handoff

- **Hosting update (2026-10-13)**: Railway deployment removed by the owner due to costs; see AD-020.
  Previous deployment/UAT evidence is historical. Use the existing local workflows for operation.

- **Feature**: docker-all-applications
- **Phase**: complete; independent verification passed all 17 checks and the completion gate.
- **Approved**: the owner requested implementation on 2026-10-05; profile light.
- **Implemented**: three images, Compose networking/volumes, four make targets, WSL and
  backup/restore documentation, deterministic launcher tests and real-container browser proofs.
- **Proofs**: 14 container tests, 6 launcher tests, 766 transcript API tests (including the
  26 host regressions), 153 library tests and 27 headless browser tests passed. Lint, typecheck
  and production builds passed. The broad API run used --maxWorkers=2 and ran separately from
  Docker proofs because both exercise the default host ports. Provider tests use fixtures and
  do not claim live YouTube/OpenCode success.
- **Workspace**: feature branch codex/docker-all-applications in an isolated worktree;
  feature base d8377dc68d8182f77a51226fda76acc56f54dde8 snapshots existing uncommitted work.
  Only the verified Docker feature diff is copied into the owner's main workspace; existing
  uncommitted work is preserved. No remote push or deployment was performed.
- **Environment**: Docker engine and Compose work via the already assigned docker group;
  the old WSL login requires newgrp docker or a fresh login to load that membership.
- **Additional request**: unit/integration/UI validation completed using the existing suites
  and the official Playwright skill in headless mode. CLI checks covered login, reading,
  corrected transcript, favorites, saved notes and a 390px mobile viewport with no horizontal
  overflow or console errors. No browser window was opened; fixture server/browser were stopped.
  Local evidence: output/playwright/docker-validation/reader-mobile.png.
- **Preserved history**: prior reading/import specs retain their original reports; the real
  video repair completed before containerization. Host data remains separate from Docker volumes.
