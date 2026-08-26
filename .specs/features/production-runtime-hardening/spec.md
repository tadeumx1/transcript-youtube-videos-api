# Production Runtime Hardening Specification

## Problem Statement

The deployed API accepts authenticated work but still admits unbounded concurrent media jobs,
allows child processes to run indefinitely, collapses materially different Muse failures, and lacks
readiness, metrics, a machine-readable API contract, automated CI, and a YouTube blocking runbook.
These gaps make a single Railway replica vulnerable to resource exhaustion and make incidents hard
to diagnose without risking transcript, audio, or credential disclosure.

## Goals

- [ ] Bound expensive transcript work and release every admission slot deterministically.
- [ ] Cancel or time out media subprocesses without leaking temporary files or settling twice.
- [ ] Classify Muse failures into stable, sanitized public and operational reason codes.
- [ ] Expose safe liveness, readiness, and bounded operational metrics.
- [ ] Publish and continuously validate the complete HTTP contract.
- [ ] Run source, test, build, and container gates in CI without provider secrets.
- [ ] Document supported diagnosis for YouTube datacenter blocking without bypass guidance.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Durable asynchronous jobs | Covered by IMP-03 after this feature establishes bounded execution. |
| Persistent transcript cache | Covered by IMP-04 with the durable storage decision. |
| Per-customer identities or quotas | The API still has one owner-managed Bearer credential. |
| Automatic provider retries | A retry can duplicate OpenCode Go consumption and remains disabled. |
| Private, age-restricted, members-only, or cookie-authenticated videos | The supported policy remains public videos accessible without identity or restriction bypass. |
| Distributed metrics aggregation | Production currently has one replica; durable jobs will coordinate future multi-process metrics. |
| Transcript persistence and vector ingestion | Covered by IMP-03, IMP-04, and IMP-10. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Admission limit | `MAX_CONCURRENT_TRANSCRIPTS=1` with an accepted range of 1-32 | One job can already use yt-dlp, FFmpeg, Base64 buffers, and Muse quota; one is safe for the current single replica and remains configurable. | no, conservative reversible default |
| Saturation response | HTTP 429 `TRANSCRIPT_CAPACITY_EXCEEDED` with `Retry-After: 30` | It is explicit, machine-readable, and does not start provider or PDF work. | no, standards-aligned default |
| Media time bounds | yt-dlp 300 seconds, FFmpeg 900 seconds, and 5 seconds between `SIGTERM` and `SIGKILL` | Long public videos remain possible while stuck processes and shutdown are bounded. | no, configurable operational default |
| Shutdown behavior | Abort admitted work, stop accepting new work, and let Fastify close after child termination | This preserves temporary-file cleanup and prevents orphaned subprocesses. | no, safe lifecycle default |
| Muse classification | Auth 503, quota 429, timeout 504, network/5xx 502, malformed response 502 | These statuses distinguish operator action, caller backoff, upstream availability, and invalid upstream output. | no, stable API default |
| Metrics exposure | Authenticated `GET /metrics` in Prometheus text format with fixed low-cardinality labels | Standard tooling can scrape it while transcript/video identifiers and operational details remain private. | no, secure observability default |
| Readiness exposure | Public `GET /ready` returning 200 only while the process can admit lifecycle-managed work | Railway and operators need a credential-free readiness signal that performs no paid/external call. | no, platform-safe default |
| OpenAPI exposure | Public versioned document at `GET /openapi.json`; no interactive documentation UI | RAG clients can generate integrations without exposing a new browser surface. | no, minimal contract default |
| CI platform | GitHub Actions on pushes to `main` and pull requests | The repository uses Git and no other CI configuration exists. | no, conventional default |
| YouTube diagnosis | Bounded public-video probes only; cookies, residential proxies, CAPTCHA bypass, and restriction circumvention are unsupported | The service must not turn an operations guide into access-control bypass instructions. | no, security and policy default |
| Remaining implicit dimensions | Persistence, expiry, deduplication, and cross-process ordering are N/A in this feature because no durable state is introduced | Those dimensions are owned by the subsequent durable jobs/cache feature. | no, scope boundary |

**Open questions:** none blocking; the choices above are safe, reversible defaults for the existing
single-owner, single-replica deployment.

---

## User Stories

### P1: Bound expensive transcript work ⭐ MVP

**User Story**: As the API owner, I want a global admission limit so that authenticated traffic
cannot exhaust the service or my transcription quota.

**Why P1**: Every admitted request may start two media tools, retain audio buffers, and call Muse.

**Acceptance Criteria**:

1. **HARD-01** WHEN fewer than `MAX_CONCURRENT_TRANSCRIPTS` jobs are active THEN the system SHALL admit an authenticated JSON or PDF transcript request and reserve exactly one shared slot before provider work starts.
2. **HARD-02** WHILE `MAX_CONCURRENT_TRANSCRIPTS` jobs are active, WHEN another authenticated transcript request arrives THEN the system SHALL return HTTP 429 with error code `TRANSCRIPT_CAPACITY_EXCEEDED` and `Retry-After: 30` without calling transcript or PDF dependencies.
3. **HARD-03** WHEN an admitted JSON or PDF request succeeds, fails, is aborted, or the reply closes THEN the system SHALL release its slot exactly once.
4. **HARD-04** WHEN `GET /health`, `GET /ready`, `GET /openapi.json`, or an authenticated `GET /metrics` is called during saturation THEN the system SHALL answer without acquiring a transcript slot.
5. **HARD-05** IF `MAX_CONCURRENT_TRANSCRIPTS` is missing THEN the system SHALL use 1, and IF it is not an integer from 1 through 32 THEN startup configuration SHALL fail with a sanitized validation error.

**Independent Test**: Hold fake transcript promises open through Fastify injection, prove the
shared JSON/PDF cap, reject overflow before dependencies, and prove release after every terminal
path.

---

### P1: Bound and cancel media subprocesses ⭐ MVP

**User Story**: As the operator, I want yt-dlp and FFmpeg to terminate on timeouts and shutdown so
that stuck tools cannot retain service capacity or temporary files indefinitely.

**Why P1**: The current process runner has no upper bound and cleanup cannot run until it settles.

**Acceptance Criteria**:

1. **PROC-01** WHEN yt-dlp runs longer than 300000 milliseconds or FFmpeg runs longer than 900000 milliseconds THEN the system SHALL send `SIGTERM` and reject with HTTP 504 error code `AUDIO_PROCESS_TIMEOUT` without returning stderr details.
2. **PROC-02** WHILE a media subprocess is running, WHEN application shutdown or request cancellation aborts it THEN the system SHALL send `SIGTERM` and reject with stable error code `AUDIO_PROCESS_ABORTED`.
3. **PROC-03** IF a subprocess has not closed within 5000 milliseconds after `SIGTERM` THEN the system SHALL send `SIGKILL` exactly once.
4. **PROC-04** WHEN `error`, `close`, timeout, abort, and kill-fallback signals race THEN the process runner SHALL settle its promise exactly once and clear all timers and abort listeners.
5. **PROC-05** WHILE stderr is produced THEN the process runner SHALL retain at most 16384 characters for internal diagnostics and public HTTP/log output SHALL exclude that content.
6. **PROC-06** WHEN extraction times out or is aborted THEN the media pipeline SHALL remove its request-specific temporary directory through the existing cleanup boundary.

**Independent Test**: Drive fake child processes and fake timers through graceful close, forced
kill, raced events, bounded stderr, shutdown abort, and temporary-directory cleanup.

---

### P2: Classify Muse failures safely

**User Story**: As the operator, I want stable provider reason codes so that I can distinguish bad
configuration, exhausted quota, timeouts, transient upstream failures, and invalid responses.

**Why P2**: A single 502 hides whether the fix belongs to credentials, waiting, or provider health.

**Acceptance Criteria**:

1. **PROV-01** IF Muse returns HTTP 401 or 403 THEN the system SHALL return HTTP 503 with code `MUSE_AUTHENTICATION_FAILED` and SHALL perform no automatic retry.
2. **PROV-02** IF Muse returns HTTP 429 THEN the system SHALL return HTTP 429 with code `MUSE_QUOTA_EXCEEDED`, copy only a valid bounded `Retry-After` value when present, and SHALL perform no automatic retry.
3. **PROV-03** IF the Muse request exceeds its configured timeout THEN the system SHALL return HTTP 504 with code `MUSE_TIMEOUT` and SHALL perform no automatic retry.
4. **PROV-04** IF Muse returns HTTP 500 through 599 or a network failure occurs THEN the system SHALL return HTTP 502 with code `MUSE_UPSTREAM_UNAVAILABLE` and SHALL perform no automatic retry.
5. **PROV-05** IF Muse returns malformed JSON, an unsupported shape, or empty output THEN the system SHALL return HTTP 502 with code `MUSE_INVALID_RESPONSE` and SHALL perform no automatic retry.
6. **PROV-06** WHEN any Muse failure is logged or returned THEN the system SHALL exclude the API key, authorization header, provider response body, audio Base64, transcript text, and nested cause message.

**Independent Test**: Stub fetch for every status class, network error, timeout, malformed body, and
empty output; assert exact public status/code, one call, and redacted logs/responses.

---

### P2: Observe health, readiness, saturation, and stages

**User Story**: As the operator, I want low-cardinality metrics and readiness so that I can identify
capacity pressure and the failing stage without inspecting user content.

**Why P2**: Request duration alone does not distinguish queue pressure, captions, media, Muse, or PDF.

**Acceptance Criteria**:

1. **OBS-01** WHEN `GET /ready` is called while startup is complete and shutdown has not begun THEN the system SHALL return HTTP 200 with `{ "status": "ready" }` without calling an external dependency.
2. **OBS-02** WHILE shutdown is in progress, WHEN `GET /ready` is called THEN the system SHALL return HTTP 503 with `{ "status": "not_ready" }`.
3. **OBS-03** WHEN an authenticated client calls `GET /metrics` THEN the system SHALL return Prometheus text containing active-job, capacity-rejection, transcript-source, stage-duration, and stage-failure metrics.
4. **OBS-04** WHEN a client calls `GET /metrics` without the configured Bearer token THEN the system SHALL return the existing 401 or fail-closed 503 authentication envelope.
5. **OBS-05** WHEN metric labels are emitted THEN the system SHALL use only documented values for route, stage, source, outcome, and reason and SHALL not include video IDs, URLs, languages, exception messages, or credentials.
6. **OBS-06** WHEN request or stage logs are emitted THEN the system SHALL exclude request/reply authorization, body, transcript text, PDF bytes, audio/Base64, provider bodies, and secret environment values.

**Independent Test**: Use an injected metrics registry and logger stream to assert counter/timer
values, readiness lifecycle, authentication, label allowlists, and content redaction.

---

### P2: Publish an executable OpenAPI contract

**User Story**: As a RAG client developer, I want a versioned OpenAPI document so that requests,
responses, authentication, and failures are generated from an explicit contract.

**Why P2**: README examples do not provide route parity or schema validation.

**Acceptance Criteria**:

1. **API-01** WHEN `GET /openapi.json` is called THEN the system SHALL return a valid OpenAPI 3.1 document with semantic API version `1.0.0`.
2. **API-02** WHEN the document is inspected THEN it SHALL describe `/health`, `/ready`, `/metrics`, `/v1/transcripts`, and `/v1/transcripts/pdf` with their actual methods, request bodies, content types, and status responses.
3. **API-03** WHEN a protected operation is inspected THEN the document SHALL reference an HTTP Bearer security scheme, while health, readiness, and the OpenAPI document SHALL have no security requirement.
4. **API-04** WHEN transcript and error schemas are inspected THEN the document SHALL define every required transcript field, segment field, source variant, precision variant, and stable public error code introduced by the application.
5. **API-05** WHEN the OpenAPI document is generated or snapshot-tested THEN it SHALL not contain environment values, real credentials, production hostnames, transcript content, or provider diagnostics.
6. **API-06** WHEN registered Fastify routes or response schemas change THEN route-parity tests SHALL fail until the OpenAPI contract is updated.

**Independent Test**: Generate the document in-process, validate it structurally, snapshot stable
schemas, and compare registered in-scope methods/paths against documented operations.

---

### P2: Enforce source and container gates in CI

**User Story**: As the maintainer, I want every push and pull request checked automatically so that
type, lint, test, build, and Docker regressions cannot rely on manual validation.

**Why P2**: The current production guarantees exist only when a developer remembers local commands.

**Acceptance Criteria**:

1. **CI-01** WHEN code is pushed to `main` or a pull request targets the repository THEN GitHub Actions SHALL run `npm ci` followed by `npm run check` on Node.js 22.
2. **CI-02** WHEN the source gate succeeds THEN GitHub Actions SHALL build the checked-in Dockerfile without publishing an image.
3. **CI-03** WHEN CI runs without `OPENCODE_API_KEY` and `API_ACCESS_KEY` THEN all deterministic unit, integration, type, lint, build, and container gates SHALL remain executable without network/provider calls.
4. **CI-04** WHEN dependencies are installed in CI THEN the workflow SHALL use the npm cache keyed by the committed lockfile and SHALL grant read-only repository contents permission.
5. **CI-05** IF any source or container gate fails THEN the workflow SHALL fail and branch-protection documentation SHALL identify the required check names for `main`.
6. **CI-06** WHEN workflow files are validated locally THEN their YAML SHALL parse and their referenced npm scripts and Dockerfile SHALL exist.

**Independent Test**: Parse the workflow, assert triggers, permissions, cache, commands, and absence
of secret references; run the same source and Docker gates locally.

---

### P3: Diagnose supported YouTube blocking safely

**User Story**: As the operator, I want a bounded runbook so that I can distinguish caption failure,
media-download blocking, and general service failure without circumventing YouTube restrictions.

**Why P3**: Datacenter egress may fail even while Railway health and authentication remain correct.

**Acceptance Criteria**:

1. **OPS-01** WHEN a production transcript fails THEN the runbook SHALL separate API liveness/readiness, authentication, caption retrieval, audio download, FFmpeg, and Muse diagnosis in that order.
2. **OPS-02** WHEN diagnostic commands are documented THEN they SHALL bound runtime and output, use placeholders for credentials/video IDs, and avoid printing transcript, audio, cookies, tokens, or provider response bodies.
3. **OPS-03** WHEN YouTube rejects a public video from Railway egress THEN the runbook SHALL identify the sanitized public application codes that distinguish unavailable video, caption upstream failure, tool failure, extraction failure, and timeout.
4. **OPS-04** The runbook SHALL state that only public videos accessible without account state are supported and SHALL not prescribe cookies, residential proxies, CAPTCHA solving, IP rotation, or restriction bypass.
5. **OPS-05** WHEN the API is healthy but YouTube access is blocked THEN the runbook SHALL preserve the distinction and SHALL not recommend weakening Bearer authentication, timeouts, or concurrency limits.

**Independent Test**: Statically inspect the runbook for required stages, bounded commands,
sanitized examples, supported-video policy, and prohibited bypass guidance.

---

## Edge Cases

- **HARD-06** IF an unauthorized or schema-invalid request arrives during saturation THEN the system SHALL preserve authentication-before-admission and validation-before-provider behavior and SHALL not consume a slot for a request that cannot start transcript work.
- **PROC-07** IF an abort signal is already aborted before spawn THEN the process runner SHALL reject without spawning the command.
- **PROV-07** IF a non-Muse caption failure occurs THEN the system SHALL preserve its existing YouTube error classification and SHALL not enter the Muse fallback.
- **OBS-07** IF an unrecognized dynamic value reaches metrics instrumentation THEN the system SHALL map it to `unknown` rather than creating a new label value.
- **API-07** IF production-only variables are absent during OpenAPI generation THEN the system SHALL still generate the same public document.
- **CI-07** IF Docker is unavailable on a developer machine THEN local source gates SHALL still run, while CI remains the authoritative container-build gate.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| HARD-01 | Bounded transcript work | Design | Pending |
| HARD-02 | Bounded transcript work | Design | Pending |
| HARD-03 | Bounded transcript work | Design | Pending |
| HARD-04 | Bounded transcript work | Design | Pending |
| HARD-05 | Bounded transcript work | Design | Pending |
| HARD-06 | Bounded transcript work edge case | Design | Pending |
| PROC-01 | Media timeout and cancellation | Design | Pending |
| PROC-02 | Media timeout and cancellation | Design | Pending |
| PROC-03 | Media timeout and cancellation | Design | Pending |
| PROC-04 | Media timeout and cancellation | Design | Pending |
| PROC-05 | Media timeout and cancellation | Design | Pending |
| PROC-06 | Media timeout and cancellation | Design | Pending |
| PROC-07 | Media timeout and cancellation edge case | Design | Pending |
| PROV-01 | Muse failure classification | Design | Pending |
| PROV-02 | Muse failure classification | Design | Pending |
| PROV-03 | Muse failure classification | Design | Pending |
| PROV-04 | Muse failure classification | Design | Pending |
| PROV-05 | Muse failure classification | Design | Pending |
| PROV-06 | Muse failure classification | Design | Pending |
| PROV-07 | Muse failure classification edge case | Design | Pending |
| OBS-01 | Observability and readiness | Design | Pending |
| OBS-02 | Observability and readiness | Design | Pending |
| OBS-03 | Observability and readiness | Design | Pending |
| OBS-04 | Observability and readiness | Design | Pending |
| OBS-05 | Observability and readiness | Design | Pending |
| OBS-06 | Observability and readiness | Design | Pending |
| OBS-07 | Observability and readiness edge case | Design | Pending |
| API-01 | OpenAPI contract | Design | Pending |
| API-02 | OpenAPI contract | Design | Pending |
| API-03 | OpenAPI contract | Design | Pending |
| API-04 | OpenAPI contract | Design | Pending |
| API-05 | OpenAPI contract | Design | Pending |
| API-06 | OpenAPI contract | Design | Pending |
| API-07 | OpenAPI contract edge case | Design | Pending |
| CI-01 | Continuous integration | Design | Pending |
| CI-02 | Continuous integration | Design | Pending |
| CI-03 | Continuous integration | Design | Pending |
| CI-04 | Continuous integration | Design | Pending |
| CI-05 | Continuous integration | Design | Pending |
| CI-06 | Continuous integration | Design | Pending |
| CI-07 | Continuous integration edge case | Design | Pending |
| OPS-01 | YouTube operations runbook | Design | Pending |
| OPS-02 | YouTube operations runbook | Design | Pending |
| OPS-03 | YouTube operations runbook | Design | Pending |
| OPS-04 | YouTube operations runbook | Design | Pending |
| OPS-05 | YouTube operations runbook | Design | Pending |

**Coverage:** 46 total requirements, 0 mapped to tasks, 46 pending design and task mapping.

---

## Success Criteria

- [ ] Saturation tests prove the global cap, dependency short-circuit, and exact slot release on every terminal path.
- [ ] Process-runner tests prove timeout, abort, graceful termination, forced kill, single settlement, stderr bounds, and cleanup.
- [ ] Provider tests prove every classified failure and zero automatic retries or sensitive disclosures.
- [ ] Readiness, Prometheus metrics, and logging tests prove lifecycle behavior and a fixed redacted label/content contract.
- [ ] OpenAPI validation and parity tests cover every in-scope route, schema, security boundary, and stable error envelope.
- [ ] GitHub Actions parses and runs source/container gates without provider credentials.
- [ ] The operations runbook passes static policy and bounded-diagnostic checks.
- [ ] `npm run check` and the Docker build pass before deployment.
