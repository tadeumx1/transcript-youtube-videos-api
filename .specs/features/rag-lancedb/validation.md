# RAG-native LanceDB Ingestion Validation — Round 2

**Verdict:** FAIL
**Date:** 2026-08-27
**Spec:** `.specs/features/rag-lancedb/spec.md`
**Full diff:** `4143edc21cad4e02f771753c222f4d3aab4e4734..ac78b4f1e48bf2e8fd0126a71ede580625d6e62f`
**Fix diff:** `e63bb3d4e6fd160f00323d22a3b1c963a17aa203..ac78b4f1e48bf2e8fd0126a71ede580625d6e62f`
**Verifier:** `/root/rag_reverifier_2`, independent fresh verifier (author != verifier)

The implementation matches **51 of 52** acceptance criteria and **10 of 10** explicit edge cases.
T29-T33 close the four local/code gaps from round 1 (LIFE-04, OPS-04, OPS-05, and EDGE-09), and
T34 closes the clean-checkout model/projection/local-workflow gaps. The remaining conjunct is
OPS-10's real Linux container/CI execution. Supplied run 33045709364 ended `startup_failure`,
`path=BuildFailed`, with zero jobs; it is therefore evidence-zero, not a pass.

## Verification Boundary and Tree Integrity

- Baseline porcelain before verifier work was empty; HEAD was exactly `ac78b4f1e48...` on `main`.
- The complete `spec.md`, `design.md`, `tasks.md`, round-1 `validation.md`, full 77-file diff, and
  six-commit fix loop were read. The full diff is 21,872 insertions/307 deletions; the fix diff is
  1,891 insertions/200 deletions across 20 files.
- No stash, reset, code/test/spec/task/STATE edit, commit, push, deploy, setting change, credential
  use, or external mutation was performed. Detached temporary worktrees held all baseline,
  clean-checkout, and mutation work and were removed/pruned.
- The only intended real-tree change is this round-2 report. Scratch diffs were empty before their
  removal. A first clean-checkout command was invalidated because it ran from the real cwd; it was
  not counted, and the entire proof was repeated from a verified detached checkout.

## Task Completion and Structural Gates

| Check | Exact result |
| --- | --- |
| Tasks | 34 headings; 155 Done-When boxes checked; exactly one unchecked box at `tasks.md:1229`. |
| T29-T33 | Complete: fatal/readiness/restart, real telemetry/privacy, maintenance threshold/lock/reset, source-lifecycle independence, and explicit score projection are executable and discriminating. |
| T34 | **PARTIAL**: clean-checkout source/offline gates and workflow contracts pass; its deliberate remote-job checkbox remains unchecked because no GitHub job ran. |
| Atomic commits | T29 `7bf2b78`, T30 `67aaa34`, T31 `3b45d5a`, T32 `c3b32c0`, T33 `83b4a9a`, T34 `ac78b4f`; all 38 subjects in the full range passed `check_commit.py`. |
| Spec validator | `validate_spec.py --strict rag-lancedb`: 0 errors, 0 warnings. |
| Tasks validator | `validate_tasks.py --strict rag-lancedb`: 0 errors, 0 warnings. |
| Diff hygiene | Full-range `git diff --check` passes after this report replaces round 1. |

## Spec-Anchored Acceptance Criteria

Every row cites an executable assertion and its observed outcome. Adjacent static or mocked
evidence is not substituted for a missing required conjunct.

### Ingestion

| AC | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| ING-01 | `test/integration/rag-routes.test.ts:164-181` — `statusCode === 202`, exact `Location`, `Retry-After === "2"`, exact eight-field resource, and relative links pass for miss/joined/hit. | PASS |
| ING-02 | `test/unit/file-rag-repository.test.ts:125-153` — `events` equals snapshot writes/publication before record persistence, and restart `readSnapshot(...)` equals the verified source. | PASS |
| ING-03 | `test/unit/rag-ingestion-worker.test.ts:397-429` — recovered work reads the persisted snapshot and batches locally; `test/integration/local-e5-encoder.test.ts:37` asserts `fetchSpy` was never called. | PASS |
| ING-04 | `test/integration/rag-routes.test.ts:185-200` — all retained states return exact 200 resources; failed output contains only the allowlisted code/message. | PASS |
| ING-05 | `test/unit/durable-job-coordinator.test.ts:540-590` — queued/processing, failed, unknown, expired, and storage failure reject with the exact reused `JOB_*` code and zero downstream creation calls. | PASS |
| ING-06 | `test/unit/rag-ingestion-coordinator.test.ts:733-762` — unknown rejects exact 404 `RAG_INGESTION_NOT_FOUND`; retained tombstone rejects exact 410 `RAG_INGESTION_EXPIRED`. | PASS |
| ING-07 | `test/unit/rag-ingestion-coordinator.test.ts:637-654` — event indexes assert reconcile/recover/start precede admission readiness and the single worker is ready to claim FIFO work. | PASS |
| ING-08 | `test/unit/rag-ingestion-worker.test.ts:377-394` — stop at a batch boundary leaves queued recoverable work/snapshot and restart completes; `test/unit/rag-ingestion-coordinator.test.ts:780-798` asserts readiness/admission close before worker shutdown. | PASS |

### Versioning and publication

| AC | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| VER-01 | `test/unit/rag-domain.test.ts:77-151` — independently recomputed SHA-256 identities match, frozen inputs alter only the intended identity, and no preimage appears. | PASS |
| VER-02 | `test/unit/rag-ingestion-coordinator.test.ts:443-472` — concurrent submissions return one miss plus joined responses with identical IDs, one record, one worker notification, and one metric record per outcome. | PASS |
| VER-03 | `test/unit/rag-ingestion-coordinator.test.ts:497-535` — retained/recreated hits are exact completed resources and snapshot, capacity, worker, and index-mutation calls remain zero. | PASS |
| VER-04 | `test/unit/rag-ingestion-coordinator.test.ts:539-558` — an in-flight different version rejects exact 409 `RAG_DOCUMENT_UPDATE_IN_PROGRESS` with `Retry-After: 2` before new work. | PASS |
| VER-05 | `test/unit/rag-ingestion-worker.test.ts:432-479` — prepublication failures keep replace calls at zero and preserve the prior version; `test/integration/rag-search-service.test.ts:132-179` observes complete old then complete new results. | PASS |
| VER-06 | `test/integration/lancedb-rag-index.test.ts:242-289` — smaller/larger replacements expose exact new counts while unrelated rows remain; concurrent search assertions see only all-old or all-new versions. | PASS |
| VER-07 | `test/unit/rag-ingestion-worker.test.ts:432-479` — snapshot/chunk/embed/validation/publication failures emit fixed reasons, keep staging invisible, and preserve the prior active version. | PASS |
| VER-08 | `test/unit/rag-ingestion-worker.test.ts:397-429,483-502` — restart recovers local snapshots, aborts safely, and postcommit state avoids duplicate vectors; `test/unit/file-rag-repository.test.ts:266-290` deterministically repairs duplicate ownership. | PASS |

### Chunking and embeddings

| AC | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| CHUNK-01 | `test/unit/rag-chunker.test.ts:104-152` — two runs are equal and concatenated ordered core spans equal the exact source string byte-for-byte. | PASS |
| CHUNK-02 | `test/unit/rag-chunker.test.ts:196-229` — preferred segment boundaries and deterministic Unicode-safe splits preserve order/content; no split starts on a combining mark. | PASS |
| CHUNK-03 | `test/unit/rag-chunker.test.ts:155-193` — actual tokenizer counts assert passage input `<= 320`, prior overlap `<= 48`, and 319/320/321 plus 511/512/513 fixtures preserve source without truncation. | PASS |
| CHUNK-04 | `test/unit/rag-chunker.test.ts:104-152` — exact ID/checksum, ordinal/count, core/overlap offsets, segment range, nullable seconds, and original precision are asserted. | PASS |
| CHUNK-05 | `test/unit/rag-chunker.test.ts:123-149` — the exact provenance object contains every source/job/artifact/cache/checksum and schema/chunk/model field. | PASS |
| CHUNK-06 | `test/unit/rag-chunker.test.ts:267-287` — exact limits pass, +1 code point/+1 chunk reject `RAG_SOURCE_TOO_LARGE`, and publication remains zero. | PASS |
| EMB-01 | `test/unit/model-manifest.test.ts:90-113,149-226` — repository/revision/dtype/384/prefixes and all artifact hashes are exact; missing/extra/wrong-SHA artifacts fail closed. | PASS |
| EMB-02 | `test/unit/local-e5-encoder.test.ts:61-104` — local-only flags, exact query/passage prefixes, mean pooling, and normalization pass; `test/integration/local-e5-encoder.test.ts:22-45` asserts real encoding with zero fetch. | PASS |
| EMB-03 | `test/integration/local-e5-encoder.test.ts:39-45` — real vectors have length 384, finite unit norm, and relevant similarity; unit tests map bad dimension/nonfinite/norm to fixed model failure. | PASS |
| EMB-04 | `test/unit/rag-ingestion-worker.test.ts:397-429` asserts batch sizes never exceed 8; `test/unit/rag-encoder-scheduler.test.ts:60-109` asserts one permit and bounded search/ingestion yield order. | PASS |

### Search

| AC | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| SEARCH-01 | `test/integration/rag-routes.test.ts:262-280` and `test/unit/rag-search-service.test.ts:122-140` — strict query/topK/document ID bounds reject before admission, encoder, or index access. | PASS |
| SEARCH-02 | `test/unit/rag-search-service.test.ts:161-200` — exact RRF terms/order and backend limits cap fusion at 100; real Lance vector and FTS paths return active finite candidates. | PASS |
| SEARCH-03 | `test/unit/rag-search-service.test.ts:161-200` — exact document/version/ordinal tie order and repeated results are equal; `test/integration/rag-search-service.test.ts:94-129` asserts identical IDs/order over three real runs. | PASS |
| SEARCH-04 | `test/unit/rag-search-service.test.ts:202-255` — exact public result/provenance and finite score pass while serialized query, vector, paths, publication, and overlap internals are absent. | PASS |
| SEARCH-05 | `test/integration/rag-search-service.test.ts:94-129` — empty index, empty filter, and unknown/deleted filter each equal `{results: []}`. | PASS |
| SEARCH-06 | `test/unit/rag-search-service.test.ts:143-158` — fifth concurrent search rejects exact 429/`RAG_SEARCH_CAPACITY_EXCEEDED`/Retry-After 5 before encoder/index calls. | PASS |
| SEARCH-07 | `test/integration/lancedb-rag-index.test.ts:414-445` — fingerprint/dimension mismatch rejects fixed storage failure and rows remain intact; model faults map to fixed 503 with no rebuild/fallback. | PASS |
| SEARCH-08 | `test/unit/rag-encoder-scheduler.test.ts:60-109` — exact scheduling bounds four admitted searches between ingestion batches without interrupting an in-flight batch or duplicating the encoder. | PASS |

### Lifecycle and capacity

| AC | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| LIFE-01 | `test/integration/rag-routes.test.ts:223-234` asserts exact 204/empty body; `test/integration/lancedb-rag-index.test.ts:373-385` asserts immediate absence from inspect/vector/FTS/hybrid paths. | PASS |
| LIFE-02 | `test/unit/rag-ingestion-coordinator.test.ts:606-633` — unknown/repeated delete rejects exact 404 and does not access source; `test/integration/rag-routes.test.ts:237-258` rejects malformed IDs before coordinator access. | PASS |
| LIFE-03 | `test/integration/rag-search-service.test.ts:132-209` — read/write generation fencing yields one serializable all-old/all-new/deleted outcome; `test/unit/rag-ingestion-worker.test.ts:542-558` prevents resurrection. | PASS |
| LIFE-04 | `test/integration/rag-lifecycle-independence.test.ts:258-305` hashes and compares the real source record, transcript JSON, and PDF before/after ingest, replace, and delete; `:312-336` expires/sweeps the source, asserts durable `JOB_EXPIRED`, and asserts post-expiry RAG search equals pre-expiry text plus provenance with zero provider/network calls. | PASS |
| LIFE-05 | `test/unit/rag-readme-contract.test.ts:116-128` requires logical deletion, fragments/compaction/backups/retention language and prohibits an immediate secure-erase promise. | PASS |
| LIFE-06 | `test/unit/file-rag-repository.test.ts:240-263` — terminal metadata becomes a content-free tombstone at 24h and is removed after the next exact 24h, independently of completed documents. | PASS |
| CAP-01 | `test/unit/file-rag-repository.test.ts:293-307` asserts 134,217,728 bytes passes and one byte less fails; `test/unit/rag-ingestion-coordinator.test.ts:559-581` rejects exact 507 before snapshot/work while non-miss operations remain callable. | PASS |
| CAP-02 | `test/unit/rag-ingestion-coordinator.test.ts:539-581` — 25 queued rejects exact 429/Retry-After 30 before record creation; joined/hit paths bypass capacity and return 202. | PASS |

### Operations and evidence

| AC | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| OPS-01 | `test/unit/config.test.ts:70-132` — exact defaults and min/max bounds pass; invalid values expose only the environment variable name. | PASS |
| OPS-02 | `test/unit/railway-contract.test.ts:21-82` — exact one replica, 1024 MB `/data` Volume, `/data/lancedb`, packaged model, preserved secrets, and no prohibited resources/secrets; `test/unit/container-contract.test.ts:128-182` checks pinned model/runtime assets. | PASS |
| OPS-03 | `test/integration/application-composition.test.ts:169-203` and `test/unit/rag-ingestion-coordinator.test.ts:637-654` assert storage/index/model warmup, reconciliation, and both workers precede `/ready === 200`; `/health` stays public/network-free. | PASS |
| OPS-04 | `test/unit/rag-ingestion-coordinator.test.ts:691-730` injects a real post-start worker fatal and asserts `isReady === false`, all four RAG content operations reject fixed 503s, recovery creates/restarts once, and stop prevents resurrection; `test/integration/rag-http-app.test.ts:349-419` asserts exact `/ready` 503, `/health` 200, transcript/job continuity, sanitized RAG failures, and recovery to 200. | PASS |
| OPS-05 | `test/integration/application-composition.test.ts:499-539` performs real miss/join/process/search/delete and asserts exact production metric deltas plus active docs/chunks returning to zero; `test/unit/rag-ingestion-coordinator.test.ts:355-439` asserts reconcile/delete/sweep outcomes and failures; `test/unit/runtime-metrics.test.ts:217-246` asserts malicious dynamic values render only as `unknown` with no content/ID/path leakage. | PASS |
| OPS-06 | `test/unit/rag-domain.test.ts:369-385` asserts fixed code/status/message and no nested cause; `test/unit/runtime-metrics.test.ts:217-246` proves credential/URL/path/query/content strings cannot enter labels. | PASS |
| OPS-07 | `test/integration/openapi.test.ts:125-167,383-475` — OpenAPI `1.2.0`, all four RAG operations, strict schemas, Bearer security, headers/statuses/error codes, and legacy route parity are exact. | PASS |
| OPS-08 | `test/evaluation/rag-retrieval.test.ts:792-811` — fixture/version, 12 unique documents, 48 qrels, required category counts, hashes, and ranges are exact. | PASS |
| OPS-09 | `test/evaluation/rag-retrieval.test.ts:823-863` — three runs assert all thresholds, deterministic IDs/ranks, 8/8 disambiguation top-1, and zero network. Observed hybrid Recall@5/MRR@10/nDCG@10: `0.9791666667 / 0.8833333333 / 0.9074850862`. | PASS |
| OPS-10 | `.github/workflows/ci.yml:27-50` now performs `npm ci`, verified model restore/fetch/cache, check, offline, and audit; `:52-74` defines `rag-smoke` and production builds. `test/unit/ci-contract.test.ts:26-106` asserts fetch is unconditional and both `push:false` builds exist. A verified clean checkout passes 738/31/audit. However supplied GitHub run 33045709364 is `startup_failure`, `path=BuildFailed`, zero jobs, and no local container runtime exists. The required real Linux job/image executions remain evidence-zero. | **FAIL** |

**Acceptance status:** **51/52 matched**; one evidence gap (OPS-10); zero spec-precision gaps.

## Explicit Edge Cases

| Edge | `file:line` + assertion/outcome | Result |
| --- | --- | --- |
| EDGE-01 | `test/integration/rag-routes.test.ts:283-305` — malformed unauthenticated requests return exact 401/`WWW-Authenticate: Bearer` and every RAG dependency remains uncalled. | PASS |
| EDGE-02 | `test/integration/artifact-snapshot-lock.test.ts:32-65` — expiry serializes behind the source lock and yields one complete verified snapshot or exact post-expiry error, never a dangling reference. | PASS |
| EDGE-03 | `test/unit/rag-ingestion-worker.test.ts:659-688` — precommit/mixed crash states keep staging invisible and deterministically retry or fail without retranscription. | PASS |
| EDGE-04 | `test/unit/rag-ingestion-worker.test.ts:561-586,635-656` — postcommit crash recovery verifies the active version, performs zero re-embedding/republication, and completes metadata. | PASS |
| EDGE-05 | `test/integration/lancedb-rag-index.test.ts:242-289` — smaller replacement exposes only the exact new chunk count in all modes while unrelated rows remain. | PASS |
| EDGE-06 | `test/unit/rag-chunker.test.ts:233-251` — whitespace remains covered by exact offsets, usable output is attached deterministically, and all-empty input rejects `RAG_SOURCE_UNAVAILABLE` without empty/NaN vectors. | PASS |
| EDGE-07 | `test/integration/lancedb-rag-index.test.ts:414-445` — stored fingerprint/dimension mismatch fails closed and restoration reveals unchanged prior rows without rebuild. | PASS |
| EDGE-08 | `test/unit/rag-ingestion-worker.test.ts:285-374` — optimize triggers exactly at 20 successful mutations/100,000 rows, serializes with competing mutation, and resets only on success; `test/integration/lancedb-rag-index.test.ts:522-586` asserts safe options and unchanged active results. | PASS |
| EDGE-09 | `test/unit/rag-ingestion-worker.test.ts:505-539,589-632` injects fatal snapshot failure and post-admission ENOSPC, asserting fixed failure, prior version/staging cleanup, readiness degradation, and recovery; `test/unit/rag-ingestion-coordinator.test.ts:585-602` asserts exact 503/admission false/no record; `test/integration/rag-http-app.test.ts:349-419` proves exact runtime readiness/content isolation. | PASS |
| EDGE-10 | `test/unit/rag-chunker.test.ts:209-229` — missing/coarse Muse timestamps remain nullable/chunk-precision exactly, without interpolated segment precision. | PASS |

**Edge status:** **10/10 matched**; zero gaps.

## Round-1 Gap Closure

| Prior gap | Fix/evidence | Round-2 result |
| --- | --- | --- |
| LIFE-04 | T32 adds real durable source/RAG lifecycle independence through replace/delete/source expiry (`rag-lifecycle-independence.test.ts:258-336`). | CLOSED |
| OPS-04 | T29 makes fatal degradation coordinator-owned and restartable, with composed HTTP isolation (`rag-ingestion-coordinator.test.ts:691-730`; `rag-http-app.test.ts:349-419`). | CLOSED |
| OPS-05 | T30 wires real operation telemetry/privacy; T31 wires thresholded serialized optimize with success-only reset (`application-composition.test.ts:499-539`; `rag-ingestion-worker.test.ts:285-374`). | CLOSED |
| EDGE-09 | T29 adds post-admission/fatal storage degradation, cleanup, prior-version preservation, readiness failure, and recovery evidence (`rag-ingestion-worker.test.ts:505-539,589-632`). | CLOSED |
| LanceDB warnings | T33 explicitly selects `_distance`/`_score`; stable vector/FTS projection tests pass and the offline gate emits zero auto-projection warnings (`lancedb-rag-index.test.ts:293-369`). | CLOSED |
| Clean-checkout model | T34 adds manifest-keyed cache plus unconditional verified fetch; a fresh detached checkout passes all local gates (`ci-contract.test.ts:26-106`). | LOCALLY CLOSED |
| Real CI/container | T34's remote checkbox remains unchecked; run 33045709364 created zero jobs. | OPEN / EVIDENCE-ZERO |

## Gate Check and Test Integrity

| Gate | Exact result |
| --- | --- |
| `npm run check` | Exit 0: Biome 103 files; strict TypeScript; Vitest **58 files / 738 tests passed**; production build passed. |
| `npm run test:rag:offline` | Exit 0: **7 files / 31 tests passed**; 12 documents/48 qrels; determinism and runtime network denial passed. |
| Baseline `4143edc` | Detached checkout: **30 files / 436 tests passed**. Current delta: **+302** tests. |
| Skips | **0** real skips; no `.skip`, `.todo`, `.only`, `xit`, `xtest`, or `xdescribe` syntax. Filter-nonselected tests during sensor runs were not gate skips. |
| LanceDB warnings | Exact auto-projection warning count: **0**. Explicit `_distance` and `_score` projection is exercised in three stable vector and FTS runs. |
| Dependency audit | `npm audit --omit=dev`: exit 0, **0 vulnerabilities**. |
| Strict validators | Spec 0 errors/0 warnings; tasks 0 errors/0 warnings; all 38 commit subjects valid. |
| Workflow syntax | Official actionlint 1.7.7 Linux x64 binary was checksum-verified in temp storage; `.github/workflows/ci.yml` exited 0. Temp files were removed. |
| Clean checkout | Fresh detached `ac78b4f` with no `.models`: `npm ci`; build; first verified model fetch; second reuse+verify; check **738/738**; offline **31/31**; audit 0. Scratch removed. |
| Container runtime | Docker, Podman, Buildah, Nerdctl, and Finch are unavailable locally; no local image execution is claimed. |

### Remote CI/container evidence

- The supplied authoritative outcome for GitHub run **33045709364** is `startup_failure`,
  `path=BuildFailed`, with **zero jobs**. No source, audit, `rag-smoke`, or production-image command
  executed in that run.
- An unauthenticated read-only GitHub API request returned 404 for the private repository; no
  credential was used. This does not replace the supplied outcome and produces no new execution
  proof.
- Workflow text, actionlint, static container contracts, and a clean local checkout establish local
  hermeticity only. Under evidence-or-zero, they cannot prove an actual Linux container build/run.

## P0 Discrimination Sensor

Ten mutations were applied one at a time in an isolated detached worktree with dependency/model
symlinks, then restored before the next. Every mutant died on an outcome assertion; scratch tracked
diff was empty before removal, the worktree was pruned, and no stash was used.

| ID | Risk / mutation | Exact killing assertion/outcome | Result |
| --- | --- | --- | --- |
| M01 | Worker fatal no longer calls coordinator degradation | `rag-ingestion-coordinator.test.ts:700`: expected `isReady === false`, received true. | KILLED |
| M02 | Fatal leaves worker marked started, blocking restart | `rag-ingestion-coordinator.test.ts:724`: expected `worker.start` twice, received once. | KILLED |
| M03 | Remove real submission metric recording | `application-composition.test.ts:501`: expected the miss metric sample; it was absent. | KILLED |
| M04 | Metrics allowlist leaks raw dynamic values | `runtime-metrics.test.ts:232`: expected `unknown` and no malicious content; raw content rendered. | KILLED |
| M05 | Optimize threshold changes from 20 to 21 | `rag-ingestion-worker.test.ts:295`: expected one optimize call, received zero. | KILLED |
| M06 | Optimize drops the publication write lock | `rag-ingestion-worker.test.ts:365`: expected competing mutation not to enter; it entered. | KILLED |
| M07 | Optimize failure resets retry counters | `rag-ingestion-worker.test.ts:334`: expected retry/two calls, received one. | KILLED |
| M08 | Lifecycle test receives corrupted source expiry | `rag-lifecycle-independence.test.ts:276`: expected exact source expiry, received epoch time. | KILLED |
| M09 | Vector query omits explicit `_distance` projection | LanceDB emitted three auto-projection warnings and `lancedb-rag-index.test.ts:357` expected `_distance`; mutant failed. | KILLED |
| M10 | CI model fetch runs only on cache hit | `ci-contract.test.ts:90`: expected fetch step `if` to be undefined/unconditional; condition was present. | KILLED |

**Sensor:** **10 injected, 10 killed, 0 survived — PASS.**

## Coding-Principle Review

| Principle | Status | Evidence |
| --- | --- | --- |
| Surgical scope / no regression | PASS | Full and fix diffs stay within approved RAG/API/config/IaC/docs/tests/spec artifacts; 738 current tests and 31 offline tests pass. |
| Behavioral contracts | PASS | Strict schemas, fixed errors/labels, publication/lifecycle locks, recovery, and privacy are asserted at domain, filesystem, LanceDB, composition, HTTP, and evaluation layers. |
| Test integrity | PASS | +302 tests from the 436 baseline, zero real skips, 10/10 mutants killed, and no behavioral assertion weakening found. |
| Atomic/task discipline | PARTIAL | T29-T33 are complete and conventional; T34 is intentionally partial until a real remote run executes. |
| Runtime truthfulness | FAIL | Static/local workflow evidence is green, but real GitHub/Linux image execution is evidence-zero. |

## Ranked Gap and External Fix Plan

### 1. Release blocker / P1 — OPS-10 real CI and container execution

**Gap:** the workflow is locally hermetic and statically valid, but the only supplied current run
failed before job creation. No source gate, dependency audit, `rag-smoke`, or production image build
ran on GitHub/Linux. OPS-10 is conjunctive, so the AC and T34 cannot be complete.

**External fix plan:**

1. The repository/account owner diagnoses and resolves the GitHub Actions startup failure without
   weakening or bypassing the workflow.
2. Rerun `.github/workflows/ci.yml` at `ac78b4f` or a later content-equivalent commit and retain a
   run where jobs actually start.
3. Preserve green logs/artifacts for `npm run check` (738 or later non-regressed count),
   `npm run test:rag:offline` (31 or later), `npm audit --omit=dev`, `rag-smoke` build/run, and the
   production image build, including model verification and runtime network denial where specified.
4. A fresh independent verifier checks those actual job/container outcomes, closes OPS-10 and the
   final T34 box, and only then runs traceability/state closing gates.

## Closing Gate

**Overall:** NOT READY solely because one required external execution conjunct is evidence-zero.

- ACs: **51/52 matched**; failure: OPS-10.
- Edge cases: **10/10 matched**.
- Local gate: **738 passed, 0 failed, 0 skipped**; baseline 436; delta **+302**.
- Offline RAG gate: **31 passed, 0 failed, 0 skipped**; auto-projection warnings **0**.
- Audit: **0 vulnerabilities**. Sensor: **10/10 killed**.
- T29-T33: complete. T34: partial, one remote-execution checkbox deliberately pending.
- Real GitHub/container execution: **evidence-zero**; run 33045709364 was
  `startup_failure`/`BuildFailed` with zero jobs.

Because the verdict is FAIL, `validate_state.py` was intentionally not run. The verifier did not
modify `spec.md`, `tasks.md`, `STATE.md`, implementation, tests, or lessons; the main agent may
distill a lesson only if this round provides a new reusable signal.
