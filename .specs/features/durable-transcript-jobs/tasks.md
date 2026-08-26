# Durable Transcript Jobs and Artifact Cache Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute
flow and Critical Rules.** The skill is the source of truth for per-task tests, gates, one atomic
commit per task, sequential phase batches, independent verification, and requirement traceability.

**If the skill cannot be activated, STOP and tell the user.**

---

**Design**: `.specs/features/durable-transcript-jobs/design.md`
**Status**: In Progress (approved by user on 2026-08-26)

---

## Test Coverage Matrix

> Generated from the approved spec/design, existing tests, and project quality guidance. Guidelines
> found: `README.md` Quality section, `package.json`, `vitest.config.ts`, `biome.json`, and
> `.github/workflows/ci.yml`. No `AGENTS.md` or contributor test standard exists, so strong defaults
> apply: every acceptance criterion and listed edge case receives direct asserted evidence. Baseline
> on 2026-08-26: 13 unit files / 166 tests, 2 integration files / 49 tests, 215 total.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Request identity and job state domain | unit | All branches; exact canonical key/state values; 1:1 coverage for CACHE-01/02, JOB-02/07, WORK-04, EDGE-05/08 | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Execution, cache, coordinator, and worker application logic | unit | Every submit disposition, capacity/abort/recovery/terminal branch, exact calls and payloads, all listed edge cases | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Atomic writer and filesystem repositories | unit with real temp directories | Every publish/read/revision/corruption/expiry/path/error branch with injected failures and exact on-disk assertions | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Fastify routes, lifecycle, readiness, sync cache, and runtime composition | integration | Every route/state/header/body/auth/failure/lifecycle path through `app.inject`; no provider or network calls | `test/integration/**/*.test.ts` | `npm run test:integration` |
| OpenAPI contract | integration/static | Parser, stable snapshot, nine-route parity, exact schemas/security/headers/statuses/errors, no secrets | `test/integration/openapi.test.ts` | `npm run test:integration` |
| Metrics, config, IaC, container, gitignore, and docs contracts | unit/static | Every fixed label/default/bound/resource/mount/permission/retention statement and prohibited value | `test/unit/**/*-contract.test.ts`, `test/unit/config.test.ts`, `test/unit/runtime-metrics.test.ts` | `npm run test:unit` |
| Type-only declarations | none | Typecheck/build and downstream behavioral tests only | `src/**/*.ts` | `npm run check` |

## Gate Check Commands

> Generated from the checked-in npm scripts, Vitest config, CI workflow, and Dockerfile.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After domain/application/storage tasks covered by unit tests | `npm run test:unit` |
| Full | After HTTP/OpenAPI/runtime integration | `npm test` |
| Build | After a phase or configuration/IaC/documentation contract | `npm run check` |
| Container | After entrypoint/Dockerfile work and before deployment | `docker build -t transcript-youtube-videos-api:durable-jobs .` (CI authoritative when local Docker is unavailable) |

---

## Execution Plan

Phases run sequentially. Tasks within a phase run in order and no later batch starts until the
previous batch reports every gate and commit complete.

### Phase 1: Domain and runtime foundations

```text
T1 -> T2 -> T3 -> T4 -> T5
```

### Phase 2: Persistent storage

```text
T6 -> T7 -> T8
```

### Phase 3: Cache and durable execution

```text
T9 -> T10 -> T11
```

### Phase 4: HTTP and OpenAPI

```text
T12 -> T13 -> T14
```

### Phase 5: Production composition

```text
T15
```

### Phase 6: Railway, container, and operations

```text
T16 -> T17 -> T18 -> T19 -> T20
```

Approved phase-aligned batching proposal:

- Batch 1: Phases 1-2, T1-T8 (8 tasks).
- Batch 2: Phases 3-5, T9-T15 (7 tasks).
- Batch 3: Phase 6, T16-T20 (5 tasks).
- Fresh verifier: automatic after T20; expanded discrimination sensor because persistence and
  provider-quota safety are high risk.

---

## Task Breakdown

## Phase 1 Tasks

### T1: Canonicalize transcript request identity ✅

**What**: Add the deterministic language normalization and versioned SHA-256 cache-key component.
**Where**: `src/domain/transcript-request.ts`
**Depends on**: None
**Reuses**: `DEFAULT_CAPTION_LANGUAGES`, `ParsedYouTubeUrl`, `node:crypto`, `Intl.getCanonicalLocales`
**Requirement**: CACHE-01, CACHE-02, EDGE-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Omitted languages normalize exactly to `pt-BR`, `pt`, `en`; equivalent case deduplicates to the same key; post-canonicalization duplicates reject before other work.
- [x] Preference order changes the key; URL variants with the same canonical video ID do not.
- [x] The preimage includes exact schema/policy versions and never appears in the public normalized result.
- [x] Unit tests assert exact keys/properties for defaults, case, duplicates, order, version, and invalid tags.
- [x] `npm run test:unit` passes with at least 167 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(domain): canonicalize transcript requests`

### T2: Define durable job state and transitions ✅

**What**: Add strict persisted/public job models, sanitized failure mapping, UUID validation, legal
revision-guarded transitions, links, and tombstones.
**Where**: `src/domain/job.ts`
**Depends on**: T1
**Reuses**: Existing `AppErrorCode` and fixed public error-message pattern
**Requirement**: JOB-02, JOB-07, WORK-04, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Models represent only queued, processing, completed, failed, and expired-tombstone contracts from the design.
- [x] Legal transitions and expected revision increments are exact; terminal/stale transitions reject without mutation.
- [x] Public resources omit persisted request, cache/artifact identity, and every prohibited content/diagnostic field.
- [x] Failure mapping accepts only allowlisted codes and fixed messages, including `JOB_INTERRUPTED`.
- [x] Unit tests cover every legal/illegal transition, exact resource shape, UUID rejection, links, timestamps, and redaction.
- [x] `npm run test:unit` passes with at least 168 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(jobs): define durable job state`

### T3: Parse bounded durable storage configuration ✅

**What**: Add `DATA_ROOT`, queue capacity, completed/failed/tombstone TTL, and sweep-interval runtime
configuration with the approved defaults and bounds.
**Where**: `src/config.ts`
**Depends on**: T2
**Reuses**: Existing optional-value and bounded-integer parsers
**Requirement**: OPS-01, OPS-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Defaults exactly match `.data/transcripts`, 100, 604800, 86400, 86400, and 60000.
- [x] Every lower/upper boundary succeeds and every non-integer/out-of-range value fails with only the variable name and allowed range.
- [x] `DATA_ROOT` accepts a non-empty relative/absolute path without logging or embedding it in an error.
- [x] Existing runtime defaults/bounds remain unchanged and config tests cover every new variable.
- [x] `npm run test:unit` passes with at least 169 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(config): add durable storage settings`

### T4: Observe durable jobs, cache, recovery, and storage ✅

**What**: Extend the isolated Prometheus registry with the six approved job/cache/storage metric
families and closed label mappings.
**Where**: `src/infrastructure/observability/runtime-metrics.ts`
**Depends on**: T3
**Reuses**: Existing `allowed()` mapper and registry-isolation tests
**Requirement**: OPS-04, OPS-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Exact metric names/types and label enums match the design; queued/processing gauges and storage-health gauge initialize to zero.
- [x] Submission, current state, terminal duration, cache, recovery, and health updates render exact values.
- [x] Every unknown value maps to `unknown`; method signatures accept no identifier/path/content label.
- [x] Rendered metrics exclude job/video/cache IDs, URLs, languages, paths, content, credentials, and exception text.
- [x] `npm run test:unit` passes with at least 170 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(metrics): observe durable job lifecycle`

### T5: Wait for shared execution capacity without rejection ✅

**What**: Add an abortable FIFO `waitForPermit` path to `ExecutionController` while preserving exact
`tryAcquire` behavior for synchronous HTTP.
**Where**: `src/application/execution-controller.ts`
**Depends on**: T4
**Reuses**: Existing idempotent permit, active set, shutdown, and listener-cleanup patterns
**Requirement**: WORK-02, WORK-03, WORK-05, WORK-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Available capacity resolves immediately; saturated waiters resolve in FIFO order only after an exact permit release.
- [x] Waiting neither increments capacity-rejection metrics nor changes the active gauge before admission.
- [x] Caller abort removes the exact listener/waiter and resolves without a permit; release and abort races settle once.
- [x] Shutdown resolves all waiters without permits, aborts active permits once, and leaves zero listeners/waiters.
- [x] Existing `tryAcquire` overflow, readiness, and idempotent-release tests remain unchanged.
- [x] `npm run test:unit` passes with at least 171 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(runtime): wait for transcript capacity`

## Phase 2 Tasks

### T6: Publish mutable files atomically ✅

**What**: Implement the same-filesystem write/sync/close/rename/directory-sync primitive and strict
safe path helpers used by every persistent component.
**Where**: `src/infrastructure/storage/atomic-file-writer.ts`
**Depends on**: T5
**Reuses**: Node filesystem promises, `randomUUID`, strict UUID/SHA-256 validators
**Requirement**: STORE-01, STORE-08, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Files and directories become visible only after content/file/directory sync and atomic rename complete.
- [x] Failure at write, sync, close, rename, or directory-sync never exposes a final partial file and cleans only its owned opaque temporary.
- [x] Path helpers accept only strict UUID/SHA-256 inputs, use two-character shards, remain under the configured root, and never follow request-derived traversal.
- [x] Real-temp-directory tests and injected filesystem failures assert exact bytes, ordering, cleanup, confinement, and no symlink/request-path escape.
- [x] `npm run test:unit` passes with at least 172 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(storage): write files atomically`

### T7: Persist and verify immutable transcript bundles ✅

**What**: Implement the file artifact store for full JSON/PDF bundles, cache pointers, partial worker
transcripts, checksums, quarantine, per-key locks, health probes, and expiry.
**Where**: `src/infrastructure/storage/file-artifact-store.ts`
**Depends on**: T6
**Reuses**: Atomic writer, exact `Transcript` model, SHA-256, clock/ID injection
**Requirement**: STORE-02, STORE-03, STORE-04, STORE-06, STORE-07, CACHE-06, EDGE-02, EDGE-04, EDGE-06, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] A bundle pointer is published only after immutable manifest/transcript/PDF sizes and checksums are durable and verified.
- [x] Cache reads return exact original metadata/bytes; expired, partial, checksum/size/schema-corrupt content is never a hit and is quarantined under an opaque name.
- [x] Completed-job reads map missing/corrupt references to sanitized `JOB_STORAGE_UNAVAILABLE` without retranscription.
- [x] Partial worker transcript save/recovery verifies its checksum and never publishes a cache pointer.
- [x] Per-key locks serialize read/publish/expiry so responses are complete or absent, never partial; expiry removes the pointer first.
- [x] Read-only/full/probe failures mark health false without content/path leakage and a later successful bounded probe recovers it.
- [x] Real-filesystem tests cover publication order, exact manifest, corruption, expiry race, partial recovery, `ENOSPC`, health recovery, and confinement.
- [x] `npm run test:unit` passes with at least 173 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(storage): persist transcript artifacts`

### T8: Persist revision-guarded durable jobs ✅

**What**: Implement the file job repository, in-memory post-commit index, FIFO lookup, recovery scan,
active-key ownership, bounded tombstones, corruption quarantine, and deterministic duplicate repair.
**Where**: `src/infrastructure/storage/file-job-repository.ts`
**Depends on**: T7
**Reuses**: Atomic writer, job domain validators/transitions, repository mutex, clock
**Requirement**: JOB-05, STORE-05, STORE-07, CACHE-07, EDGE-07, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Create/transition updates the in-memory index only after atomic disk publication and rejects stale revision/state without overwriting.
- [x] `oldestQueued` orders by creation timestamp then UUID; non-terminal counts and active owners are exact.
- [x] Startup validates every record/tombstone, quarantines corrupt content without identifiers/content logs, and rebuilds the index.
- [x] Duplicate active keys retain the oldest owner; later records become fixed failed `JOB_INTERRUPTED` without external work.
- [x] Completed expiry deletes cache/artifacts through the shared lock then writes a 24-hour tombstone; failed jobs and tombstones obey exact fixed TTLs without sliding reads.
- [x] Unknown/expired/invalid identifiers remain distinguishable and invalid formats touch no path.
- [x] Real-filesystem tests cover restart persistence, stale transitions, FIFO, corruption, duplicate recovery, TTL boundaries, tombstone deletion, and read/expiry races.
- [x] `npm run test:unit` passes with at least 174 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(storage): persist durable jobs`

## Phase 3 Tasks

### T9: Coordinate complete transcript artifacts ✅

**What**: Implement canonical cache lookup and complete JSON/PDF production for best-effort
synchronous and strict durable modes.
**Where**: `src/application/transcript-artifact-coordinator.ts`
**Depends on**: T8
**Reuses**: Hybrid transcript service, PDF renderer/model, artifact store, transcript stage metrics
**Requirement**: CACHE-06, CACHE-08, EDGE-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Verified hit returns exact transcript/PDF without provider or renderer calls and records one hit.
- [x] Synchronous miss uses the caller signal/metrics, renders one PDF, and publishes only a complete bundle.
- [x] JSON mode returns a valid produced transcript when cache-PDF rendering or storage publication fails, records fixed failure metrics, and exposes no storage detail.
- [x] PDF mode preserves existing `PDF_GENERATION_FAILED`; durable mode persists a verified work transcript before PDF and fails closed on any required storage step.
- [x] Failures never create a bundle/pointer and a later request remains a miss.
- [x] Unit tests cover hit/miss, exact metadata/bytes, provider/render/store failures, abort propagation, no partial cache, and call counts.
- [x] `npm run test:unit` passes with at least 175 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(cache): coordinate transcript artifacts`

### T10: Execute and recover durable transcript work ✅

**What**: Implement the single worker loop, capacity wait, revision claim, strict artifact execution,
conservative restart reconciliation, shutdown, cleanup, and exact metrics.
**Where**: `src/application/durable-job-worker.ts`
**Depends on**: T9
**Reuses**: Execution waiter, job repository, artifact coordinator/store, `AbortSignal`, runtime metrics
**Requirement**: WORK-01, WORK-02, WORK-03, WORK-04, WORK-05, WORK-06, WORK-07, EDGE-02, EDGE-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Exactly one start loop processes FIFO jobs; no-capacity jobs remain queued with zero external/PDF/storage work or rejection metric.
- [x] Permit acquisition precedes revision claim/external work and every success/failure/abort/race releases it exactly once.
- [x] Terminal/stale records do nothing; typed failures persist allowlisted public failure; unexpected failure is sanitized.
- [x] Complete restart bundle becomes completed; verified transcript-only work renders only PDF; missing/invalid transcript becomes `JOB_INTERRUPTED` with zero provider calls.
- [x] Shutdown stops claims, aborts/wakes exactly once, persists interrupted state when possible, clears timer/listeners, and returns a settled stop promise.
- [x] Unit tests use fake capacity/provider/renderer/clock plus real partial files for every branch/race and exact metrics/state/call payloads.
- [x] `npm run test:unit` passes with at least 176 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(jobs): execute durable transcript work`

### T11: Coordinate durable submissions and results ✅

**What**: Implement lifecycle readiness, serialized submit/dedup/capacity decisions, API resource
reads, result state mapping, worker notification, sweeper, and active ownership cleanup.
**Where**: `src/application/durable-job-coordinator.ts`
**Depends on**: T10
**Reuses**: Worker, repository, artifact store/coordinator, job domain, metrics, clock/ID injection
**Requirement**: JOB-01, JOB-02, JOB-03, JOB-04, JOB-05, JOB-07, CACHE-03, CACHE-04, CACHE-05, CACHE-07, EDGE-01, EDGE-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Concurrent same-key misses create one queued record: creator gets `miss`, followers get the same ID with `joined`, and one worker notification occurs.
- [x] Active owners join; verified completed owners hit; a verified sync bundle creates one immediate completed hit without queue capacity; failed/corrupt/expired state allows a new miss.
- [x] Queue cap rejects only a new miss with exact 429 metadata; joined/hit still return during saturation without record/provider work.
- [x] Status/result methods return exact resources/bytes and map queued/processing/failed/unknown/expired/corrupt states to the specified errors/Retry-After.
- [x] `start` initializes/reconciles before ready; `stop` flips readiness, stops worker/sweeper, and is idempotent.
- [x] Unit tests cover concurrent promise races, every disposition/state/TTL boundary, exact IDs/links/headers metadata, notifications, metrics, and zero prohibited fields.
- [x] `npm run test:unit` passes with at least 177 tests and no silent deletions.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(jobs): coordinate durable submissions`

## Phase 4 Tasks

### T12: Register authenticated durable job routes ✅

**What**: Add the four Fastify job operations as one isolated route component with exact schemas,
headers, binary handling, and coordinator delegation.
**Where**: `src/http/job-routes.ts`
**Depends on**: T11
**Reuses**: Existing Bearer hook, error handler, request schema, PDF content headers, coordinator interface
**Requirement**: JOB-01, JOB-02, JOB-03, JOB-04, JOB-05, JOB-06, JOB-07, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] POST returns exact 202 body, `Location`, and `Retry-After: 2` for miss/joined/hit.
- [x] Status returns each exact retained resource; transcript/PDF return exact JSON/bytes/content headers.
- [x] Queued/processing/failed/unknown/expired/storage states map to exact 409/404/410/503 codes and owned headers.
- [x] Bearer authentication runs before body, UUID, coordinator, repository, or result access; missing config remains fail-closed 503.
- [x] Invalid language/UUID gets 400 with zero coordinator/path/provider calls.
- [x] Integration tests through Fastify injection cover every route/state/header/content type/auth order/redaction branch.
- [x] `npm test` passes with at least 227 total tests and no silent deletions.

**Tests**: integration
**Gate**: full
**Commit**: `feat(api): add durable job routes`

### T13: Integrate durable lifecycle and synchronous cache ✅

**What**: Wire job routes, coordinator lifecycle/readiness, shared execution controller, and
best-effort completed-bundle reuse/publication into the existing Fastify application.
**Where**: `src/http/app.ts`
**Depends on**: T12
**Reuses**: Existing auth/error/logging, `withTranscriptExecution`, readiness, preClose, JSON/PDF routes
**Requirement**: JOB-06, WORK-05, CACHE-08, OPS-03, OPS-06, EDGE-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `onReady` awaits coordinator start; readiness requires execution and storage/worker readiness without external calls.
- [x] `preClose` marks not-ready, stops claims, aborts active execution, awaits coordinator cleanup, and remains idempotent.
- [x] Synchronous verified hit bypasses provider/renderer/admission and returns exact original JSON/PDF bytes.
- [x] Synchronous miss preserves auth-before-work, capacity, client abort, error/status, and PDF contracts while publishing a complete bundle best-effort.
- [x] A disconnect after job POST never aborts worker work; logs contain only fixed event/state/outcome/reason/status/duration.
- [x] Integration tests cover lifecycle order, readiness failure/recovery, sync hit/miss/write-failure, saturation, disconnect independence, prior regressions, and log redaction.
- [x] `npm test` passes with at least 228 total tests and no silent deletions.

**Tests**: integration
**Gate**: full
**Commit**: `feat(api): integrate durable jobs and cache`

### T14: Publish the additive OpenAPI 1.1 contract ✅

**What**: Extend OpenAPI schemas, public error catalog, and route parity for all four durable job
operations while retaining every existing operation and security boundary.
**Where**: `src/http/openapi.ts`
**Depends on**: T13
**Reuses**: Existing `@fastify/swagger`, parser, snapshot, route-operation registry, Transcript/Error schemas
**Requirement**: OPS-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] API version is exactly 1.1.0 and nine actual in-scope operations match documented methods/paths.
- [x] Job submission/resource/failure/link/status, UUID parameter, Location/Retry-After, Transcript, and binary PDF schemas are exact.
- [x] Every specified 202/200/400/401/404/409/410/429/503 response and stable code is represented.
- [x] All job operations require Bearer; health/readiness/OpenAPI stay public; production values/content/paths remain absent.
- [x] Parser, snapshot, route parity, security, schema, status, header, and secret-absence tests pass.
- [x] `npm test` passes with at least 229 total tests and no silent deletions.

**Tests**: integration/static
**Gate**: full
**Commit**: `feat(openapi): document durable job api`

## Phase 5 Tasks

### T15: Compose the production durable runtime ✅

**What**: Instantiate one metrics/controller/store/repository/artifact coordinator/worker/job
coordinator graph from runtime config and inject it into Fastify.
**Where**: `src/app.ts`
**Depends on**: T14
**Reuses**: Existing provider/media/PDF composition, application factory, dependency injection
**Requirement**: WORK-01, WORK-05, STORE-06, OPS-03, OPS-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Production composition creates exactly one shared RuntimeMetrics, ExecutionController, repository, artifact store, renderer, worker, and coordinator.
- [x] Every config value reaches the owning component exactly; local default data root is created only through startup initialization.
- [x] Startup storage failure prevents durable readiness/listen with sanitized logs; runtime health degradation keeps `/health` available and `/ready` not-ready.
- [x] Shutdown uses the Fastify lifecycle once and `server.ts` needs no duplicate worker/storage shutdown path.
- [x] Integration tests use a real temporary root with fake provider/renderer to prove startup, durable restart persistence, one worker, result retrieval, and clean close without network credentials.
- [x] `npm test` passes with at least 230 total tests and no silent deletions.

**Tests**: integration
**Gate**: full
**Commit**: `feat(app): compose durable transcript runtime`

## Phase 6 Tasks

### T16: Declare the Railway transcript Volume ✅

**What**: Add one 1024 MB Volume, `/data` mount, `DATA_ROOT=/data/transcripts`, explicit one-instance
topology, and preserved secrets to TypeScript IaC without applying it.
**Where**: `.railway/railway.ts`
**Depends on**: T15
**Reuses**: Existing Railway project/service definition and `railway/iac` `volume()` helper
**Requirement**: OPS-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`, `use-railway`

**Done when**:

- [x] Static contract proves exactly one 1024 MB Volume at `/data`, one service instance, correct data root, and existing preserved secrets/build/healthcheck.
- [x] No Postgres, Redis, bucket, public storage, literal secret, Railway UUID, or generated domain is introduced.
- [x] `railway config plan` is run read-only and its add/change/destroy summary is recorded for later explicit apply approval; no apply runs in this task.
- [x] `npm run check` passes with at least 231 total tests and no silent deletions.

**Tests**: unit/static
**Gate**: build
**Commit**: `chore(railway): mount transcript volume`

### T17: Add the non-root Volume entrypoint ✅

**What**: Add a strict POSIX entrypoint that fixes only `/data` ownership when root, then immediately
executes the application as `node` through `gosu`.
**Where**: `docker-entrypoint.sh`
**Depends on**: T16
**Reuses**: Railway-documented Volume permission constraint and existing `DATA_ROOT`
**Requirement**: OPS-02, OPS-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Script uses `set -eu`, never prints environment/path/credentials, never recursively chowns content, and only handles fixed `/data`.
- [x] Root path creates/chowns the mount root then `exec gosu node`; non-root path directly execs the command.
- [x] Static/shell tests prove syntax, executable bit, fixed path, privilege-drop command, argument preservation, and absence of recursive/destructive operations.
- [x] `npm run check` passes with at least 232 total tests and no silent deletions.

**Tests**: unit/static
**Gate**: build
**Commit**: `chore(container): add non-root volume entrypoint`

### T18: Enable container Volume permissions safely

**What**: Install pinned-distribution `gosu`, copy/use the entrypoint, retain Node 22/FFmpeg/yt-dlp,
and remove direct `USER node` startup without running the final Node process as root.
**Where**: `Dockerfile`
**Depends on**: T17
**Reuses**: Existing multi-stage Docker build, runtime packages, healthcheck, and CI container gate
**Requirement**: OPS-02, OPS-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Runtime installs `gosu` in the existing apt layer, copies executable entrypoint, and keeps exact CMD/healthcheck/tool versions.
- [ ] Contract test proves the entrypoint owns privilege drop and Dockerfile does not start Node directly as root or retain an incompatible `USER node` before mount initialization.
- [ ] Source gate passes; local Docker build and a UID/write probe run when Docker exists, otherwise the unchanged CI container gate remains authoritative.
- [ ] `npm run check` passes with at least 233 total tests and no silent deletions.

**Tests**: unit/static
**Gate**: container
**Commit**: `chore(container): enable volume permissions`

### T19: Ignore local durable state

**What**: Exclude the approved `.data/` local durable root from version control and enforce it with a
static repository contract.
**Where**: `.gitignore`
**Depends on**: T18
**Reuses**: Existing ignore policy for environment/build/runtime outputs
**Requirement**: OPS-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `.data/` is ignored exactly while specs, fixtures, and unrelated paths remain trackable.
- [ ] Static test uses `git check-ignore` and proves representative job/artifact content cannot enter version control.
- [ ] `npm run check` passes with at least 234 total tests and no silent deletions.

**Tests**: unit/static
**Gate**: build
**Commit**: `chore(storage): ignore local durable data`

### T20: Document durable jobs, retention, and deployment

**What**: Document the four job workflows, synchronous cache behavior, configuration, retention,
single-Volume topology, redeploy downtime, interrupted-work policy, backup risk, and IMP-10 namespace.
**Where**: `README.md`
**Depends on**: T19
**Reuses**: Existing curl/auth/config/Railway/privacy/quality sections and YouTube runbook policy
**Requirement**: OPS-06, OPS-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`, `use-railway`

**Done when**:

- [ ] Authenticated examples cover submit, poll, JSON, and PDF without real credentials/video IDs or response-body leakage.
- [ ] Exact defaults/bounds, non-sliding TTLs, queue semantics, 404/409/410/429/503 codes, and explicit resubmission after `JOB_INTERRUPTED` are documented.
- [ ] One Volume/one instance, brief redeploy downtime, backup/data-loss responsibility, non-root entrypoint, `/data/transcripts`, and reserved `/data/lancedb` are explicit.
- [ ] Privacy text replaces obsolete stateless/synchronous-only claims and preserves temporary-audio cleanup, Bearer, limits, no retries, and public-video policy.
- [ ] Static documentation contract rejects missing required behavior, prohibited identifiers/content, bypass guidance, or claims of automatic retry/zero downtime.
- [ ] `npm run check` passes with at least 235 total tests and no silent deletions.

**Tests**: unit/static
**Gate**: build
**Commit**: `docs: document durable transcript jobs`

---

## Phase Execution Map

```text
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6

Phase 1: T1 -> T2 -> T3 -> T4 -> T5
Phase 2: T6 -> T7 -> T8
Phase 3: T9 -> T10 -> T11
Phase 4: T12 -> T13 -> T14
Phase 5: T15
Phase 6: T16 -> T17 -> T18 -> T19 -> T20
```

Cross-phase dependencies are declared in task bodies. Execution is strictly sequential; phase
boundaries are the only batch boundaries.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | One request-identity component | ✅ Complete |
| T2 | One durable-job domain component | ✅ Complete |
| T3 | One runtime-config extension | ✅ Complete |
| T4 | One metrics-registry extension | ✅ Complete |
| T5 | One execution-controller extension | ✅ Complete |
| T6 | One atomic-writer component | ✅ Complete |
| T7 | One artifact-store component | ✅ Complete |
| T8 | One job-repository component | ✅ Complete |
| T9 | One artifact-coordinator component | ✅ Complete |
| T10 | One durable-worker component | ✅ Complete |
| T11 | One job-coordinator component | ✅ Complete |
| T12 | One job-route plugin | ✅ Complete |
| T13 | One Fastify integration boundary | ✅ Complete |
| T14 | One OpenAPI contract extension | ✅ Complete |
| T15 | One production composition root | ✅ Complete |
| T16 | One Railway IaC resource change | ✅ Complete |
| T17 | One container entrypoint | ✅ Complete |
| T18 | One Docker runtime integration | ✅ Granular |
| T19 | One ignore-policy change | ✅ Granular |
| T20 | One operator/developer documentation contract | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | Phase 1 start | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 | T2 -> T3 | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 (cross-phase) | Phase 2 start | ✅ Match; cross-phase implied |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T7 | T7 -> T8 | ✅ Match |
| T9 | T8 (cross-phase) | Phase 3 start | ✅ Match; cross-phase implied |
| T10 | T9 | T9 -> T10 | ✅ Match |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T11 (cross-phase) | Phase 4 start | ✅ Match; cross-phase implied |
| T13 | T12 | T12 -> T13 | ✅ Match |
| T14 | T13 | T13 -> T14 | ✅ Match |
| T15 | T14 (cross-phase) | Phase 5 start | ✅ Match; cross-phase implied |
| T16 | T15 (cross-phase) | Phase 6 start | ✅ Match; cross-phase implied |
| T17 | T16 | T16 -> T17 | ✅ Match |
| T18 | T17 | T17 -> T18 | ✅ Match |
| T19 | T18 | T18 -> T19 | ✅ Match |
| T20 | T19 | T19 -> T20 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Domain request identity | unit | unit | ✅ OK |
| T2 | Domain job state | unit | unit | ✅ OK |
| T3 | Runtime config | unit | unit | ✅ OK |
| T4 | Metrics | unit/static | unit | ✅ OK |
| T5 | Execution controller | unit | unit | ✅ OK |
| T6 | Atomic filesystem | unit/real temp | unit | ✅ OK |
| T7 | Artifact repository | unit/real temp | unit | ✅ OK |
| T8 | Job repository | unit/real temp | unit | ✅ OK |
| T9 | Artifact application service | unit | unit | ✅ OK |
| T10 | Worker lifecycle | unit | unit | ✅ OK |
| T11 | Job coordinator | unit | unit | ✅ OK |
| T12 | Fastify job routes | integration | integration | ✅ OK |
| T13 | Fastify lifecycle/cache | integration | integration | ✅ OK |
| T14 | OpenAPI | integration/static | integration/static | ✅ OK |
| T15 | Production composition | integration | integration | ✅ OK |
| T16 | Railway IaC | unit/static | unit/static | ✅ OK |
| T17 | Entrypoint | unit/static | unit/static | ✅ OK |
| T18 | Dockerfile | unit/static + container | unit/static | ✅ OK; container gate adds runtime proof |
| T19 | Ignore policy | unit/static | unit/static | ✅ OK |
| T20 | Documentation | unit/static | unit/static | ✅ OK |

---

## Tool Selection

The user previously selected TLC, Railway, and sequential subagents for the production program.
Proposed execution mapping:

- T1-T15 and T17-T19: local source/test tools + `tlc-spec-driven`; no MCP or network.
- T16 and T20: `tlc-spec-driven` + `use-railway`; Railway CLI is read-only (`config plan`) until
  the exact plan receives separate apply approval.
- T18: local container/static gates; CI remains authoritative if Docker is unavailable.
- After T20: a fresh verifier subagent runs the full spec-anchored check and expanded sensor
  automatically; it never changes production code.
