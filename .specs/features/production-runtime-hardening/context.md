# Production Runtime Hardening Context

**Gathered:** 2026-08-26
**Spec:** `.specs/features/production-runtime-hardening/spec.md`
**Status:** Approved for design

---

## Feature Boundary

Harden the existing synchronous API with bounded admission, cancellable media processes, classified
Muse failures, readiness and metrics, a versioned OpenAPI contract, CI gates, and a safe YouTube
operations runbook. Durable jobs, caching, persisted artifacts, and RAG ingestion remain separate
follow-up features.

---

## Implementation Decisions

### Runtime protection

- Use an application-owned, process-wide admission controller shared by JSON and PDF routes.
- Default to one active transcript operation, configurable from 1 through 32.
- Reject overflow immediately with HTTP 429 and `Retry-After: 30`; do not maintain an in-memory
  waiting queue because durable queuing belongs to IMP-03.
- Authentication and request validation remain ahead of admission; public operational routes never
  consume transcript capacity.

### Cancellation and process lifecycle

- Carry `AbortSignal` through the HTTP/application/media boundaries.
- Use operation-specific configurable timeouts: five minutes for yt-dlp and fifteen minutes for
  FFmpeg.
- Send `SIGTERM`, wait five seconds, then send `SIGKILL` if the process has not closed.
- Abort active application work during shutdown and preserve the existing temporary-directory
  `finally` cleanup.

### Errors and diagnostics

- Classify Muse authentication, quota, timeout, upstream/network, and malformed-output failures with
  stable public codes while keeping response bodies, credentials, audio, transcript text, and nested
  causes out of logs and responses.
- Keep automatic provider retries disabled.
- Preserve existing caption-provider classification; unexpected caption failures never trigger Muse.

### Observability and contract

- Keep `/health`, `/ready`, and `/openapi.json` public and dependency-free.
- Protect `/metrics` with the same Bearer credential as transcript routes.
- Emit Prometheus text with a closed label vocabulary and no per-video or user-provided labels.
- Generate OpenAPI 3.1 from the route schemas and validate route parity in tests; do not add a docs UI.

### Delivery and operations

- Use the existing Vitest unit/integration conventions and `npm run check` source gate.
- Add GitHub Actions for Node.js 22 source checks and a non-publishing Docker build without secrets.
- Document only bounded public-video diagnostics. Cookies, residential proxies, CAPTCHA solving, IP
  rotation, and restriction circumvention are unsupported.

### Agent's Discretion

- Internal class and interface names, module boundaries, and exact metric names consistent with
  Prometheus conventions.
- Choice between a small owned Prometheus encoder and a dependency, provided the fixed-label and
  redaction criteria remain testable.
- OpenAPI generation library and schema composition strategy.
- CI job names, provided the documented branch-protection names match the workflow.

### Declined / Undiscussed Gray Areas → Assumptions

- No per-client queue, priority, cancellation endpoint, or distributed semaphore is introduced in
  this feature.
- Readiness reflects local lifecycle/configuration only and never spends provider quota.
- Metrics reset on process restart; persistent operational state belongs to the durable platform.

---

## Specific References

- Existing HTTP/auth boundary: `src/http/app.ts`.
- Existing composition and shutdown: `src/app.ts`, `src/server.ts`.
- Existing media boundaries: `src/infrastructure/audio/process-runner.ts` and
  `src/infrastructure/audio/audio-media-pipeline.ts`.
- Existing Muse HTTP adapter: `src/infrastructure/audio/muse-audio-transcriber.ts`.
- User approval: “Aprovo a spec, Volume/LanceDB e subagentes.”

---

## Deferred Ideas

- Durable jobs, restart recovery, cache and artifact expiry: IMP-03/IMP-04.
- Volume-backed LanceDB, local multilingual embeddings, ingestion and retrieval evaluation: IMP-10.
