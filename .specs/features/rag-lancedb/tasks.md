# RAG-native LanceDB Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute
flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source
of truth for the per-task cycle, sequential batch delegation, adequacy review, independent Verifier,
discrimination sensor, traceability, and atomic commits.

**If the skill cannot be activated, STOP and tell the user -- do not proceed without it.**

---

**Design**: `.specs/features/rag-lancedb/design.md`
**Status**: In Progress; T1-T28 complete; validation round 1 failed 48/52 ACs; T29-T34 approved fix loop pending

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found:
> `README.md`, `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, and sampled tests under
> `test/unit` and `test/integration`; no workspace `AGENTS.md` or `CONTRIBUTING.md` was present.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain, chunking, scheduling, locks, and application policy | unit | All branches; 1:1 to assigned ACs; every assigned edge case; deterministic fake clocks/signals | `test/unit/*.test.ts` | `npm run test:unit` |
| Config, dependency/model manifests, metrics, scripts, IaC, and docs contracts | unit | Exact bounds, fingerprints, allowlists, secret/content absence, generated-tree invariants, and failure paths | `test/unit/*.test.ts` | `npm run test:unit` |
| File repository and verified artifact boundaries | unit + integration | Every state/query path, atomic failure boundary, corruption, confinement, retention, race, and restart using real temporary files | `test/unit/*.test.ts`, `test/integration/*.test.ts` | `npm run test:unit && npm run test:integration` |
| Local encoder and LanceDB index adapters | unit + integration | Adapter failures plus real offline model and real LanceDB schema/FTS/replace/restart/delete behavior; no skipped tests | `test/unit/*.test.ts`, `test/integration/*.test.ts` | `npm run test:unit && npm run test:integration` |
| Worker, coordinator, lifecycle, and composition | unit + integration | All transitions, crash matrix, concurrency/capacity, degradation/retry, shutdown, old-or-new visibility, and zero forbidden providers | `test/unit/*.test.ts`, `test/integration/*.test.ts` | `npm run test:unit && npm run test:integration` |
| HTTP routes and OpenAPI | integration | All four routes: happy, auth-first, strict validation, every specified status/header/error, schema/security/parity, and existing-route regression | `test/integration/*.test.ts` | `npm run test:integration` |
| Production container and offline retrieval evaluation | integration | Real Linux x64 model/LanceDB smoke, network denial, dependency audit, 12-document/48-question metric gates, and three-run determinism | `test/integration/*.test.ts`, `test/evaluation/*.test.ts` | `npm run test:integration` plus the task-specific offline/container command |

## Gate Check Commands

> Generated from the repository's existing scripts and CI; task-specific real-model, evaluation,
> container, and Railway commands are introduced only by their owning tasks.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm run test:unit` |
| Full | After tasks with integration tests | `npm run test:unit && npm run test:integration` |
| Build | After every phase and config/supply-chain work | `npm run check` |
| Offline RAG | After encoder/index/evaluation tasks once model assets are verified | `npm run test:rag:offline` |
| Container | After production-image changes | `docker build --target rag-smoke -t transcript-rag:smoke . && docker build -t transcript-rag:local .` |
| Railway Plan | After Railway IaC changes; read-only until a fresh exact plan is approved | `npx railway plan --environment production` |

---

## Execution Plan

Phases and tasks run strictly sequentially. Whole phases are packed into exactly three sequential
execution batches already approved in principle by the user; no batch may start before the prior
batch passes its phase gate and reports an atomic-commit summary.

### Phase 1: Deterministic foundation

```
T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8 -> T9
```

### Phase 2: Durable RAG core

```
T10 -> T11 -> T12 -> T13 -> T14 -> T15 -> T16 -> T17 -> T18
```

### Phase 3: HTTP and application integration

```
T19 -> T20 -> T21 -> T22 -> T23
```

### Phase 4: Production evidence and operations

```
T24 -> T25 -> T26 -> T28 -> T27
```

### Phase 5: Validation round 1 fixes

```
T29 -> T30 -> T31 -> T32 -> T33 -> T34 -> independent re-verification
```

### Sequential batch packing

| Batch | Whole phases | Tasks | Worker contract |
| ----- | ------------ | ----- | --------------- |
| 1 | Phase 1 | T1-T9 | One sub-agent, sequential tasks, atomic commits, phase Build gate |
| 2 | Phase 2 | T10-T18 | One fresh sub-agent after Batch 1, sequential tasks, atomic commits, Full + Offline RAG + Build gates |
| 3 | Phases 3-4 | T19-T28 | One fresh sub-agent after Batch 2, sequential tasks, atomic commits, all gates and evidence handoff |
| Fix 1 | Phase 5 | T29-T34 | One fresh implementer, sequential atomic fixes from `validation.md`, then one fresh independent Verifier |

After Batch 3, a fresh independent Verifier must validate every requirement against evidence and may
not author fixes. The main agent owns any verifier findings, Railway approval/apply/deploy, UAT,
traceability completion, and final state/goal closure.

---

## Task Breakdown

### Phase 1: Deterministic foundation

### T1: Pin the local RAG dependency tree ✅

**What**: Add exact LanceDB, Arrow, and Transformers production dependencies, force the single
Transformers version, and expose stable offline-model/evaluation scripts; regenerate only the npm
lockfile as mechanical output.
**Where**: `package.json`
**Depends on**: None
**Reuses**: Existing exact-version policy, npm scripts, and CI dependency installation.
**Requirement**: EMB-01, OPS-10

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, npm

**Done when**:

- [x] `@lancedb/lancedb@0.37.1`, `apache-arrow@18.1.0`, and `@huggingface/transformers@4.2.0` are exact production pins.
- [x] The Lance optional Transformers edge resolves to 4.2.0 and only the intended Linux x64 CPU runtime is depended upon.
- [x] Unit contract tests reject version drift, duplicate Transformers/ONNX trees, missing scripts, and non-exact pins.
- [x] The generated `package-lock.json` is committed with this single dependency change and `npm ls` succeeds.
- [x] Build gate passes without reducing the pre-task test count.

**Evidence**: `npm run check` passed 439 tests (436 baseline); `npm ls @lancedb/lancedb apache-arrow @huggingface/transformers onnxruntime-node --all` reported one deduplicated Transformers 4.2.0 tree and one ONNX Runtime Node tree.

**Tests**: unit
**Gate**: build
**Commit**: `build(rag): pin local retrieval dependencies`

### T2: Define the RAG domain model ✅

**What**: Implement validated identities, canonical hashes, records, public resources, legal
revision-guarded transitions, fixed failure maps, and search/request/result value types.
**Where**: `src/domain/rag.ts`
**Depends on**: T1
**Reuses**: `src/domain/job.ts` transition, UUID, public-failure, and immutable-record patterns.
**Requirement**: VER-01, CHUNK-04, CHUNK-05, ING-04, ING-06, OPS-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Canonical SHA-256 identities include the frozen schema/chunk/model inputs and never expose preimages.
- [x] UUID/SHA/query/filter validators and public mappers accept only exact designed shapes.
- [x] Every legal/illegal/revision-conflict transition and fixed failure code/message has a 1:1 unit test.
- [x] Logs/errors produced by domain helpers contain no identifiers, content, paths, stack, or nested cause.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 377 tests (340 pre-task); 37 domain cases cover canonical hashes, strict boundaries, four legal and twelve illegal transition pairs, revision conflict, every fixed failure/error, exact public payloads, and redaction.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(rag): define durable retrieval domain`

### T3: Parse bounded RAG configuration ✅

**What**: Add every approved RAG environment setting with its documented default, strict numeric or
path bound, and sanitized variable-name-only validation error.
**Where**: `src/config.ts`
**Depends on**: T2
**Reuses**: Existing `parseInteger` and configuration test-table conventions.
**Requirement**: OPS-01, CAP-01, CAP-02, SEARCH-06, CHUNK-06, EMB-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] All twelve RAG variables from Design have exact defaults and inclusive min/max checks.
- [x] Path settings reject empty values without disclosing resolved host paths.
- [x] Min-1, min, max, max+1, malformed, unset, and secret-redaction cases are table-tested.
- [x] Existing non-RAG configuration behavior remains unchanged.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 412 tests (377 pre-task); 35 added config cases table-cover all twelve defaults, both path rules, every integer min/max and adjacent invalid boundary, malformed secret redaction, and unchanged legacy settings.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(config): add bounded local rag settings`

### T4: Check in the immutable model manifest ✅

**What**: Define the pinned model/revision/dtype/dimension, five artifact sizes and SHA-256 values,
embedding fingerprint, and reusable fail-closed integrity verifier.
**Where**: `src/infrastructure/rag/model-manifest.ts`
**Depends on**: T3
**Reuses**: Existing streaming SHA-256 and fixed-error practices from artifact storage.
**Requirement**: EMB-01, EMB-03, SEARCH-07, EDGE-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Constants exactly match the approved revision, five byte lengths/hashes, int8 dtype, 384 dimensions, and fingerprint inputs.
- [x] Verification rejects missing, extra, symlinked, wrong-size, and wrong-hash artifacts without remote fallback or path leakage.
- [x] Unit tests cover every artifact and failure class with temporary files.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 424 tests (412 pre-task); 12 manifest cases assert every frozen constant/fingerprint input, exact-set success, missing/extra/root-directory-file symlinks, wrong size, wrong SHA for each of five artifacts, and path/cause redaction.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(rag): verify pinned embedding assets`

### T5: Fetch model assets reproducibly ✅

**What**: Add an idempotent build-time fetcher that downloads only immutable revision URLs into a
temporary directory, verifies the checked-in manifest, and atomically publishes the local model.
**Where**: `scripts/fetch-rag-model.mjs`
**Depends on**: T4
**Reuses**: Model manifest constants and atomic same-parent publication conventions.
**Requirement**: EMB-01, EMB-02, OPS-10

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, network only during explicit build/fetch

**Done when**:

- [x] URLs contain the exact approved immutable revision and no branch aliases.
- [x] Existing verified assets are reused; incomplete/mismatched assets never replace a good local copy.
- [x] Mocked unit cases cover download/status/length/hash/rename failures and cleanup.
- [x] One real fetch verifies the local `.models` cache for later offline tests without checking model bytes into git.
- [x] Build gate passes without reducing the pre-task test count.

**Evidence**: `npm run check` passed 531 tests (530 before the final adequacy case); eight fetcher cases cover immutable URLs, verified reuse, network/status/header/body/hash/rename failures, restoration and cleanup. A real 129 MiB pinned cache fetched, verified, then reused offline; `.models/` is ignored.

**Tests**: unit
**Gate**: build
**Commit**: `build(rag): fetch pinned model reproducibly`

### T6: Implement deterministic Unicode chunking ✅

**What**: Build exact code-point core coverage, bounded tokenizer-aware prior overlap, stable chunk
identity/checksum, segment/timestamp provenance, and source/chunk size enforcement.
**Where**: `src/application/rag-chunker.ts`
**Depends on**: T5
**Reuses**: Transcript segment invariants and the domain/model-policy constants.
**Requirement**: CHUNK-01, CHUNK-02, CHUNK-03, CHUNK-04, CHUNK-05, CHUNK-06, EDGE-06, EDGE-10

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Core spans reconstruct the exact source and never split surrogate pairs or lose/reorder non-empty characters.
- [x] Actual pinned-tokenizer inputs including prefix/special tokens stay at 320 tokens and overlap at 48; truncation is disabled.
- [x] 319/320/321, 511/512/513, multilingual, emoji, combining mark, whitespace-only, oversized segment/source/chunk, missing/coarse timestamp, and determinism cases pass.
- [x] Fixed source-too-large/unavailable failures activate no partial output.
- [x] Quick and offline RAG gates pass without reducing the pre-task test count.

**Evidence**: `npm run test:rag:offline` passed 13 real-tokenizer cases and `npm run test:unit` passed 445 tests (432 pre-task). Assertions cover exact code-point reconstruction/provenance, stable IDs, six token boundaries, maximal 48-token overlap, segment preference, Unicode splitting, whitespace, timestamp precision, both limits, fixed failures, and repeat determinism.

**Tests**: unit
**Gate**: offline rag
**Commit**: `feat(rag): chunk transcripts deterministically`

### T7: Schedule one encoder fairly ✅

**What**: Implement abort-aware FIFO scheduling for one model instance, with no more than four
consecutive waiting searches before one waiting ingestion batch.
**Where**: `src/application/rag-encoder-scheduler.ts`
**Depends on**: T6
**Reuses**: `src/application/execution-controller.ts` idempotent permit, shutdown, and waiter patterns.
**Requirement**: EMB-04, SEARCH-08, ING-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Exactly one callback runs at a time and search/ingestion FIFO order is deterministic within class.
- [x] The four-search fairness bound, ingestion yielding between batches, queued/active abort, post-call abort, and idempotent stop are unit-tested.
- [x] No signal disposes or interrupts an in-flight shared model call.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 453 tests (445 pre-task); eight scheduler cases assert peak concurrency one, per-class FIFO, exact four-search fairness, inter-batch yield, pre/queued/post-call abort, listener cleanup, exception release, and idempotent stop without interrupting the active callback.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(rag): schedule local embeddings fairly`

### T8: Serialize publications with writer preference ✅

**What**: Implement an abort-safe read/write lock in which queued writers prevent later readers,
and every lease releases exactly once.
**Where**: `src/application/async-read-write-lock.ts`
**Depends on**: T7
**Reuses**: Execution-controller waiter cleanup and idempotent release patterns.
**Requirement**: VER-06, LIFE-03, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Concurrent readers coexist, writers are exclusive, and new readers cannot starve a queued writer.
- [x] Abort-before/admission, queued abort, shutdown, exception, double-release, and order races are deterministic unit tests.
- [x] No unresolved waiter or permit remains after every failure path.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 461 tests (453 pre-task); eight lock cases assert concurrent readers, exclusive/FIFO writer preference, abort-before/queued listener cleanup, both abort-release race orders, idempotent leases, exception-safe helpers, shutdown, and zero residual waiters/leases.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(rag): add writer preferred publication lock`

### T9: Bound concurrent RAG searches ✅

**What**: Implement a separate four-request admission controller with configured retry metadata,
abort propagation, readiness rejection, shutdown cancellation, and idempotent permits.
**Where**: `src/application/rag-search-controller.ts`
**Depends on**: T8
**Reuses**: `ExecutionController` admission semantics without reusing transcript metric labels.
**Requirement**: SEARCH-06, SEARCH-08, ING-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] The exact configured capacity is enforced before encoder/index access and exposes fixed retry seconds.
- [x] Capacity, abort, shutdown, permit-release, readiness, and independent transcript-controller cases are unit-tested.
- [x] Quick gate and Phase 1 Build gate pass without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 471 tests (461 pre-task) and `npm run check` passed
570 tests; ten focused cases assert the exact admission boundary and retry metadata, caller abort,
readiness recovery, idempotent shutdown/release, metrics, invalid bounds, and isolation from the
transcript `ExecutionController`.

**Tests**: unit
**Gate**: build
**Commit**: `feat(rag): bound concurrent searches`

### Phase 2: Durable RAG core

### T10: Hold the verified artifact lock through a callback

**What**: Extend artifact storage with a callback that validates and returns transcript bytes/data
while holding the existing cache-key lock until the consumer durably finishes.
**Where**: `src/infrastructure/storage/file-artifact-store.ts`
**Depends on**: T9
**Reuses**: Existing manifest, checksum, parser, cache-key lock, and corruption mapping.
**Requirement**: ING-02, ING-03, ING-05, EDGE-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] PDF is never read and the callback sees verified raw transcript bytes plus the parsed transcript and artifact metadata.
- [x] Expiry/read/delete/corruption/consumer-failure races prove old read methods remain compatible and lock release is exception-safe.
- [x] Temporary-files integration proves expiry cannot enqueue a dangling RAG snapshot.
- [x] Full gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit && npm run test:integration` passed 574 tests (570 pre-task).
Three focused unit cases prove the exact verified payload, PDF exclusion, lock-held expiry,
exception-safe release, legacy read compatibility, and sanitized corruption behavior. A real
temporary-files integration case proves a durable transcript-only snapshot completes before source
expiry can remove the bundle.

**Tests**: unit + integration
**Gate**: full
**Commit**: `feat(storage): expose locked transcript snapshot`

### T11: Expose the completed durable source boundary

**What**: Add `withVerifiedCompletedTranscript` to map job status/expiry/storage outcomes to the
existing public job errors before invoking the artifact callback.
**Where**: `src/application/durable-job-coordinator.ts`
**Depends on**: T10
**Reuses**: Existing job lookup, fake clock, public `JobError`, and artifact-store abstraction.
**Requirement**: ING-03, ING-05, EDGE-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Queued/processing, failed, absent, expired, and corrupt/unavailable states map exactly and invoke no consumer when ineligible.
- [x] `expiresAt <= now` is rejected before artifact access even without a published tombstone.
- [x] Completed success invokes exactly once and preserves the lock through the async consumer.
- [x] Unit and temporary-files integration cases cover all source states and forbidden-call spies.
- [x] Full gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit && npm run test:integration` passed 583 tests (574 pre-task).
Eight focused unit cases assert the exact public mapping for queued, processing, failed, unknown,
tombstoned, exact-expiry, storage-failure, and completed states with forbidden-call spies. A real
temporary-files integration case proves the coordinator keeps the artifact lock until the async RAG
snapshot consumer durably finishes.

**Tests**: unit + integration
**Gate**: full
**Commit**: `feat(jobs): expose verified rag source`

### T12: Confine the RAG filesystem layout

**What**: Implement versioned root, database, manifest, ingestion, tombstone, document, snapshot,
quarantine, and probe paths derived only from validated UUID/SHA identities.
**Where**: `src/infrastructure/rag/rag-storage-paths.ts`
**Depends on**: T11
**Reuses**: `AtomicFileWriter` confinement/symlink rules and `FileJobRepository` sharding layout.
**Requirement**: OPS-06, SEARCH-07, EDGE-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Every designed path stays under one canonical root and uses only recognized schema paths.
- [x] Traversal, absolute path, symlinked root/database, malformed UUID/SHA, and unknown-layout cases fail closed without leaking paths.
- [x] Unit tests use real temporary filesystem boundaries.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit` passed 492 tests (482 pre-task). Ten focused cases use real
temporary directories to assert every exact versioned path and canonical confinement, five invalid
identity variants, missing/recognized layouts, symlinked root/database boundaries, fixed redacted
errors, and fail-closed unknown layout entries.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(rag): confine persistent storage paths`

### T13: Persist RAG ingestion and recovery state

**What**: Implement atomic records, verified snapshots, owner indexes, document epochs/delete intent,
retention/tombstones, probes, cleanup/quarantine, and crash-recovery scans without controlling search visibility.
**Where**: `src/infrastructure/rag/file-rag-repository.ts`
**Depends on**: T12
**Reuses**: `AtomicFileWriter` and `FileJobRepository` exact-key parsing, revision mutex, indexes, sweeps, and quarantine patterns.
**Requirement**: ING-02, ING-04, ING-06, ING-07, VER-02, VER-03, VER-04, VER-08, LIFE-06, CAP-01, CAP-02, EDGE-03, EDGE-04, EDGE-09

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Snapshot sync/rename precedes queued record; failures remove only unpublished recognized staging.
- [x] Hit reuse and post-expiry fresh completed-hit creation preserve document/version and mutate no snapshot/index.
- [x] Owners, FIFO, guarded transitions, epochs, source-independent 24h metadata/tombstone retention, free-space probe, and queue count are exact.
- [x] Restart/crash matrix, corruption/quarantine, duplicate-owner collapse, symlink/confinement, disk failure, and fake-clock boundaries pass with real temporary files.
- [x] Full gate passes without reducing the pre-task test count.

**Evidence**: `npm run test:unit && npm run test:integration` passed 605 tests (593 pre-task).
Nine unit cases use real files to prove snapshot-before-record ordering and rollback, exact FIFO/owner/
epoch transitions, hit isolation, 24h+24h retention, opaque quarantine, duplicate repair, the exact
128 MiB boundary, and symlink confinement. Three restart integration cases prove processing recovery
from the local snapshot, corrupt-snapshot fail-closed behavior, and VER-03 fresh-hit creation after
metadata/tombstone expiry without staging or identity changes.

**Tests**: unit + integration
**Gate**: full
**Commit**: `feat(rag): persist ingestion recovery state`

### T14: Encode E5 vectors offline

**What**: Implement one verified local Transformers pipeline with network-disabled loading, exact E5
prefixes, tokenizer access, mean pooling, normalization, vector validation, warmup, and disposal.
**Where**: `src/infrastructure/rag/local-e5-encoder.ts`
**Depends on**: T13
**Reuses**: Checked model manifest/fetch cache and scheduler-owned serialization.
**Requirement**: EMB-01, EMB-02, EMB-03, SEARCH-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, pinned local model assets

**Done when**:

- [x] Remote models and runtime network are disabled before import/pipeline construction; only the exact local revision is loaded.
- [x] Query/passage prefixes, tokenizer counts, mean pooling, L2 normalization, 384 finite values, norm tolerance, fingerprint, warmup, abort boundaries, and close are enforced.
- [x] Unit loader failures and real offline model 319/320/321 plus golden-cosine tests pass without credentials or skips.
- [x] Offline RAG gate passes without reducing the pre-task test count.

**Evidence**: eight focused unit cases passed for exact offline loader configuration, prefixes,
tokenizer special-token counts, pooling/normalization, invalid dimension/value/norm outputs, abort
boundaries, redaction, and idempotent disposal. `npm run test:rag:offline` passed 15 tests including
the real pinned int8 model, 319/320/321 token boundaries, 384-dimensional normalized vectors,
golden cosine values, fingerprint, and runtime fetch denial with no credentials or skips.

**Tests**: unit + integration
**Gate**: offline rag
**Commit**: `feat(rag): encode multilingual e5 offline`

### T15: Publish and query the LanceDB index

**What**: Encapsulate explicit Arrow schema, manifest/fingerprint initialization, Portuguese FTS,
atomic document replacement/delete, exact candidates, inspection, probe, and safe optimization.
**Where**: `src/infrastructure/rag/lancedb-rag-index.ts`
**Depends on**: T14
**Reuses**: Approved LanceDB 0.37.1 `mergeInsert` smoke and domain validators.
**Requirement**: VER-05, VER-06, VER-07, SEARCH-02, SEARCH-03, SEARCH-05, SEARCH-07, LIFE-01, LIFE-02, LIFE-03, LIFE-04, EDGE-05, EDGE-07, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, real local LanceDB

**Done when**:

- [x] Explicit 384-float schema and approved FTS are created only for a safe absent/empty table and exact manifest.
- [x] One validated document-scoped merge activates the complete target and deletes all surplus old chunks; no raw input reaches SQL.
- [x] Vector/FTS queries cap at 50 each, never call `fastSearch`, select public fields only, and immediately see fresh rows.
- [x] Real tests cover replace smaller/larger, unrelated preservation, restart, delete, filters, corrupt/incomplete/mixed state, timeout inspection, optimize serialization, and fingerprint/dimension failure.
- [x] Offline RAG and Full gates pass without reducing the pre-task test count.

**Tests**: unit + integration
**Gate**: offline rag
**Commit**: `feat(rag): publish atomic lancedb documents`

### T16: Fuse deterministic hybrid search

**What**: Implement admitted query embedding, same-generation vector/FTS reads, stable candidate
normalization and application-owned RRF, filters, public provenance mapping, and sanitized failures.
**Where**: `src/application/rag-search-service.ts`
**Depends on**: T15
**Reuses**: Search controller, encoder scheduler, publication lock, domain validators, and index adapter.
**Requirement**: SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04, SEARCH-05, SEARCH-06, SEARCH-07, SEARCH-08, OPS-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Query/topK/filter validation and capacity occur before encoder/index access.
- [x] At most 100 unique candidates use `1 / (60 + rank)` with finite scores and exact stable document/version/ordinal ties.
- [x] The publication read lock spans both candidate queries and mapping releases all permits in `finally`.
- [x] Unit and real-index integration cover empty/unknown filters, ties, duplicates, three-run order, concurrent replacement/delete, abort, corruption, and response redaction.
- [x] Full and Offline RAG gates pass without reducing the pre-task test count.

**Tests**: unit + integration
**Gate**: offline rag
**Commit**: `feat(rag): fuse deterministic hybrid retrieval`

### T17: Execute recoverable FIFO ingestions

**What**: Implement one worker loop that claims FIFO work, verifies snapshots, chunks/embeds in
batches, validates all rows, epoch-fences one atomic publication, recovers crashes, and cleans staging.
**Where**: `src/application/rag-ingestion-worker.ts`
**Depends on**: T16
**Reuses**: `DurableJobWorker` lifecycle/recovery loop, repository, chunker, scheduler, lock, index, and metrics interfaces.
**Requirement**: ING-03, ING-07, ING-08, VER-05, VER-07, VER-08, CHUNK-06, EMB-04, EDGE-03, EDGE-04, EDGE-09

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] No worker path reaches transcript providers, PDF, LLM, registry, or network; snapshot is the only source.
- [x] All chunks/vectors validate before the write lock; document epoch is rechecked immediately before one merge.
- [x] Every pre/post-commit crash row, deletion fence, smaller replacement, embedding/disk failure, batch abort, shutdown/restart, and prior-version preservation case passes.
- [x] Reconciliation accepts only exact committed digest/version/count and degrades on impossible mixed state.
- [x] Full and Offline RAG gates pass without reducing the pre-task test count.

**Tests**: unit + integration
**Gate**: offline rag
**Commit**: `feat(rag): run recoverable ingestion worker`

### T18: Coordinate the durable RAG lifecycle

**What**: Implement start/retry/stop, submission miss-join-hit/update decisions, snapshot publication,
status, search, delete epochs, capacity order, sweeps, and RAG-only readiness/degradation.
**Where**: `src/application/rag-ingestion-coordinator.ts`
**Depends on**: T17
**Reuses**: Durable source boundary, repository, worker, index, model, locks, search service, and existing coordinator lifecycle patterns.
**Requirement**: ING-01, ING-02, ING-04, ING-05, ING-06, ING-07, ING-08, VER-02, VER-03, VER-04, VER-08, LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-06, CAP-01, CAP-02, OPS-03, OPS-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Linearized submit checks hit, join, update conflict, queue, free space, locked source snapshot, then durable acceptance in the designed order.
- [x] VER-03 reuses retained completed metadata or creates only a new completed hit after expiry, with zero snapshot/chunk/embed/index mutation.
- [x] Delete intent/epoch prevents stale-worker resurrection and changes no source artifacts; startup reconciles delete before work.
- [x] Known RAG init failures keep the server-capable coordinator degraded, retry locally, and never degrade existing transcript state.
- [x] Full crash/race/capacity/retention/shutdown/retry integration matrix and Phase 2 Build gate pass with no forbidden calls or test-count regression.

**Evidence**: eleven focused unit/integration cases cover ordered miss/join/hit/update/capacity
decisions, real atomic snapshot persistence/restart, delete intent recovery, low-disk hit admission,
status/search, retention sweep degradation, startup retry, and concurrent shutdown. The Phase 2 gates
passed 538 unit + 120 integration tests, 28 real Offline RAG tests, and `npm run build` with no skips
or remote provider calls.

**Tests**: unit + integration
**Gate**: build
**Commit**: `feat(rag): coordinate durable knowledge base`

### Phase 3: HTTP and application integration

### T19: Instrument fixed-label RAG telemetry

**What**: Extend the existing registry with the approved RAG counters, histograms, gauges, and
allowlisted labels while rejecting arbitrary label/content values.
**Where**: `src/infrastructure/observability/runtime-metrics.ts`
**Depends on**: T18
**Reuses**: Existing private metric-family and render/reset test conventions.
**Requirement**: OPS-05, OPS-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Submission/state/duration/failure, active counts, component health, search/duration/results/capacity, and maintenance families match Design.
- [x] Every label is closed, low-cardinality, and excludes query/content/URL/ID/language/path/model input/credentials/external messages.
- [x] Success/failure/abort/capacity render tests and malicious-string absence tests pass without changing existing metrics.
- [x] Quick gate passes without reducing the pre-task test count.

**Evidence**: two focused tests assert the exact 23-family registry, all 12 new RAG families,
success/failure/aborted/capacity outcomes, gauges, durations, bounded result counts, maintenance, and
malicious-label collapse to `unknown` with content absence. The Quick gate passed 540 unit tests,
up from 538, with no skips.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(metrics): instrument local rag operations`

### T20: Register the four protected RAG routes

**What**: Add strict Fastify schemas and handlers for ingestion submit/status, hybrid search, and
document delete with exact bodies, headers, public envelopes, and exported schemas.
**Where**: `src/http/rag-routes.ts`
**Depends on**: T19
**Reuses**: `src/http/job-routes.ts` registration, Bearer hook, strict schema, error, and Location patterns.
**Requirement**: ING-01, ING-04, ING-06, SEARCH-01, SEARCH-04, SEARCH-06, LIFE-01, LIFE-02, EDGE-01

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] All four operations reject extra/malformed body/params and use the coordinator only after authentication and validation.
- [x] Every designed success/error status, exact body shape, `Location`, `Retry-After`, and 204 empty body is covered.
- [x] Spies prove auth-first and capacity/validation-before-dependency access; existing route contracts remain unchanged.
- [x] Full gate passes without reducing the pre-task test count.

**Evidence**: 34 focused route cases cover miss/join/hit, every ingestion state, exact public search
provenance, empty DELETE, strict route/domain validation, auth-first behavior on all four operations,
all assigned RAG errors/headers, and every durable source error. The Full gate passed 540 unit + 154
integration tests, adding 34 integration cases with no skips. One mechanical TypeScript correction
made the parameterized validation-case label an explicit callback argument; behavior was unchanged.

**Tests**: integration
**Gate**: full
**Commit**: `feat(http): expose protected rag routes`

### T21: Integrate RAG errors and lifecycle into Fastify

**What**: Register the RAG routes/auth hook, map fixed `RagError` responses, combine readiness, and
sequence degraded start/retry plus stop without preventing health or existing routes from listening.
**Where**: `src/http/app.ts`
**Depends on**: T20
**Reuses**: Existing centralized error handler, `/health`, `/ready`, metrics protection, and Fastify hooks.
**Requirement**: OPS-03, OPS-04, OPS-06, EDGE-01, ING-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] `/ready` requires durable transcript and RAG readiness; `/health` stays public and network-free.
- [x] A RAG-only model/index/repository/worker failure returns fixed RAG 503 while health and existing authenticated transcript/job handlers remain callable.
- [x] Auth precedes parsing/dependencies and unexpected errors/logs contain only fixed safe fields.
- [x] Startup retry, shutdown order, waiter cancellation, and existing lifecycle regressions pass integration tests.
- [x] Full gate passes without reducing the pre-task test count.

**Evidence**: 15 focused integration cases prove shared auth-first behavior, exact validation/RAG
errors and retry headers, public network-free health, combined readiness, callable transcript/job
routes during RAG degradation, fixed-field error logs, and durable-start/RAG-start then RAG-stop/
durable-stop order. Coordinator tests from T18 continue to cover local retry and waiter shutdown. The
Full gate passed 540 unit + 169 integration tests, adding 15 cases with no skips.

**Tests**: integration
**Gate**: full
**Commit**: `feat(http): integrate rag lifecycle safely`

### T22: Compose one local RAG subsystem

**What**: Construct exactly one repository, LanceDB index, model, scheduler, worker, search service,
locks, and coordinator from config, sharing the existing service/Volume lifecycle.
**Where**: `src/app.ts`
**Depends on**: T21
**Reuses**: Existing production adapter composition and narrow dependency injection seams.
**Requirement**: ING-07, ING-08, OPS-02, OPS-03, OPS-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] Production creates one encoder session, one RAG worker/writer, and no remote embedding/search/provider adapter.
- [x] RAG paths/config/metrics/lifecycle are wired without changing transcript concurrency or artifact retention.
- [x] Composition tests use fakes/temporary roots to prove start/stop order, degraded isolation, retry, and no hidden network/API key.
- [x] Full gate passes without reducing the pre-task test count.

**Evidence**: production now composes one local repository/index/model/scheduler/worker/search/
coordinator graph from the approved config and passes only the shared metrics instance to admission.
Two focused composition cases prove one fake encoder initializes once, serves ingestion and search,
closes once, and retries one sanitized warmup failure locally while health/providers remain untouched.
The Full gate passed 540 unit + 171 integration tests, adding two cases with no skips.

**Tests**: integration
**Gate**: full
**Commit**: `feat(app): compose embedded rag subsystem`

### T23: Publish OpenAPI 1.2.0 parity

**What**: Extend route collection through DELETE and document the four RAG operations, schemas,
Bearer security, headers, statuses, fixed errors, and additive 1.2.0 snapshot.
**Where**: `src/http/openapi.ts`
**Depends on**: T22
**Reuses**: Exported RAG route schemas and existing parser/snapshot/runtime parity tests.
**Requirement**: OPS-07

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`

**Done when**:

- [x] The document has exactly 13 runtime operations including DELETE and retains every existing contract.
- [x] All RAG schemas are strict, Bearer-protected, response/header/error complete, parser-valid, and versioned 1.2.0.
- [x] Snapshot/parity/security tests reject route drift, secrets, example credentials, internal paths, vectors, and query echoes.
- [x] Full and Phase 3 Build gates pass without reducing the pre-task test count.

**Evidence**: the generated OpenAPI 3.1 document is version 1.2.0, parser-valid, and has exact parity
with 13 registered operations including DELETE. Eleven OpenAPI cases assert strict named RAG schemas,
Bearer security, every assigned status/header/error, content-free 204, stable snapshot, and secret/
path/vector absence. `npm run check` passed lint, typecheck, 712 tests, and build with no skips.
Mechanical corrections only: lexical DELETE ordering, generated snapshot refresh, and Biome formatting
of Phase 3 files; no behavior or assertion outcome changed.

**Tests**: integration
**Gate**: build
**Commit**: `docs(openapi): publish rag operations`

### Phase 4: Production evidence and operations

### T24: Package and smoke-test the offline runtime

**What**: Add immutable model fetch/verification, Linux x64-only runtime pruning, non-root writable
data, and a `rag-smoke` stage that executes real offline encoder plus Lance replace/search/delete.
**Where**: `Dockerfile`
**Depends on**: T23
**Reuses**: Existing Node 22 multi-stage image, entrypoint, yt-dlp/FFmpeg pins, healthcheck, and CI Docker build.
**Requirement**: EMB-01, EMB-02, OPS-02, OPS-10

**Tools**:

- MCP: NONE
- Skills: `tlc-spec-driven`, `use-railway` only for later deployment validation
- Local: `apply_patch`, Docker when available

**Done when**:

- [x] Build downloads only the approved revision, verifies five hashes, packages `/app/models`, and sets runtime-local model configuration.
- [x] Only other-platform ORT binaries are pruned; Linux x64 CPU artifacts remain and execute after pruning.
- [x] Smoke denies network/credentials, validates a real 384-vector, Lance replacement/search/delete, non-root `/data` write, and reports image/RSS/index sizes.
- [x] Static container contract plus actual `rag-smoke` and production builds pass; no existing media/runtime tool regresses.
- [x] Container and Build gates pass without reducing the pre-task test count.

**Evidence**: 22 focused container/fetch/CI cases and `npm run check` passed 716 tests (712
pre-task), lint, typecheck, and build without skips. The real smoke also ran directly as UID 1000
against the five verified local model artifacts with process-network denial and reported 384 dimensions,
norm `0.9999999693`, one vector hit, one FTS hit, 39,196 index bytes, 751,874,048 RSS bytes,
135,138,591 model bytes, and 1,267,260,767 local application bytes after replacement and deletion.
Docker, Podman, Buildah, Nerdctl, and Finch are absent in this execution environment, so local image
build output is evidence-zero rather than inferred; the fail-closed CI contract now builds both
`rag-smoke` and production targets without publishing. Mechanical corrections only: the prior
runtime-stage assertion now scopes root startup to the production stage, the existing CI step-count
assertion now expects both builds, and Biome wrapped one long assertion; outcomes were not weakened.

**Tests**: unit + integration
**Gate**: container
**Commit**: `build(rag): package offline retrieval runtime`

### T25: Gate Portuguese automotive retrieval quality

**What**: Add an authored/versioned 12-document, 48-question Brazilian automotive fixture and an
offline evaluator for vector-only, FTS-only, hybrid metrics, subgroups, distractors, and determinism.
**Where**: `test/evaluation/rag-retrieval.test.ts`
**Depends on**: T24
**Reuses**: Production chunker, local encoder, Lance index, search service, and approved qrel/range design.
**Requirement**: OPS-08, OPS-09, OPS-10, SEARCH-02, SEARCH-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: Vitest, real packaged model and LanceDB, network disabled

**Done when**:

- [x] Fixture contains 12 fictional documents and exactly 48 qrels across every approved subgroup with document plus range relevance.
- [x] Hybrid meets every global/subgroup threshold and has zero wrong model/year top-1 disambiguations.
- [x] Three clean executions return identical IDs/ranks; vector/FTS diagnostics and p50/p95/RSS/index size are recorded without weakening gates.
- [x] Evaluation fails on network/credentials, skipped cases, insufficient fixture size, metric regression, or non-finite scores.
- [x] Offline RAG, Full, and Build gates pass without reducing the pre-task test count.

**Evidence**: the authored `automotive-pt-BR-fictional-v1` fixture has exactly 12 documents and 48
document-plus-code-point-range qrels in the approved 12 exact, 12 semantic, 8 disambiguation,
8 accent/typo, 4 numeric, and 4 distractor distribution. Three fresh real LanceDB executions with
the verified local E5 model returned identical IDs/ranks and zero network calls or credentials.
Hybrid achieved Recall@3 `0.9375`, Recall@5 `0.9791667`, MRR@10 `0.8833333`, and nDCG@10
`0.9074851`; all eight disambiguation top-1 results were correct and every subgroup threshold passed.
Vector-only Recall@5 was `0.9375`; FTS-only Recall@5 was `0.75`. The final gate recorded p50/p95
`22.01/31.34 ms`, peak RSS `804,102,144` bytes, and fresh index sizes `195,159/195,161/195,149`
bytes. Offline RAG passed 30 tests; `npm run check` passed 718 tests (716 pre-task), lint, typecheck,
and build with no skips. Mechanical corrections only: Biome formatting/import order, explicit
undefined checks, and ES2023-compatible grouping replaced unsupported `Map.groupBy`; outcomes were
unchanged.

**Tests**: integration
**Gate**: offline rag
**Commit**: `test(rag): gate automotive retrieval quality`

### T26: Declare the shared Railway RAG path

**What**: Add only `RAG_DATA_ROOT=/data/lancedb` while preserving one replica, the existing 1024 MB
Volume/mount/service, preserved secrets, Docker build, and absence of paid remote resources.
**Where**: `.railway/railway.ts`
**Depends on**: T25
**Reuses**: Existing Railway IaC and 1 GB `transcript-data` Volume.
**Requirement**: OPS-02, CAP-01

**Tools**:

- MCP: NONE
- Skills: `tlc-spec-driven`, `use-railway`
- Local: `apply_patch`, Railway CLI in read-only plan mode

**Done when**:

- [x] Static tests assert one service/replica/Volume, 1024 MB `/data`, exact transcript/RAG roots, preserved existing secrets, and no database/bucket/remote-model secret.
- [x] A fresh Railway plan is captured read-only and contains only the expected additive/change operations with zero destroy.
- [x] No apply/deploy occurs until the main agent presents that exact plan and obtains the separately required user approval.
- [x] Quick and Build gates pass without reducing the pre-task test count.

**Evidence**: two static IaC cases prove exactly one Dockerfile service/replica, one 1024 MB
`transcript-data` Volume mounted at `/data`, exact `/data/transcripts` and `/data/lancedb` roots,
preserved `API_ACCESS_KEY`/`OPENCODE_API_KEY`, and absence of databases, buckets, remote-model
credentials, managed public domains, or Railway UUIDs. A fresh authenticated Railway CLI 5.45.0
read-only plan against the linked `production` environment reported `1 to add, 3 to change, 0 to
destroy`: create the declared Volume, attach it at `/data`, reconcile the already-declared
`DATA_ROOT`, and add `RAG_DATA_ROOT`; values remained hidden. No apply, deploy, push, variable write,
link, or other remote mutation ran. The current CLI uses `config plan --file` and no longer accepts
the task table's legacy `plan --environment` syntax; environment identity was verified read-only
before planning. Quick passed 544 unit tests and `npm run check` passed all 718 tests, lint,
typecheck, and build without skips or count reduction.
Mechanical correction only: the proposed `ops(...)` commit type is not accepted by the TLC
Conventional Commits validator, so the metadata uses its equivalent allowed `chore(...)` type.

**Tests**: unit
**Gate**: railway plan
**Commit**: `chore(railway): persist embedded rag data`

### T28: Remediate vulnerable transitive RAG dependencies ✅

**What**: Override only the vulnerable transitive archive/image packages at their approved patched
versions while preserving the direct LanceDB, Transformers, Arrow, ONNX runtime, and model pins.
**Where**: `package.json`
**Depends on**: T26
**Reuses**: T1's exact dependency-tree contract and the existing clean-install/container/offline gates.
**Requirement**: OPS-10

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, npm clean install/audit/tree, real native imports and offline RAG tests

**Done when**:

- [x] Root overrides are exactly `adm-zip: 0.6.0` and `sharp: 0.35.4` in addition to the approved Transformers override; neither package becomes a direct dependency.
- [x] The lockfile and installed tree contain exactly those patched versions once, and `npm audit --omit=dev` reports zero vulnerabilities.
- [x] A clean reinstall, including lifecycle scripts, proves ONNX Runtime extraction remains compatible and a real Sharp import loads on Node 22.
- [x] Real offline E5 encoding, Lance replacement/search/delete, and all 12-document/48-qrel evaluation thresholds still pass.
- [x] Build gate passes without changing direct LanceDB/Transformers/Arrow pins or any model artifact/hash.

**Evidence**: the dependency contract failed first on the absent overrides and Sharp 0.34.5, then
passed four cases after the exact transitive remediation. `npm ci` performed a clean install of 267
packages with lifecycle scripts enabled; native Sharp 0.35.4 and ONNX Runtime 1.24.3 imports loaded.
The installed tree contains one overridden adm-zip 0.6.0 and one overridden Sharp 0.35.4 beneath the
unchanged Transformers 4.2.0/LanceDB 0.37.1/Arrow 18.1.0 tree. `npm audit --omit=dev` reported zero
vulnerabilities. Offline RAG passed 30 tests with the same 12 documents, 48 qrels and hybrid Recall@5
`0.9791667`, MRR@10 `0.8833333`, nDCG@10 `0.9074851`; `npm run check` passed 724 tests, typecheck,
lint and build. No direct dependency, model manifest, artifact, revision, dimension, dtype, or hash
changed.

**Tests**: unit + integration
**Gate**: build
**Commit**: `fix(deps): patch rag transitive vulnerabilities`

### T27: Document RAG operation and deletion semantics ✅

**What**: Document local ingestion/search/delete usage, configuration, no-provider guarantees,
retention/capacity, backup/restore, logical deletion limits, readiness/metrics, evaluation, and Railway runbook.
**Where**: `README.md`
**Depends on**: T28
**Reuses**: Existing API examples and durable-job/Volume operational sections.
**Requirement**: LIFE-05, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-08, OPS-09, OPS-10

**Tools**:

- MCP: NONE
- Skills: `tlc-spec-driven`, `use-railway` for exact operational wording
- Local: `apply_patch`

**Done when**:

- [x] Examples cover all four authenticated routes and explain that ingestion reuses durable transcripts with no retranscription/PDF/LLM/network embedding.
- [x] Runbook covers fixed config/bounds, 1 GB shared capacity, readiness/degradation, safe metrics, model/evaluation commands, backup-before-compaction, restart, and migration fingerprint refusal.
- [x] Deletion promises immediate logical search removal but explicitly disclaims secure physical erase of fragments/backups.
- [x] Contract tests reject missing commands/limits/errors/privacy language and accidental secret/content examples.
- [x] Full repository, mutation, dependency, offline RAG, container, OpenAPI, and documentation gates pass with no test-count regression.

**Evidence**: five documentation-contract cases assert all four authenticated file-output examples,
every fixed config/bound/capacity/error, local-only source reuse, readiness and safe metrics,
evaluation/backup/restore/restart/fingerprint commands, and logical-delete language that expressly
rejects physical secure-erasure claims and content/secret examples. Full gates passed 550 unit + 172
integration tests; the focused mutation gate passed 11 and OpenAPI/docs passed 16. The patched exact
dependency tree audited at zero vulnerabilities. Offline RAG passed 30 tests and retained the 12-doc/
48-qrel hybrid Recall@5 `0.9791667`, MRR@10 `0.8833333`, and nDCG@10 `0.9074851` thresholds.
Fourteen static container/CI cases passed; no Docker, Podman, Buildah, Nerdctl, or Finch binary exists
in this environment, so an additional image build remains evidence-zero while T24's real direct
smoke and fail-closed CI build contract remain unchanged. `npm run check` passed all 724 tests,
lint, typecheck, and build. Mechanical corrections only: the older durable-jobs README test now ends
at the new RAG subsection, and the secure-erasure negative regex distinguishes the required explicit
Portuguese `não oferece` disclaimer from a positive promise. No Railway command or remote mutation ran.

**Tests**: unit
**Gate**: build
**Commit**: `docs(rag): add local knowledge base runbook`

### Phase 5: Validation round 1 fixes

### T29: Fail readiness closed on post-start worker/storage degradation

**What**: Make the coordinator own worker-fatal degradation and safe recovery, and cover storage
exhaustion after admission without losing the prior searchable version or leaving staging behind.
**Where**: `src/application/rag-ingestion-coordinator.ts` with worker/composition companions
**Depends on**: T27
**Reuses**: Existing RAG-only initialization retry, fixed storage errors, search admission switch, and worker recovery protocol.
**Requirement**: OPS-04, EDGE-09, ING-07, ING-08, VER-05, VER-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, Vitest

**Done when**:

- [x] A real post-start worker fatal atomically makes coordinator readiness false, disables search admission, marks worker health false, and prevents every RAG content operation before the callback returns.
- [x] `/ready` returns the exact 503 body while `/health` and existing transcript/job handlers retain their contracts; all public/logged failures stay fixed and sanitized.
- [x] Bounded retry creates at most one fresh worker loop, reconciles persisted processing state before readiness, and never restarts after application shutdown.
- [x] ENOSPC/storage failure after admission at snapshot and publication boundaries produces the exact failed state, preserves the prior version, removes bounded staging when safe, and keeps readiness false until a successful probe/recovery.
- [x] Focused unit/composed integration tests and the Full, Offline RAG, and Build gates pass without test-count regression.

**Evidence**: the focused real-loop/coordinator/Fastify set passed 36 tests. It injects a real
post-start worker-loop fatal, proves synchronous coordinator/admission/worker-health degradation,
exact 503 for all four RAG operations, exact `/ready` 503, and unchanged health/transcript/job
responses. Retry re-runs reconciliation before one fresh loop, and shutdown prevents another start.
Snapshot storage failure after a healthy admission probe becomes a fixed failed record with bounded
snapshot cleanup; publication ENOSPC keeps only recoverable processing staging and preserves the
prior version before requeue. `npm run check` passed 729 tests (724 pre-task), lint, strict types,
and build; Offline RAG passed 30 tests with unchanged 12-document/48-qrel thresholds. The older
snapshot scenario was corrected from non-fatal resolution to sanitized fatal rejection because its
outcome contradicted EDGE-09/OPS-04; its failed-record, cleanup, zero-merge, and prior-version
assertions were preserved and no assertion was weakened.

**Tests**: unit + integration
**Gate**: build
**Commit**: `fix(rag): fail readiness on worker degradation`

### T30: Wire RAG telemetry through production operations

**What**: Inject narrow observability ports into the real coordinator, worker, search, and lifecycle
paths so every approved metric family reflects production operations rather than direct registry calls.
**Where**: `src/infrastructure/observability/runtime-metrics.ts` with application/composition wiring companions
**Depends on**: T29
**Reuses**: `RuntimeMetrics` fixed-label methods and existing narrow dependency interfaces.
**Requirement**: OPS-05, OPS-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, Vitest

**Done when**:

- [x] Real miss/join/hit/reject, queued/processing/terminal, duration/failure, active document/chunk, and repository/index/model/worker health paths update exact fixed-label metrics.
- [x] Real search success/failure/abort/capacity paths update count, duration, result-count, and active gauges exactly once, including every `finally`/abort path.
- [x] Composed tests drive operations through the application and scrape `/metrics`; they do not call `RuntimeMetrics` mutation methods directly and assert exact deltas.
- [x] Failure tests prove no query/text/vector/URL/ID/path/credential/provider data becomes a label or metric value.
- [x] Quick, Full, Offline RAG, and Build gates pass without test-count regression.

**Evidence**: a composed Fastify lifecycle drove two real transcript jobs through RAG miss,
processing join, completed hit, rejected source lookup, terminal embedding failure, successful hybrid
search, and document deletion before authenticated `/metrics` scrapes. Exact deltas were 2 miss,
1 joined, 1 hit, 1 rejected, one completed and one failed terminal duration, one fixed `embedding`
failure, zero queued/processing gauges, four healthy fixed components, one active document/chunk
before delete and zero after it, plus one successful search/result observation. A separate operational
search-service/controller scrape proved success/failure/abort/capacity counters and duration counts
at exactly one each, result count exactly one, and active searches back at zero without direct metric
mutation. Both scrapes reject query/text/vector/URL/ID/path/credential/provider material. Focused
coordinator/worker/search/composition suites passed 42 tests; Quick passed 555 unit tests;
`npm run check` passed 731 tests (729 pre-task), lint, strict types, and build; Offline RAG passed
30 tests with unchanged 12-document/48-qrel quality thresholds; `npm audit --omit=dev` found zero
vulnerabilities.

**Tests**: unit + integration
**Gate**: build
**Commit**: `fix(metrics): connect rag operation telemetry`

### T31: Trigger serialized safe RAG maintenance

**What**: Track successful mutations and changed rows, run safe optimize at the approved thresholds,
and instrument reconcile/sweep/optimize/delete outcomes on their real paths.
**Where**: `src/application/rag-ingestion-worker.ts` with coordinator/index companions
**Depends on**: T30
**Reuses**: Writer-preferred publication lock, index `optimize()`, and fixed maintenance metric allowlists.
**Requirement**: OPS-05, LIFE-03, EDGE-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, real local LanceDB, Vitest

**Done when**:

- [ ] The twentieth successful mutation or cumulative 100,000 changed rows schedules exactly one optimize under the publication write lock; sub-threshold work does not.
- [ ] Counters reset only after successful optimize, failed/aborted maintenance remains retryable, and shutdown leaves no orphan maintenance promise or lock waiter.
- [ ] Optimization uses the existing non-destructive cleanup policy, preserves active results and immediate FTS visibility, and cannot interleave with publication/delete/search.
- [ ] Real reconcile, sweep, optimize, and delete operations emit exact success/failure/skipped maintenance outcomes without dynamic labels.
- [ ] Focused mutation/real-index tests and the Full, Offline RAG, and Build gates pass without test-count regression.

**Tests**: unit + integration
**Gate**: offline rag
**Commit**: `fix(rag): schedule safe index maintenance`

### T32: Prove source and RAG lifecycle independence end to end

**What**: Add real-store integration evidence that RAG replace/delete never mutate transcript job or
artifact bytes and that active indexed content remains searchable after independent source expiry.
**Where**: `test/integration/rag-lifecycle-independence.test.ts`
**Depends on**: T31
**Reuses**: Real durable artifact repository/store, file RAG repository, LanceDB index, and search service fixtures.
**Requirement**: LIFE-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, Vitest, real local LanceDB/model

**Done when**:

- [ ] After ingest then replace/delete, byte hashes of the source job record, transcript JSON, and PDF are unchanged and their public resources remain exact.
- [ ] After source artifact expiry/sweep, the independently active RAG document still returns exact text and all stored provenance captured before expiry.
- [ ] Tests prove no RAG lifecycle call reaches transcript generation, PDF rendering, Muse, captions, media, or network providers.
- [ ] Any exposed boundary defect is fixed surgically without coupling RAG retention to source retention.
- [ ] Full, Offline RAG, and Build gates pass without test-count regression.

**Tests**: integration
**Gate**: offline rag
**Commit**: `test(rag): prove source lifecycle independence`

### T33: Project LanceDB score metadata explicitly

**What**: Select vector distance and FTS score metadata explicitly so ranking does not rely on
deprecated score auto-projection and offline runs remain warning-free for this behavior.
**Where**: `src/infrastructure/rag/lancedb-rag-index.ts`
**Depends on**: T32
**Reuses**: Existing public-column allowlist, candidate validation, and real LanceDB ranking tests.
**Requirement**: SEARCH-02, SEARCH-03, SEARCH-07, OPS-10

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, real local LanceDB, Vitest

**Done when**:

- [ ] Vector queries explicitly project `_distance` and FTS queries explicitly project `_score` while public candidates still exclude internal metadata and vectors.
- [ ] Finite score and stable-rank tests pass with scoring auto-projection disabled/future behavior adopted where the pinned API supports it.
- [ ] The Offline RAG gate emits zero `_distance`/`_score` auto-projection warnings and preserves all retrieval thresholds/determinism.
- [ ] Full and Build gates pass without test-count regression.

**Tests**: unit + integration
**Gate**: offline rag
**Commit**: `fix(rag): project lancedb score metadata`

### T34: Make clean-checkout CI model gates hermetic

**What**: Fetch and verify the immutable ignored model in CI before model-dependent source gates,
cache only the verified asset tree, and expose a manual rerun trigger without weakening tests.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T33
**Reuses**: `npm run rag:model:fetch`, immutable manifest hashes, locked npm install, and existing two-target Docker build.
**Requirement**: OPS-10, EMB-01, EMB-02

**Tools**:

- MCP: GitHub read/run evidence only after push
- Skill: `tlc-spec-driven`
- Local: `apply_patch`, actionlint/YAML contract, clean detached worktree

**Done when**:

- [ ] CI supports push, pull request, and manual dispatch; after `npm ci` it restores/fetches `.models`, then the fetcher verifies the exact manifest before `npm run check`.
- [ ] Cache identity changes with the checked-in model manifest and an empty/poisoned cache cannot bypass hash/size/exact-set verification.
- [ ] A clean-checkout simulation with no pre-existing `.models` passes the same source/offline gates without secrets or provider credentials.
- [ ] GitHub jobs actually start and retain green source, audit, `rag-smoke`, and production-image evidence; a repository/account `startup_failure` remains evidence-zero and must not be reported as PASS.
- [ ] Static CI contracts, actionlint, Full, Offline RAG, dependency audit, and Build gates pass without test-count regression.

**Tests**: unit + integration
**Gate**: container + build
**Commit**: `fix(ci): provision verified rag model`

---

## Requirement-to-Task Traceability

| Requirement group | Owning task(s) |
| ----------------- | -------------- |
| ING-01-08 | T10, T11, T13, T17, T18, T20-T22 |
| VER-01-08 | T2, T8, T13, T15-T18 |
| CHUNK-01-06 | T2-T3, T6, T17 |
| EMB-01-04 | T1, T3-T7, T14, T17, T24 |
| SEARCH-01-08 | T2-T4, T7, T9, T14-T16, T20, T25 |
| LIFE-01-06 | T8, T13, T15, T18, T20, T27, T29, T31-T32 |
| CAP-01-02 | T3, T13, T18, T26 |
| OPS-01-10 | T1-T5, T12, T14, T16, T18-T34 |
| EDGE-01-10 | T4, T6, T8, T10-T18, T20-T21, T29, T31 |

## Phase Execution Map

Phases and execution batches remain sequential; phase boundaries are the only allowed batch cuts.

| Order | Phase | Batch | Completion gate |
| ----- | ----- | ----- | --------------- |
| 1 | Deterministic foundation | 1 | `npm run check` plus verified local model assets |
| 2 | Durable RAG core | 2 | Full, Offline RAG, and Build |
| 3 | HTTP/application integration | 3 | Full and Build |
| 4 | Production evidence/operations | 3 | Offline RAG, container, read-only Railway plan, and Build |
| 5 | Validation round 1 fixes | Fix 1 | Full, Offline RAG, hermetic CI/container evidence, and independent re-verification |

## Task Granularity Check

| Task(s) | Single deliverable | Generated/test companions | Status |
| ------- | ------------------ | ------------------------- | ------ |
| T1 | One dependency-tree contract in `package.json` | npm lockfile + contract test | ✅ Granular |
| T2-T9 | One domain/application/config component each | Co-located unit tests | ✅ Granular |
| T10-T18 | One storage/application adapter or coordinator each | Co-located unit/integration tests | ✅ Granular |
| T19-T23 | One metrics/HTTP/composition/OpenAPI component each | Co-located unit/integration tests and snapshot | ✅ Granular |
| T24 | One production container contract | Static + smoke tests | ✅ Granular |
| T25 | One retrieval-evaluation gate | Authored fixture inside the test module | ✅ Granular |
| T26 | One Railway IaC change | Contract test + read-only generated plan | ✅ Granular |
| T28 | One transitive dependency remediation in `package.json` | npm lockfile + dependency contract test | ✅ Granular |
| T27 | One operator runbook | Documentation contract test | ✅ Granular |
| T29-T31 | One readiness, telemetry, or maintenance correction each | Co-located unit/integration tests | ✅ Granular |
| T32 | One lifecycle evidence deliverable | Real-store integration test | ✅ Granular |
| T33 | One score-projection compatibility correction | Real-index integration test | ✅ Granular |
| T34 | One hermetic CI workflow correction | Static, clean-checkout, and remote run evidence | ✅ Granular |

No task owns more than one production source/config/document deliverable. Test files, snapshots,
lockfiles, and generated evidence are atomic companions required to verify that deliverable.

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | phase start | ✅ Match |
| T2-T9 | immediately prior task T1-T8 | same immediately prior arrow | ✅ Match |
| T10 | T9 (prior phase) | prior phase completion | ✅ Match |
| T11-T18 | immediately prior task T10-T17 | same immediately prior arrow | ✅ Match |
| T19 | T18 (prior phase) | prior phase completion | ✅ Match |
| T20-T23 | immediately prior task T19-T22 | same immediately prior arrow | ✅ Match |
| T24 | T23 (prior phase) | prior phase completion | ✅ Match |
| T25-T26 | immediately prior task T24-T25 | same immediately prior arrow | ✅ Match |
| T28 | T26 | same immediately prior arrow | ✅ Match |
| T27 | T28 | same immediately prior arrow | ✅ Match |
| T29 | T27 | prior phase completion | ✅ Match |
| T30-T34 | immediately prior task T29-T33 | same immediately prior arrow | ✅ Match |

## Test Co-location Validation

| Task(s) | Code layer created/modified | Matrix requires | Task says | Status |
| ------- | --------------------------- | --------------- | --------- | ------ |
| T1, T3-T5, T19, T26-T28 | Config/manifest/metrics/script/IaC/dependency/docs contract | unit | unit | ✅ OK |
| T2, T6-T9 | Domain/application policy | unit | unit | ✅ OK |
| T10-T13 | Artifact/repository boundary | unit + integration (path helper: unit) | matching per task | ✅ OK |
| T14-T18 | Encoder/index/worker/coordinator | unit + integration | unit + integration | ✅ OK |
| T20-T23 | HTTP/composition/OpenAPI | integration | integration | ✅ OK |
| T24 | Production container | unit + integration | unit + integration | ✅ OK |
| T25 | Real retrieval evaluation | integration | integration | ✅ OK |
| T29-T31, T33 | Lifecycle/application/index correction | unit + integration | matching per task | ✅ OK |
| T32 | Cross-store lifecycle boundary | integration | integration | ✅ OK |
| T34 | CI/container workflow | unit + integration | matching static/clean/remote evidence | ✅ OK |

There are no deferred tests and no `Tests: none` tasks. Every task must add its required tests before
its commit, run the named gate, compare the pre/post test count, and record evidence in this file.

## Approved Tool Surface for Execute

- Local edits and inspection: `apply_patch`, `rg`, npm/Vitest/TypeScript/Biome, Docker when available.
- Network: only pinned model build/fetch, official primary documentation if an API mismatch appears,
  and Railway operations through the `use-railway` skill.
- Skills: `tlc-spec-driven` for every task; `use-railway` for T24 deployment validation and T26-T27.
- MCPs: none are required or assumed.
- Agents: three completed sequential execution-batch sub-agents, validation round 1's fresh read-only
  Verifier, then one fresh sequential fix implementer and one fresh independent re-Verifier. No
  parallel writes.

Railway `apply` and deployment are intentionally outside a worker task: after the exact final plan is
shown and separately approved, the main agent applies it, deploys the verified commit, probes health,
readiness, protected RAG behavior, persistence, metrics, and rollback evidence.
