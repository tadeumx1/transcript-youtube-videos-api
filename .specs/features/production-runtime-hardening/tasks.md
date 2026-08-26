# Production Runtime Hardening Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute
flow and Critical Rules.** The skill is the source of truth for per-task tests, gates, atomic commits,
sequential batch delegation, independent verification, and requirement traceability.

**If the skill cannot be activated, STOP and tell the user.**

---

**Design:** `.specs/features/production-runtime-hardening/design.md`
**Status:** In Progress (approved by user on 2026-08-26)

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found:
> `README.md`, `package.json`, `vitest.config.ts`, `biome.json`, and sampled tests
> `test/unit/config.test.ts`, `test/unit/process-runner.test.ts`,
> `test/unit/audio-media-pipeline.test.ts`, `test/unit/hybrid-transcript-service.test.ts`,
> `test/unit/muse-audio-transcriber.test.ts`, `test/unit/muse-audio-fallback.test.ts`,
> `test/unit/youtube-caption-provider.test.ts`, and `test/integration/http-app.test.ts`.
> No contributor testing standard exists; strong defaults apply to every acceptance criterion and
> listed edge case.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Runtime config and application-owned controllers | unit | All parsing/state branches; 1:1 coverage for limits, readiness, permits, idempotency, and edge cases | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Process/media/provider infrastructure | unit | Every success, error, timeout, abort, race, cleanup, classification, retry, and redaction branch | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Fastify routes, auth, metrics, and OpenAPI | integration | Every in-scope route: happy, auth, saturation, readiness, schema, response, failure, and parity paths | `test/integration/**/*.test.ts` | `npm run test:integration` |
| CI and runbook contracts | unit/static | Every required trigger, permission, command, secret prohibition, diagnostic stage, bound, and policy statement | `test/unit/**/*-contract.test.ts` | `npm run test:unit` |
| Type-only schema/config declarations | none | Build, lint, and downstream behavioral gates only | `src/**/*.ts` | `npm run check` |

## Gate Check Commands

> Generated from the existing TypeScript/Vitest repository and confirmed dependency-free test style.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After application/domain/infrastructure work covered by unit tests | `npm run test:unit` |
| Full | After route/OpenAPI work or any cross-layer integration | `npm test` |
| Build | After a phase, dependency/config, CI, or documentation contract | `npm run check` |
| Container | After CI/Docker-affecting work and before deployment | `docker build -t transcript-youtube-videos-api:verify .` |

---

## Execution Plan

Phases run sequentially. The original phases packed into two approved TLC worker batches: Phase 1
plus Phase 2 (seven tasks), then Phase 3 plus Phase 4 (four tasks). The first verifier found three
surviving mutants; Phase 5 contains one atomic regression task for each gap.

### Phase 1: Runtime primitives

```text
T1 -> T2 -> T3
```

### Phase 2: External work lifecycle

```text
T4 -> T5 -> T6 -> T7
```

### Phase 3: HTTP observability and contract

```text
T8 -> T9
```

### Phase 4: Delivery and operations

```text
T10 -> T11
```

### Phase 5: Verifier regression fixes

```text
T12 -> T13 -> T14
```

---

## Task Breakdown

## Phase 1 Tasks

### T1: Parse bounded runtime hardening configuration ✅

**What:** Add strict environment parsing for transcript capacity, Retry-After, media timeouts,
termination grace, and Muse timeout with the approved defaults and bounds.
**Where:** `src/config.ts`
**Depends on:** None
**Reuses:** Existing `optionalValue`, `parsePort`, `RuntimeConfig`, and configuration unit-test style
**Requirement:** HARD-05, PROC-01, PROC-03, PROV-03

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] Missing variables resolve to capacity 1, Retry-After 30 seconds, yt-dlp 300000 ms, FFmpeg 900000 ms, process grace 5000 ms, and Muse 300000 ms.
- [x] Capacity accepts only integers 1-32; every duration accepts only the documented positive bounded range.
- [x] Invalid values fail startup with the variable name but never echo the raw value.
- [x] `.env.example` and README configuration tables include the new variables without secrets.
- [x] Unit tests cover every default, minimum, maximum, malformed, fractional, zero, negative, and out-of-range branch.
- [x] `npm run test:unit` passes with at least 93 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(config): parse runtime hardening limits`

### T2: Create a fixed-label runtime metrics registry ✅

**What:** Implement an owned Prometheus registry for active jobs, capacity rejections, transcript
sources, stage duration, and stage failures with closed label mappers.
**Where:** `src/infrastructure/observability/runtime-metrics.ts`
**Depends on:** T1
**Reuses:** Design metric names and existing dependency-injection conventions
**Requirement:** OBS-03, OBS-05, OBS-07

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] `prom-client` 15.1.3 is pinned and each application receives a non-global registry.
- [x] The registry exposes exactly the five designed custom metric families and Prometheus content type.
- [x] Route, stage, source, outcome, and reason values pass through fixed allowlists; unknown values map to `unknown`.
- [x] Metric output contains no video IDs, URLs, languages, exception text, transcripts, audio/PDF content, or credentials.
- [x] Unit tests cover each metric family, allowlist, unknown mapping, registry isolation, and render output.
- [x] `npm run test:unit` passes with at least 100 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(observability): add bounded runtime metrics`

### T3: Create the transcript execution controller ✅

**What:** Implement synchronous bounded admission, idempotent permits, readiness state, and abort-all
shutdown using application-owned `AbortController` instances.
**Where:** `src/application/execution-controller.ts`
**Depends on:** T2
**Reuses:** `RuntimeMetrics.setActiveJobs` and capacity-rejection instrumentation
**Requirement:** HARD-01, HARD-02, HARD-03, HARD-04, OBS-01, OBS-02

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] `tryAcquire` reserves atomically up to the configured maximum and returns no permit after saturation or shutdown.
- [x] A permit owns one signal and an idempotent release that decrements the active gauge exactly once.
- [x] `beginShutdown` flips readiness before aborting all active permits and remains idempotent.
- [x] Operational callers can inspect exact active count and readiness without acquiring a slot.
- [x] Unit tests cover cap boundaries, cross-route-neutral permits, success/error-style release, double release, shutdown abort, acquisition after shutdown, and metrics updates.
- [x] `npm run test:unit` passes with at least 107 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(runtime): bound transcript execution`

## Phase 2 Tasks

### T4: Add deterministic timeout and abort to subprocess execution ✅

**What:** Extend `NodeProcessRunner` with timeout, `AbortSignal`, `SIGTERM`/`SIGKILL` escalation,
bounded internal stderr, and a single cleanup/settlement path.
**Where:** `src/infrastructure/audio/process-runner.ts`
**Depends on:** T1
**Reuses:** Existing safe spawn argument contract, stderr bound, and `AppError`
**Requirement:** PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, PROC-07

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] An already-aborted signal rejects with `AUDIO_PROCESS_ABORTED` before spawn.
- [x] Timeout and live abort send `SIGTERM`; only a still-open process receives one `SIGKILL` after grace.
- [x] Timeout maps to 504 `AUDIO_PROCESS_TIMEOUT`; cancellation maps to 503 `AUDIO_PROCESS_ABORTED`.
- [x] Error/close/timeout/abort/kill races settle once and remove both timers, abort listeners, and stderr listeners.
- [x] At most 16384 stderr characters are retained internally and never appear in the public error message.
- [x] Fake-child/fake-timer unit tests cover success, spawn error, non-zero close, timeout graceful close, forced kill, abort, pre-abort, raced events, bounded stderr, and cleanup.
- [x] `npm run test:unit` passes with at least 116 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(media): bound subprocess lifecycle`

### T5: Apply process policies and cleanup in the media pipeline ✅

**What:** Pass distinct yt-dlp/FFmpeg timeouts and the operation signal into the process runner while
preserving request-directory cleanup for every terminal path.
**Where:** `src/infrastructure/audio/audio-media-pipeline.ts`
**Depends on:** T4
**Reuses:** Existing commands, chunk ordering/size checks, and `finally` cleanup
**Requirement:** PROC-01, PROC-02, PROC-06

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] yt-dlp receives the configured 300000 ms default and FFmpeg receives the configured 900000 ms default.
- [x] The same caller signal reaches both subprocess stages and chunk consumption.
- [x] Timeout/abort errors retain their typed codes instead of collapsing into extraction failure.
- [x] The request-specific directory is removed after download timeout, conversion timeout, abort, consumer failure, and success.
- [x] Unit tests assert exact runner options, stage ordering, typed propagation, no later-stage calls after failure, and cleanup.
- [x] `npm run test:unit` passes with at least 121 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(media): propagate cancellation policies`

### T6: Classify and redact Muse provider failures ✅

**What:** Translate Muse HTTP, network, timeout, parse, and output failures into stable `AppError`
codes with optional validated Retry-After metadata and zero retries.
**Where:** `src/infrastructure/audio/muse-audio-transcriber.ts`
**Depends on:** T5
**Reuses:** Existing Responses request, sequential chunks, Base64 input, and no-retry behavior
**Requirement:** PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] 401/403, 429, 5xx, network, timeout, malformed JSON/shape, and empty output map to the exact spec status/code.
- [x] Only a numeric or HTTP-date Retry-After value within the owned bound is retained; arbitrary provider headers are discarded.
- [x] Request cancellation combines with the configured Muse timeout and all listeners/timers are removed.
- [x] Every failure path calls fetch/create exactly once and never retries a chunk.
- [x] Public errors/log fixtures exclude API key, authorization, provider body, audio Base64, transcript text, and nested cause messages.
- [x] Unit tests cover each status, network rejection, timeout, caller abort, malformed JSON, malformed shape, empty output, header bounds, sequential success, and zero retry.
- [x] `npm run test:unit` passes with at least 132 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(muse): classify provider failures`

### T7: Propagate cancellation and stage telemetry through transcript orchestration ✅

**What:** Add the optional transcript operation contract and carry its signal/metrics through
caption-first orchestration, audio fallback, media, and Muse without changing fallback eligibility.
**Where:** `src/domain/transcript.ts`
**Depends on:** T6
**Reuses:** Existing `TranscriptProvider`, `AudioFallback`, `HybridTranscriptService`, and source normalization
**Requirement:** PROV-07, PROC-02, PROC-06, OBS-03, OBS-05, OBS-06

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] `TranscriptOperationOptions` carries an optional signal through service/fallback/chunk interfaces.
- [x] Pre-aborted work stops before the next caption, media, chunk, or Muse stage.
- [x] Unexpected caption failures still propagate without invoking audio; only typed caption unavailability falls back.
- [x] Captions, download, conversion, Muse, and PDF-adjacent orchestration emit only allowlisted stage/source/outcome/reason telemetry.
- [x] Logs no longer include video IDs, URLs, languages, transcript text, or nested cause messages.
- [x] Unit tests cover signal propagation, pre-stage aborts, caption failure non-fallback, source counters, stage success/failure timings, and redaction.
- [x] `npm run test:unit` passes with at least 138 tests and no silent deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(transcript): propagate execution context`

## Phase 3 Tasks

### T8: Enforce admission, readiness, metrics, and shutdown at the HTTP boundary ✅

**What:** Wire the execution controller and metrics into Fastify, share guarded execution between
JSON/PDF, expose public readiness and protected metrics, forward owned Retry-After, and abort on
`preClose` or client cancellation.
**Where:** `src/http/app.ts`
**Depends on:** T3, T7
**Reuses:** Existing Bearer hook, request schema, error envelopes, handlers, and `createApplication`
**Requirement:** HARD-01, HARD-02, HARD-03, HARD-04, HARD-06, OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] Auth and Fastify validation reject before admission; valid JSON/PDF requests share the exact configured cap.
- [x] Overflow returns 429 `TRANSCRIPT_CAPACITY_EXCEEDED` and `Retry-After: 30` before transcript/PDF dependencies.
- [x] Success, application error, PDF error, client abort, and shutdown release each permit exactly once.
- [x] `/health`, `/ready`, `/openapi.json`, and authenticated `/metrics` bypass transcript admission during saturation.
- [x] `/ready` returns exact 200/503 lifecycle bodies; `/metrics` preserves existing fail-closed Bearer behavior and Prometheus content type.
- [x] Owned Muse quota Retry-After metadata is forwarded while arbitrary error/provider headers are not.
- [x] Integration logs contain only method, route template, status, duration, fixed source/stage/outcome/reason, and no prohibited content.
- [x] Integration tests cover held cross-route concurrency, every release path, saturation short-circuit, auth/validation order, operational routes, shutdown/client abort, public headers, and redaction.
- [x] `npm test` passes with at least 154 tests and no silent deletions.

**Tests:** integration
**Gate:** full
**Commit:** `feat(api): enforce runtime capacity and readiness`

### T9: Generate and validate the OpenAPI 3.1 contract ✅

**What:** Register complete shared route/response schemas and serve a versioned OpenAPI 3.1 document
whose operations match every in-scope Fastify route.
**Where:** `src/http/openapi.ts`
**Depends on:** T8
**Reuses:** Actual Fastify schemas, authentication/error contracts, transcript types, and route registration
**Requirement:** API-01, API-02, API-03, API-04, API-05, API-06, API-07

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] `@fastify/swagger` 9.8.1 and `@readme/openapi-parser` 8.0.0 are pinned at runtime/dev scope respectively.
- [x] `/openapi.json` returns OpenAPI 3.1.0 and API version 1.0.0 without production servers or values.
- [x] All five in-scope paths and methods describe exact bodies, media types, success/error statuses, schemas, and security boundaries.
- [x] Transcript fields/enums, segments, readiness, metrics, Bearer auth, and every stable public error code are represented.
- [x] Parser validation, stable schema snapshot, route parity, security, secret absence, and no-runtime-config tests pass.
- [x] `npm test` passes with at least 162 tests and no silent deletions.

**Tests:** integration
**Gate:** full
**Commit:** `feat(openapi): publish versioned api contract`

## Phase 4 Tasks

### T10: Add CI source and container gates ✅

**What:** Add a least-privilege GitHub Actions workflow for Node.js 22 source checks and a
non-publishing Docker build, plus a static workflow contract test and branch-protection guidance.
**Where:** `.github/workflows/ci.yml`
**Depends on:** T9
**Reuses:** `npm ci`, `npm run check`, root Dockerfile, and committed lockfile
**Requirement:** CI-01, CI-02, CI-03, CI-04, CI-05, CI-06, CI-07

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] Pushes to `main` and pull requests run Node.js 22 `npm ci` and `npm run check` with setup-node npm cache.
- [x] A dependent container job performs Buildx `build` with `push: false` and no provider/API secrets.
- [x] Workflow permissions are `contents: read`; action versions are pinned to stable major tags.
- [x] Static tests parse YAML and assert triggers, job dependency, permissions, commands, cache, Dockerfile, and no secret references.
- [x] README documents exact required check names for optional `main` branch protection.
- [x] `npm run check` passes with at least 166 tests and no silent deletions.
- [x] `docker build -t transcript-youtube-videos-api:verify .` succeeds when Docker is available; otherwise the CI container gate remains authoritative and the absence is recorded.

Local container evidence: Docker is unavailable in this execution environment (`docker: command not
found`); the checked-in `Container build` job is the authoritative image-build gate per CI-07.

**Tests:** unit/static
**Gate:** build and container
**Commit:** `ci: enforce source and container gates`

### T11: Publish the bounded YouTube blocking runbook ✅

**What:** Document a staged, time/output-bounded production diagnosis and supported public-video
policy, backed by a static contract test and linked from the README.
**Where:** `docs/runbooks/youtube-datacenter-blocking.md`
**Depends on:** T10
**Reuses:** Existing public error codes, Railway domain, health/auth contract, and media tool commands
**Requirement:** OPS-01, OPS-02, OPS-03, OPS-04, OPS-05

**Tools:**

- MCP: Railway CLI for bounded read-only status/log evidence only
- Skill: `tlc-spec-driven`, `use-railway`

**Done when:**

- [x] The runbook checks liveness/readiness/auth, captions, yt-dlp, FFmpeg, and Muse in that order.
- [x] Every diagnostic uses placeholders, explicit timeout/output bounds, and excludes transcript/audio/cookies/tokens/provider bodies.
- [x] Sanitized examples distinguish video unavailable, caption upstream, tool unavailable, extraction, process timeout, Muse auth/quota/timeout/upstream/invalid response, and platform health.
- [x] The supported policy is limited to public videos without account state and explicitly excludes cookies, residential proxies, CAPTCHA solving, IP rotation, or restriction bypass.
- [x] A static unit test fails if required stages/bounds/policy/error codes disappear or prohibited guidance appears.
- [x] README links the runbook and preserves Bearer, timeout, and capacity requirements during provider incidents.
- [x] `npm run check` passes with at least 169 tests and no silent deletions.

**Tests:** unit/static
**Gate:** build
**Commit:** `docs(operations): add youtube blocking runbook`

## Phase 5 Tasks

### T12: Discriminate AbortSignal listener cleanup ✅

**What:** Add direct evidence that `NodeProcessRunner` removes the exact caller abort listener after
normal close and after rejection, killing verifier mutant M10.
**Where:** `test/unit/process-runner.test.ts`
**Depends on:** T11
**Reuses:** Existing fake child, fake timers, and process-listener cleanup assertions
**Requirement:** PROC-04

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [x] Tests spy on caller-signal listener registration/removal and prove the same listener/options are removed exactly once after success and failure.
- [x] The test fails when `removeEventListener('abort', onAbort)` is removed from the runner.
- [x] Existing single-settlement, timer, process listener, and stderr listener assertions remain unchanged.
- [x] `npm run test:unit` passes with 164 unit tests; the full-suite baseline is expected to reach at least 213 after this task.

**Tests:** unit
**Gate:** quick
**Commit:** `test(media): assert abort listener cleanup`

### T13: Make CI gates fail closed

**What:** Strengthen the static workflow contract so source and container gates cannot tolerate
failure through `continue-on-error`, killing verifier mutant M12.
**Where:** `test/unit/ci-contract.test.ts`
**Depends on:** T12
**Reuses:** Parsed workflow fixture and exact source/container step assertions
**Requirement:** CI-05

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [ ] Every source and container job/step is asserted not to set `continue-on-error: true`.
- [ ] The contract test fails when `continue-on-error: true` is added to `npm run check` or Docker build.
- [ ] Existing job names, dependency, permissions, commands, and branch-protection assertions remain unchanged.
- [ ] `npm run test:unit` passes with at least 214 tests and no silent deletions.

**Tests:** unit/static
**Gate:** quick
**Commit:** `test(ci): require fail-closed gates`

### T14: Require transcript-output suppression in diagnostics

**What:** Strengthen the runbook contract so every transcript diagnostic discards its response body,
killing verifier mutant M9.
**Where:** `test/unit/youtube-blocking-runbook-contract.test.ts`
**Depends on:** T13
**Reuses:** Parsed bounded command blocks and required-stage assertions
**Requirement:** OPS-02

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [ ] Every command that calls `/v1/transcripts` or `/v1/transcripts/pdf` is identified explicitly.
- [ ] Each identified transcript command is asserted to include `--output /dev/null` or an equivalent explicit body sink.
- [ ] The contract test fails when the sink is removed from the runbook command.
- [ ] Existing timeout, output-bound, placeholder, policy, error-code, and prohibited-guidance assertions remain unchanged.
- [ ] `npm run check` passes with at least 215 tests and no silent deletions.

**Tests:** unit/static
**Gate:** build
**Commit:** `test(operations): require transcript output sink`

---

## Phase Execution Map

```text
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5

Phase 1: T1 -> T2 -> T3
Phase 2: T4 -> T5 -> T6 -> T7
Phase 3: T8 -> T9
Phase 4: T10 -> T11
Phase 5: T12 -> T13 -> T14
```

Cross-phase dependencies are declared in task bodies. Execution is strictly sequential and the
approved subagent batches never overlap.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | One runtime config parser extension | ✅ Granular |
| T2 | One metrics registry component | ✅ Granular |
| T3 | One execution controller component | ✅ Granular |
| T4 | One process runner component | ✅ Granular |
| T5 | One media pipeline policy integration | ✅ Granular |
| T6 | One Muse boundary classifier | ✅ Granular |
| T7 | One cross-layer operation context contract | ✅ Cohesive interface change |
| T8 | One HTTP execution/operations boundary | ✅ Cohesive route integration |
| T9 | One generated OpenAPI contract | ✅ Granular |
| T10 | One CI contract | ✅ Granular |
| T11 | One operator runbook contract | ✅ Granular |
| T12 | One process-listener regression contract | ✅ Granular |
| T13 | One CI fail-closed regression contract | ✅ Granular |
| T14 | One runbook output-suppression regression contract | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | Phase start | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 | T2 -> T3 | ✅ Match |
| T4 | T1 (cross-phase) | Phase 2 start | ✅ Match; cross-phase implied |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T3, T7 (cross-phase) | Phase 3 start | ✅ Match; cross-phase implied |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T9 (cross-phase) | Phase 4 start | ✅ Match; cross-phase implied |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T11 (cross-phase) | Phase 5 start | ✅ Match; cross-phase implied |
| T13 | T12 | T12 -> T13 | ✅ Match |
| T14 | T13 | T13 -> T14 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Runtime config | unit | unit | ✅ OK |
| T2 | Observability infrastructure | unit | unit | ✅ OK |
| T3 | Application controller | unit | unit | ✅ OK |
| T4 | Process infrastructure | unit | unit | ✅ OK |
| T5 | Media infrastructure | unit | unit | ✅ OK |
| T6 | Provider infrastructure | unit | unit | ✅ OK |
| T7 | Domain/application contract | unit | unit | ✅ OK |
| T8 | Fastify routes/integration | integration | integration | ✅ OK |
| T9 | Fastify OpenAPI | integration | integration | ✅ OK |
| T10 | CI contract | unit/static | unit/static | ✅ OK |
| T11 | Runbook contract | unit/static | unit/static | ✅ OK |
| T12 | Process regression contract | unit | unit | ✅ OK |
| T13 | CI regression contract | unit/static | unit/static | ✅ OK |
| T14 | Runbook regression contract | unit/static | unit/static | ✅ OK |

---

## Tool Selection

The user already selected `tlc-spec-driven`, `use-railway`, and sequential subagents for this
program. Tasks use local source/test tools by default, official documentation only for unstable APIs,
and Railway CLI only for bounded read-only evidence in T11. No additional MCP or provider secret is
required for this feature.
