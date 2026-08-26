# Production Runtime Hardening Design

**Spec:** `.specs/features/production-runtime-hardening/spec.md`
**Context:** `.specs/features/production-runtime-hardening/context.md`
**Status:** Approved by the user's spec and architecture confirmation

---

## Architecture Choice

| Approach | Strength | Cost and risk |
| -------- | -------- | ------------- |
| Application-owned execution controls with thin Fastify adapters | Framework-independent concurrency/cancellation rules, direct unit tests, reusable by the later durable worker | Adds explicit interfaces and signal propagation through existing layers. |
| Fastify hooks/plugins for all controls | Small route diff and convenient lifecycle access | Couples capacity and cancellation semantics to HTTP, so the later worker cannot reuse them. |
| Railway/proxy limits only | Minimal application code | Cannot provide shared JSON/PDF slots, per-process cancellation, classified provider failures, or deterministic local tests. |

The selected approach is application-owned execution controls with thin Fastify adapters. It is the
only option that satisfies the current synchronous API and remains reusable by the durable worker in
IMP-03. The user approved the recommended architecture together with the runtime specification.

---

## Architecture Overview

```mermaid
flowchart TD
    A[Fastify route] --> B[Authentication and schema validation]
    B --> C[ExecutionController.tryAcquire]
    C -->|full| D[429 + Retry-After]
    C -->|permit + AbortSignal| E[HybridTranscriptService]
    E --> F[YouTube captions]
    F -->|captions unavailable| G[AudioMediaPipeline]
    G --> H[NodeProcessRunner: yt-dlp]
    G --> I[NodeProcessRunner: FFmpeg]
    G --> J[MuseAudioTranscriber]
    E --> K[JSON or local PDF]
    C --> L[RuntimeMetrics]
    E --> L
    G --> L
    J --> L
    M[Fastify preClose] --> N[ExecutionController.abortAll]
    N --> H
    N --> I
    N --> J
    O[/ready] --> N
    P[/metrics + Bearer] --> L
    Q[/openapi.json] --> R[@fastify/swagger]
```

Authentication and Fastify body validation run before the handler. The handler parses the YouTube
URL, obtains a permit, binds client abort to the permit signal, and releases the permit in `finally`.
The same signal reaches caption/audio boundaries, process runner, and Muse fetch. `preClose` marks the
controller not ready and aborts all active permits before Fastify waits for in-flight requests.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to use |
| --------- | -------- | ---------- |
| Fastify Bearer hook and error handler | `src/http/app.ts` | Reuse for `/metrics`, stable envelopes, and code-only logging. |
| Hybrid caption-first orchestration | `src/application/hybrid-transcript-service.ts` | Add signal/metrics without changing the captions-only fallback rule. |
| Request-specific media cleanup | `src/infrastructure/audio/audio-media-pipeline.ts` | Preserve `finally` cleanup while passing process options. |
| Bounded stderr accumulation | `src/infrastructure/audio/process-runner.ts` | Retain the 16384-character bound and add deterministic termination. |
| Muse fetch adapter | `src/infrastructure/audio/muse-audio-transcriber.ts` | Convert HTTP/network/timeout failures at the external boundary. |
| Fastify injection tests | `test/integration/http-app.test.ts` | Extend with held promises, lifecycle routes, metrics, OpenAPI, and redaction. |
| Existing Vitest fake adapters | `test/unit/**/*.test.ts` | Reuse network/process-free tests and fake timers. |
| Existing `npm run check` | `package.json` | Make it the CI source gate without provider secrets. |

### External Components

| Component | Version policy | Purpose |
| --------- | -------------- | ------- |
| `@fastify/swagger` | Pin current Fastify-5-compatible 9.8.1 | Generate OpenAPI from registered route schemas before route registration. |
| `prom-client` | Pin current 15.1.3 | Use an owned, non-global `Registry` with typed fixed labels and Prometheus encoding. |
| `@readme/openapi-parser` | Pin current 8.0.0 as dev dependency | Validate the generated OpenAPI 3.1 document in deterministic tests. |

`@fastify/swagger` 9.x is documented for Fastify 5 and must be registered before routes. `prom-client`
supports non-global registries, counters, gauges, histograms, typed labels, and `registry.metrics()`;
the design uses those APIs and deliberately excludes default process metrics to keep the contract
small and deterministic.

### Integration Points

| System | Integration method |
| ------ | ------------------ |
| Fastify lifecycle | Public liveness/readiness/OpenAPI, protected metrics/transcript routes, and `preClose` abort. |
| Railway | Existing `/health` deploy probe remains unchanged; `/ready` is available for operators and future routing. |
| GitHub Actions | Node 22 checkout/setup-node/npm gates followed by Docker Buildx build without push. |
| OpenCode Go | Existing Responses endpoint with typed status/network/timeout translation and no retry. |

---

## Components

### RuntimeConfig limits

- **Purpose:** Parse bounded concurrency, Retry-After, yt-dlp timeout, FFmpeg timeout, termination
  grace, and Muse timeout from environment values.
- **Location:** `src/config.ts`.
- **Interfaces:** Numeric fields on `RuntimeConfig` and the narrower configuration objects passed to
  each owned component.
- **Validation:** Strict base-10 integers in documented ranges; missing values use spec defaults;
  malformed or out-of-range values fail startup without echoing raw values.
- **Reuses:** Existing `loadConfig` fail-fast pattern.

### ExecutionController and ExecutionPermit

- **Purpose:** Own process-wide transcript admission, lifecycle readiness, and abort of active work.
- **Location:** `src/application/execution-controller.ts`.
- **Interfaces:**
  - `tryAcquire(): ExecutionPermit | undefined` reserves a slot synchronously.
  - `activeCount: number` and `isReady: boolean` expose bounded local state.
  - `beginShutdown(): void` flips readiness and aborts every active permit once.
  - `ExecutionPermit.signal: AbortSignal` is the cancellation source.
  - `ExecutionPermit.release(): void` is idempotent and unregisters the permit.
- **Dependencies:** Maximum concurrency and `RuntimeMetrics` callbacks.
- **Reuses:** None; this becomes the application-owned primitive reused by jobs later.

### Request execution adapter

- **Purpose:** Authenticate/validate first, acquire a permit, bind request cancellation, execute one
  transcript/PDF operation, and release exactly once.
- **Location:** `src/http/app.ts`.
- **Interfaces:** A private `withTranscriptExecution(request, reply, operation)` helper around both
  POST handlers.
- **Dependencies:** `ExecutionController`, public errors, and `RuntimeMetrics`.
- **Reuses:** Existing handler dependency injection and error envelope.

### Abort-aware transcript boundaries

- **Purpose:** Carry cancellation from an HTTP permit through captions, media extraction, Muse, and
  the future worker without coupling domain code to Fastify.
- **Location:** `src/domain/transcript.ts`, `src/application/hybrid-transcript-service.ts`, and
  infrastructure adapters.
- **Interfaces:** `TranscriptOperationOptions { signal?: AbortSignal }`, passed as the final optional
  argument to transcript/fallback/chunk/process operations.
- **Behavior:** Caption fetching may not support active cancellation, but the orchestration checks
  the signal before each expensive stage. Native fetch and media subprocesses consume it directly.

### NodeProcessRunner

- **Purpose:** Execute one child command with bounded stderr, timeout, abort, and escalation.
- **Location:** `src/infrastructure/audio/process-runner.ts`.
- **Interfaces:**
  - `run(command, args, { timeoutMs, signal }): Promise<void>`.
  - Spawned process includes `kill(signal?: NodeJS.Signals): boolean`.
- **Behavior:** Reject before spawn for an already-aborted signal; after spawn, one finalize function
  owns promise settlement and cleanup; timeout/abort sends `SIGTERM`; a separate grace timer sends
  `SIGKILL`; `close` clears both timers/listeners.
- **Diagnostics:** Store at most 16384 stderr characters on an internal process error property; the
  HTTP error handler and logs only use public code/status.

### AudioMediaPipeline process policies

- **Purpose:** Apply distinct yt-dlp and FFmpeg timeouts and propagate cancellation while preserving
  cleanup.
- **Location:** `src/infrastructure/audio/audio-media-pipeline.ts`.
- **Interfaces:** Constructor receives `{ ytDlpTimeoutMs, ffmpegTimeoutMs }`; `withChunks` accepts
  operation options.
- **Reuses:** Existing extraction commands, chunk-size validation, and `finally` directory removal.

### Muse provider classifier

- **Purpose:** Translate transport failures into stable `AppError` codes once, at the external
  boundary, without provider body exposure or retry.
- **Location:** `src/infrastructure/audio/muse-audio-transcriber.ts`.
- **Interfaces:** `createMuseResponsesCreate(apiKey, options?, fetchImpl?)`; response create accepts
  an optional signal.
- **Classification:** 401/403 authentication (503), 429 quota (429 and bounded Retry-After metadata),
  5xx/network (502), AbortSignal timeout (504), invalid JSON/shape/empty output (502).
- **Error model:** `AppError` gains optional public headers owned by the application, limited to a
  validated `Retry-After` header. No arbitrary provider headers are forwarded.

### RuntimeMetrics

- **Purpose:** Record a closed set of local operational signals and render Prometheus text.
- **Location:** `src/infrastructure/observability/runtime-metrics.ts`.
- **Interfaces:**
  - `setActiveJobs(count)`.
  - `recordCapacityRejection(route)`.
  - `recordTranscriptSource(source)`.
  - `observeStage(stage, outcome, seconds)`.
  - `recordStageFailure(stage, reason)`.
  - `contentType` and `render(): Promise<string>`.
- **Metrics:**
  - `youtube_transcript_active_jobs` gauge.
  - `youtube_transcript_capacity_rejections_total{route}` counter.
  - `youtube_transcript_results_total{source}` counter.
  - `youtube_transcript_stage_duration_seconds{stage,outcome}` histogram.
  - `youtube_transcript_stage_failures_total{stage,reason}` counter.
- **Labels:** Mapped through exported allowlist functions; unknown inputs become `unknown`.

### Readiness and metrics routes

- **Purpose:** Expose local lifecycle state and protected metrics without consuming a transcript slot.
- **Location:** `src/http/app.ts`.
- **Behavior:** `/ready` is public 200/503 JSON based only on controller lifecycle; `/metrics` uses
  the existing Bearer hook and registry content type.

### OpenAPI contract

- **Purpose:** Generate an OpenAPI 3.1 contract directly from complete Fastify route schemas.
- **Location:** `src/http/openapi.ts` for shared schemas/registration and `src/http/app.ts` for routes.
- **Interfaces:** `registerOpenApi(app)` before routes and `GET /openapi.json` after `app.ready()`.
- **Schemas:** Request, transcript/segment, every success media type, all stable error envelopes,
  readiness, metrics, and Bearer security scheme. Routes reference shared `$id` schemas where useful.
- **Parity:** An `onRoute` collector records explicit in-scope method/path pairs and tests compare them
  to generated operations; automatic HEAD routes are excluded.

### CI contract

- **Purpose:** Enforce deterministic source and image-build gates on pushes and pull requests.
- **Location:** `.github/workflows/ci.yml` and `test/unit/ci-contract.test.ts`.
- **Behavior:** `contents: read`, checkout, setup-node 22 with npm cache, `npm ci`, `npm run check`,
  Docker setup/buildx build with `push: false`; no secret/environment provider inputs.
- **Reuses:** Existing package scripts and Dockerfile.

### YouTube blocking runbook

- **Purpose:** Diagnose supported public-video failures in bounded stages without bypass instructions.
- **Location:** `docs/runbooks/youtube-datacenter-blocking.md` and a static contract unit test.
- **Behavior:** Health/readiness/auth first, then captions, download, FFmpeg, Muse; time-bounded and
  output-bounded examples; explicit supported/unsupported policy and sanitized error mapping.

---

## Data Models

### TranscriptOperationOptions

```typescript
interface TranscriptOperationOptions {
  signal?: AbortSignal
}
```

### ProcessRunOptions

```typescript
interface ProcessRunOptions {
  timeoutMs: number
  signal?: AbortSignal
}
```

### ExecutionPermit

```typescript
interface ExecutionPermit {
  readonly signal: AbortSignal
  release(): void
}
```

### AppError public metadata

```typescript
interface AppErrorPublicMetadata {
  retryAfterSeconds?: number
}
```

Only the owned `retryAfterSeconds` value may become a response header. Internal diagnostics and
causes remain non-serializable application state.

---

## Error Handling Strategy

| Error scenario | Handling | User impact |
| -------------- | -------- | ----------- |
| Capacity full | Reject before service/PDF work and increment bounded metric | 429 `TRANSCRIPT_CAPACITY_EXCEEDED`, `Retry-After: 30`. |
| Invalid concurrency/timeout config | Fail during `loadConfig` | Process does not start; error names the variable, not its raw value. |
| Media timeout | TERM, grace, KILL if needed, cleanup directory | 504 `AUDIO_PROCESS_TIMEOUT`. |
| Client/shutdown abort | TERM, grace, KILL if needed, cleanup directory | Internal 503 `AUDIO_PROCESS_ABORTED` when a response is still possible. |
| Muse 401/403 | Typed auth failure, no retry/body read | 503 `MUSE_AUTHENTICATION_FAILED`. |
| Muse 429 | Typed quota failure, bounded Retry-After only | 429 `MUSE_QUOTA_EXCEEDED`. |
| Muse timeout | Abort fetch, typed timeout, no retry | 504 `MUSE_TIMEOUT`. |
| Muse 5xx/network | Typed unavailable failure, no retry | 502 `MUSE_UPSTREAM_UNAVAILABLE`. |
| Muse invalid JSON/output | Typed invalid-response failure | 502 `MUSE_INVALID_RESPONSE`. |
| Shutdown readiness | Controller flips before aborting permits | `/ready` returns 503 `not_ready`; `/health` remains liveness-only. |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| ------- | -------------------- | ------ | ---------- |
| Both POST handlers duplicate expensive service calls without a shared boundary | `src/http/app.ts:170` | A fix applied to only one route would leave PDF unbounded. | One shared execution helper and cross-route saturation tests. |
| Logs currently include video IDs | `src/http/app.ts:179` | Video identity is user/source content and violates the new redaction contract. | Remove video IDs; retain only fixed source/stage/outcome values. |
| Process runner has no `kill`, timeout, signal, or listener cleanup contract | `src/infrastructure/audio/process-runner.ts:6` | Stuck tools can retain permits and temporary files indefinitely. | Extend interface and centralize single-settlement cleanup with fake-child tests. |
| Process failure messages currently embed stderr | `src/infrastructure/audio/process-runner.ts:86` | A later broad error log could disclose yt-dlp/FFmpeg diagnostics. | Keep bounded diagnostics in a non-public property and emit code/status only. |
| Muse fetch throws an undifferentiated `Error` | `src/infrastructure/audio/muse-audio-transcriber.ts:172` | Operator cannot separate auth, quota, timeout, transient, or malformed failures. | Classify at fetch/parse boundary with typed `AppError` codes. |
| Muse timeout signal cannot be combined with request/shutdown cancellation | `src/infrastructure/audio/muse-audio-transcriber.ts:169` | Shutdown may wait for the full provider timeout. | Use an owned combined signal and remove listeners after fetch. |
| Server calls `app.close()` without first aborting work | `src/server.ts:13` | Fastify waits for in-flight media work before `onClose`. | `preClose` invokes `ExecutionController.beginShutdown()` before drain. |
| HTTP route schemas currently cover request bodies only | `src/http/app.ts:170` | Generated OpenAPI would omit response/error contracts. | Central shared full schemas and parser/parity tests. |
| No CI workflow exists | `.github/workflows` (absent) | Production gates rely on local discipline. | Add syntax-tested GitHub Actions source and Docker jobs. |

---

## Tech Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Concurrency primitive | Synchronous application-owned permit controller | No race between capacity check and reservation; reusable outside HTTP. |
| Cancellation contract | Standard `AbortSignal` | Native fetch support and no framework-specific token type. |
| Shutdown integration | Fastify `preClose` | It runs after new requests receive 503 but before in-flight requests finish. |
| Metrics library | Owned `prom-client` registry, no global/default metrics | Deterministic tests and a closed public metric contract. |
| OpenAPI | Dynamic `@fastify/swagger` registration with complete route schemas | Keeps documentation tied to executable route definitions. |
| CI | GitHub Actions plus static workflow contract test | Enforces source/container gates and prevents unnoticed secret coupling. |
| Retry policy | None | Avoid duplicate Muse quota use and request amplification. |

The application-owned execution/cancellation boundary and fixed safe observability contract are
project-level decisions recorded in `.specs/STATE.md` as AD-008 and AD-009.
