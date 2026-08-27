# RAG-native LanceDB Ingestion Validation

**Verdict:** FAIL  
**Date:** 2026-08-27  
**Spec:** `.specs/features/rag-lancedb/spec.md`  
**Diff range:** `4143edc..a10c357`  
**Verifier:** `/root/rag_verifier`, independent fresh verifier (author != verifier)

The implementation matches 48 of 52 acceptance criteria and 9 of 10 explicit edge cases. The
local source gate is green (724/724 tests), the offline RAG gate is green (30/30 tests), and the P0
sensor killed all 5 mutations. Those green signals do not close four spec outcomes: a fatal worker
after startup does not invalidate coordinator readiness; most RAG metric families and the approved
maintenance trigger are not connected to production paths; source-artifact independence after
delete/replace/expiry has no end-to-end evidence; and neither CI run executed a real job or image
build. A clean-checkout simulation additionally proves that the current CI source job cannot find
the ignored local model.

---

## Verification Boundary and Tree Integrity

- Baseline porcelain before any verifier work: empty (`git status --porcelain=v1`).
- Verified commits: baseline `4143edc21cad...`; HEAD `a10c3577e04731d9ddf27e00fe125b847bb0d1a2`.
- Scope read completely: `spec.md`, `context.md`, `design.md`, `tasks.md`, all 73 changed files and
  the tests in `4143edc..HEAD`; net diff is 19,532 insertions and 301 deletions.
- No stash, reset, commit, push, deploy, Railway mutation, credential use, or real-tree code/test
  edit was performed. Detached worktrees were used for baseline, clean-checkout, and mutation runs
  and were removed with `git worktree remove`/`prune`.
- The only intended real-tree change is this report. Porcelain was empty again after every scratch
  worktree was removed and immediately before this file was created.

## Task Completion and Structural Gates

| Check | Exact result |
| --- | --- |
| Tasks | 28/28 task headings; 127/127 Done-When boxes checked; 0 unchecked |
| Atomic task commits | 28/28 tasks have one mapped implementation commit; every subject passed `check_commit.py` |
| Spec validator | 0 errors, 0 warnings |
| Tasks validator | 0 errors, 0 warnings |
| Commit range | Planning commit + 28 task commits + handoff commit; `git diff --check` passed |
| Documentation hygiene | Only T1-T9 and T27-T28 headings carry the optional `✅` suffix; T10-T26 do not. The status block and every Done-When box nevertheless say complete. |
| Traceability hygiene | `spec.md` still contains 32 `In Progress` rows and 7 unchecked goal boxes despite the completed tasks. This verifier was not authorized to edit them. |

Task-to-commit mapping: T1 `ef2b28b`, T2 `45f0c54`, T3 `2d28364`, T4 `b1d2b05`, T5 `856f317`,
T6 `cb4b456`, T7 `095e075`, T8 `5879f50`, T9 `535eebc`, T10 `b3b92e8`, T11 `6f40056`,
T12 `d030a73`, T13 `c6d6d72`, T14 `dfe7c79`, T15 `366d998`, T16 `2096d40`, T17 `0917984`,
T18 `3740a80`, T19 `38b8f24`, T20 `10b1e6b`, T21 `1390485`, T22 `3bf4f36`, T23 `65f8279`,
T24 `9ffe38f`, T25 `a567d1c`, T26 `134be49`, T27 `9bb0f71`, T28 `c7588d3`.

---

## Spec-Anchored Acceptance Criteria

Every row names an executable assertion and its exact observed/spec outcome. A missing required
outcome is zero evidence, even when adjacent unit behavior looks plausible.

### Ingestion

| AC | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| ING-01 | `test/integration/rag-routes.test.ts:177-181` — `expect(statusCode).toBe(202)`, exact `Location`, `Retry-After === "2"`, `toEqual(submission(disposition))`, and exact `jobId` delegation pass for miss/joined/hit. | PASS |
| ING-02 | `test/unit/file-rag-repository.test.ts:146-153` — `expect(events).toEqual(["write:transcript","json:manifest","publish:snapshot","json:record"])` and restarted `readSnapshot(...).resolves.toEqual(source())`; exact snapshot-before-queued durability passes. `test/integration/rag-ingestion-coordinator.test.ts:128-151` also reads the persisted verified snapshot after restart. | PASS |
| ING-03 | `test/unit/rag-ingestion-worker.test.ts:280-296` — chunker receives only the persisted snapshot and the encoder batch calls equal `[8,2]`; worker dependencies contain no remote/provider surface. `test/integration/local-e5-encoder.test.ts:37` asserts `expect(fetchSpy).not.toHaveBeenCalled()`. Exact outcome: local snapshot/model only. | PASS |
| ING-04 | `test/integration/rag-routes.test.ts:197-199` — each queued/processing/completed/failed read is exact HTTP 200 and `toEqual(resource(status))`. `test/unit/rag-domain.test.ts:399-419` asserts the exact allowlisted failed resource and absence of `source`, `snapshot`, and transcript SHA. | PASS |
| ING-05 | `test/unit/durable-job-coordinator.test.ts:540-550,568-572,583-590` — source states reject with the exact reused `JOB_*` codes while production/artifact calls stay zero; `test/integration/rag-ingestion-coordinator.test.ts:120-137` proves only a verified completed source creates a queued snapshot. | PASS |
| ING-06 | `test/unit/rag-ingestion-coordinator.test.ts:568-576` — unknown `get(...)` rejects `{code:"RAG_INGESTION_NOT_FOUND",statusCode:404}` and retained tombstone rejects `{code:"RAG_INGESTION_EXPIRED",statusCode:410}`. | PASS |
| ING-07 | `test/unit/rag-ingestion-coordinator.test.ts:511-520` — exact event indexes assert delete reconciliation `< worker.recover < worker.start < admission.ready`, then `expect(coordinator.isReady).toBe(true)`; one worker start is asserted at `:539`. | PASS |
| ING-08 | `test/unit/rag-ingestion-worker.test.ts:352-371` — stopping during embedding resolves, record remains queued with snapshot, index replacement stays 0, and restart completes once. `test/unit/rag-ingestion-coordinator.test.ts:545-554` asserts exact unavailable/stop/close order and readiness false. | PASS |

### Versioning and publication

| AC | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| VER-01 | `test/unit/rag-domain.test.ts:77-120,149-151` — document/version SHA-256 values equal independently recomputed canonical hashes, change when frozen inputs change, match lowercase SHA shape, and chunk IDs do not contain text. | PASS |
| VER-02 | `test/unit/rag-ingestion-coordinator.test.ts:337-361` — concurrent calls return exact miss/joined resources with the same IDs, one record, and one `worker.notify`; exact one eligible work item. | PASS |
| VER-03 | `test/unit/rag-ingestion-coordinator.test.ts:396-424` — retained/recreated active hits are exact completed resources, events exclude snapshot/capacity work, `worker.notify` and `index.deleteDocument` remain uncalled. | PASS |
| VER-04 | `test/unit/rag-ingestion-coordinator.test.ts:445-450` — update rejects exact `{code:"RAG_DOCUMENT_UPDATE_IN_PROGRESS",statusCode:409,retryAfterSeconds:2}` before repository probe. | PASS |
| VER-05 | `test/unit/rag-ingestion-worker.test.ts:334-348` — source/embedding/snapshot failures keep `replaceCalls === 0` and old version `"9".repeat(64)` active. `test/integration/rag-search-service.test.ts:173-179` asserts concurrent search sees all-old, then one all-new version. | PASS |
| VER-06 | `test/integration/lancedb-rag-index.test.ts:244-271` — replacement receipt changes >=2 rows, exact new version/chunk count is visible, unrelated document remains; `test/integration/rag-search-service.test.ts:173-179` asserts complete old-or-new visibility, never mixed. | PASS |
| VER-07 | `test/unit/rag-ingestion-worker.test.ts:334-348` — every prepublication failure produces the exact allowlisted failure, no replace, and prior version unchanged; no staging is returned by the search-facing index. | PASS |
| VER-08 | `test/unit/rag-ingestion-worker.test.ts:399-418,427-442,454-474` — postcommit recovery performs zero re-embedding and completes metadata; consistent precommit work requeues; impossible mixed state rejects fixed storage failure. `test/unit/file-rag-repository.test.ts:283-290` collapses duplicate ownership to one queued record. | PASS |

### Chunking and embeddings

| AC | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| CHUNK-01 | `test/unit/rag-chunker.test.ts:114-122` — `expect(first).toEqual(second)` and concatenated core spans `toBe(input.transcript.text)`; exact deterministic reconstruction. | PASS |
| CHUNK-02 | `test/unit/rag-chunker.test.ts:204-206,221-229` — exact first segment boundary/ranges, multi-chunk reconstruction equals source, every huge-span boundary avoids a leading combining mark. | PASS |
| CHUNK-03 | `test/unit/rag-chunker.test.ts:155-193` — all passage inputs are `<=320` actual tokens; prior overlap is `<=48` and adding one code point is `>48`; 319/320/321 and 511/512/513 cases preserve source. | PASS |
| CHUNK-04 | `test/unit/rag-chunker.test.ts:123-152` — first chunk `toMatchObject` asserts ordinal/count, core/overlap/segment offsets, nullable times and original `timestampPrecision`; ID/checksum match 64-char SHA. | PASS |
| CHUNK-05 | `test/unit/rag-chunker.test.ts:132-149` — exact `source` object contains video/source URL, provider/language/generated/precision/extractedAt, job/artifact/cache/SHA and all version/fingerprint fields. | PASS |
| CHUNK-06 | `test/unit/rag-chunker.test.ts:278-287` — exact-bound source returns one chunk; +1 code point and +1 allowed chunk reject `RAG_SOURCE_TOO_LARGE`. `test/unit/rag-ingestion-worker.test.ts:336` asserts index replacement remains zero. | PASS |
| EMB-01 | `test/unit/model-manifest.test.ts:91-113` asserts exact repository, immutable revision, int8, 384, pooling/prefixes and five artifacts; `:158-163,224-226` asserts missing/extra/wrong-SHA all fail with the fixed integrity error. | PASS |
| EMB-02 | `test/unit/local-e5-encoder.test.ts:64-89,101-104` — env equals remote false/local true/cache false, pipeline has `local_files_only:true`, exact query/passage prefixes, mean pooling and normalization. `test/integration/local-e5-encoder.test.ts:37` asserts zero fetch calls. | PASS |
| EMB-03 | `test/integration/local-e5-encoder.test.ts:39-45` — real outputs are `[384,384,384]`, self dot products are `toBeCloseTo(1,5)`, and relevant similarity exceeds unrelated. `test/unit/local-e5-encoder.test.ts:120-136` maps bad dimension/nonfinite/norm to fixed `RAG_MODEL_UNAVAILABLE`. | PASS |
| EMB-04 | `test/unit/rag-ingestion-worker.test.ts:293-295` — embedding batches are exactly `[8,2]`. `test/unit/rag-encoder-scheduler.test.ts:80-109` asserts bounded four-search fairness and exact `['ingestion-1','search','ingestion-2']` yield order. | PASS |

### Search

| AC | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| SEARCH-01 | `test/unit/rag-domain.test.ts:174-215` — normalized defaults/bounds are exact and blank/1001/topK 0/21/duplicate/51/extra reject fixed validation messages. `test/unit/rag-search-service.test.ts:123-131` asserts zero admission/encoder/index access for invalid inputs. | PASS |
| SEARCH-02 | `test/unit/rag-search-service.test.ts:176-190` — result scores equal exact RRF terms and each backend is called with limit 50 (100 fused maximum). `test/integration/lancedb-rag-index.test.ts:285-291` asserts real finite vector/FTS candidates and no vectors in the returned objects. | PASS |
| SEARCH-03 | `test/unit/rag-search-service.test.ts:176-187` — exact document/version/ordinal tie order and runs 2/3 `toEqual(run1)`. `test/integration/rag-search-service.test.ts:117-122` repeats exact real LanceDB IDs/order three times. | PASS |
| SEARCH-04 | `test/unit/rag-search-service.test.ts:207-245` — response `toEqual` exact rank/finite score/IDs/text/ranges/provenance object and serialized output excludes query, vector, publication and overlap internals. | PASS |
| SEARCH-05 | `test/integration/rag-search-service.test.ts:123-125` — empty index, empty filter, and unknown document each equal `{results:[]}`. | PASS |
| SEARCH-06 | `test/unit/rag-search-service.test.ts:139-149` — occupied capacity rejects exact 429/code/Retry-After 5 before encoder/vector access, then release permits exact empty success and active count 0. | PASS |
| SEARCH-07 | `test/integration/lancedb-rag-index.test.ts:348-366` — model-fingerprint/dimension mismatch rejects fixed `RAG_STORAGE_UNAVAILABLE` and stored rows recover unchanged after manifest restoration. `test/unit/local-e5-encoder.test.ts:133-136` asserts fixed model failure. | PASS |
| SEARCH-08 | `test/unit/rag-encoder-scheduler.test.ts:80-109` — exact order caps consecutive searches at four and places an admitted search between ingestion batches; no in-flight batch is interrupted. | PASS |

### Lifecycle and capacity

| AC | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| LIFE-01 | `test/integration/rag-routes.test.ts:232-234` asserts exact 204/empty body/delegated strict ID. `test/integration/lancedb-rag-index.test.ts:301-307` asserts two rows deleted and inspect/vector/FTS all immediately empty. | PASS |
| LIFE-02 | `test/unit/rag-ingestion-coordinator.test.ts:495-499` — repeat deletion rejects exact 404/code and source access stays zero. `test/integration/rag-routes.test.ts:254-258` — malformed ID returns exact 400 before coordinator delete. | PASS |
| LIFE-03 | `test/integration/rag-search-service.test.ts:170-209` — waiting writer count is 1, in-flight reads are complete old/new, and post-delete search equals empty. `test/unit/rag-ingestion-worker.test.ts:384-390` fences publication on a newer delete generation. | PASS |
| LIFE-04 | `test/unit/rag-ingestion-coordinator.test.ts:495-499` only asserts `expect(sourceAccess).not.toHaveBeenCalled()` for repeated DELETE. There is no assertion that real source job records/transcript/PDF bytes remain unchanged across delete and replacement, nor any post-source-expiry search asserting active text/provenance. Required exact outcome has zero evidence. | **FAIL** |
| LIFE-05 | `test/unit/rag-readme-contract.test.ts:120-128` — README assertions require logical-only deletion language, compaction/fragments/backups/retention, and prohibit immediate secure-erasure promises. | PASS |
| LIFE-06 | `test/unit/file-rag-repository.test.ts:246-263` — pre-boundary record is exact; at 24h sweep returns `{terminalExpired:1,...}`, content-free tombstone expires exactly 24h later, then `get` is undefined. | PASS |
| CAP-01 | `test/unit/file-rag-repository.test.ts:293-307` — 134,217,728 is healthy and 134,217,727 is not. `test/unit/rag-ingestion-coordinator.test.ts:465-470` rejects exact 507 before `createQueued`; hit path at `:398-424` bypasses probe/work. | PASS |
| CAP-02 | `test/unit/rag-ingestion-coordinator.test.ts:455-460` — 25 queued rejects exact 429/code/Retry-After 30 before probe. Concurrent join at `:342-361` and hit at `:398-424` still return their exact 202 resources without new work. | PASS |

### Operations and evidence

| AC | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| OPS-01 | `test/unit/config.test.ts:71-84,93,101-132` — exact RAG defaults and every min/max boundary pass; invalid values reject messages containing only the environment variable name. | PASS |
| OPS-02 | `test/unit/railway-contract.test.ts:26-55,63-82` — exact one service/replica, 1024 MB `/data` Volume, `/data/lancedb`, preserved secrets, and prohibited resource/secret patterns. `test/unit/container-contract.test.ts:131-142` statically asserts pinned model stage/copy and Linux x64 ORT retention. | PASS |
| OPS-03 | `test/integration/application-composition.test.ts:169-203` asserts model/index/repository startup and readiness only after reconciliation/warmup; `test/unit/rag-ingestion-coordinator.test.ts:511-520` asserts the worker/readiness order; `test/integration/rag-http-app.test.ts:237-246` asserts exact 200/503 bodies. | PASS |
| OPS-04 | Existing test `test/integration/rag-http-app.test.ts:220-230` only supplies a fake coordinator with `isReady:false` and asserts 503. Real fatal path `src/application/rag-ingestion-worker.ts:388-398` invokes `onFatal`; production callback `src/app.ts:189-192` only marks worker metric false and search admission unavailable. `/ready` reads `ragCoordinator.isReady` (`src/http/app.ts:303-311`), which returns private `#ready` unchanged (`src/application/rag-ingestion-coordinator.ts:215-216`). Exact actual outcome after a post-start fatal is therefore coordinator ready/HTTP 200 while the worker is dead; content operations are not uniformly failed. | **FAIL** |
| OPS-05 | `test/unit/runtime-metrics.test.ts:175-214` manually invokes every metric method and exact rendered strings pass, but production caller search finds only admission rejection/active gauge (`src/application/rag-search-controller.ts:60-88`) and one worker-false write (`src/app.ts:190`). Submission/state/duration/failure, active documents/chunks, successful component health, successful/failing search duration/result count, and maintenance have no real-path calls. `recordRagMaintenance` has no production caller; `LanceDbRagIndex.optimize()` is called only by `test/integration/lancedb-rag-index.test.ts:486`. Exact operational telemetry/trigger outcome is absent. | **FAIL** |
| OPS-06 | `test/unit/rag-domain.test.ts:369-385` — every operational error has fixed code/status/message, no cause, and serialized output excludes query/stack/path/ID. `test/unit/runtime-metrics.test.ts:217-246` maps malicious labels to `unknown` and excludes credential/URL/path/content. | PASS |
| OPS-07 | `test/integration/openapi.test.ts:128-164,390-475` — parsed version equals `1.2.0`, exact route parity includes all four RAG operations, Bearer security/request/response/status/header schemas match and prohibited fields are absent. | PASS |
| OPS-08 | `test/evaluation/rag-retrieval.test.ts:792-811` — fixture version is exact, `DOCUMENTS` length/unique count are 12, `QRELS`/normalized qrels length are 48, group counts and every SHA/range are valid. | PASS |
| OPS-09 | `test/evaluation/rag-retrieval.test.ts:823-863` — all three runs assert Recall@5 >=.90, MRR@10 >=.80, nDCG@10 >=.85, exact/numeric Recall@3 >=.95, semantic >=.85, typo >=.80, 8/8 correct disambiguation top-1, identical IDs/ranks, and zero network calls. Observed hybrid values were 0.9791666667 / 0.8833333333 / 0.9074850862. | PASS |
| OPS-10 | Static assertions at `test/unit/container-contract.test.ts:176-182` only confirm CI text includes two `push:false` builds. GitHub runs 33042513294 and 33042563567 both ended `startup_failure`, `path=BuildFailed`, with zero jobs, so no image ran. Further, `.models/` is ignored (`.gitignore:5`), while CI runs `npm ci` then `npm run check` without model fetch (`.github/workflows/ci.yml:26-29`); a clean HEAD worktree reproduced 2/2 `RAG_MODEL_UNAVAILABLE` failures in `test/integration/local-e5-encoder.test.ts`. Linux container build/smoke and current dependency-audit outcomes are evidence-zero. | **FAIL** |

**Acceptance status:** 48/52 matched; 4 gaps; 0 spec-precision gaps.

---

## Explicit Edge Cases

| Edge | `file:line` + assertion expression and exact outcome | Result |
| --- | --- | --- |
| EDGE-01 | `test/integration/rag-routes.test.ts:283-304` — malformed unauthenticated requests return exact 401/`WWW-Authenticate: Bearer` and every coordinator method remains uncalled. | PASS |
| EDGE-02 | `test/integration/artifact-snapshot-lock.test.ts:56-65` — expiry waits behind source artifact lock and outcome is one complete verified snapshot or exact post-expiry error, never dangling work. | PASS |
| EDGE-03 | `test/unit/rag-ingestion-worker.test.ts:445-474` — consistent precommit work becomes queued; impossible mixed state rejects exact `RAG_STORAGE_UNAVAILABLE`; staging is never exposed. | PASS |
| EDGE-04 | `test/unit/rag-ingestion-worker.test.ts:399-418,427-442` — postcommit recovery leaves one active version, performs zero re-embedding, and completes ingestion metadata. | PASS |
| EDGE-05 | `test/integration/lancedb-rag-index.test.ts:244-271` — smaller replacement reports changed rows >=2 and exact new count 1 while unrelated document remains; no surplus old chunks survive. | PASS |
| EDGE-06 | `test/unit/rag-chunker.test.ts:239-251` — whitespace is covered exactly, every produced text is nonempty after trim, and all-whitespace rejects exact `RAG_SOURCE_UNAVAILABLE`. | PASS |
| EDGE-07 | `test/integration/lancedb-rag-index.test.ts:336-366` — fingerprint/dimension mismatch rejects fixed storage error; restoring manifest exposes the original two chunks without rebuild. | PASS |
| EDGE-08 | `test/integration/lancedb-rag-index.test.ts:486-501` — mutation never executes during optimize and post-operation chunk IDs equal pre-operation IDs. This proves serialization/preservation, though the production trigger is separately missing under OPS-05. | PASS |
| EDGE-09 | `test/unit/rag-ingestion-worker.test.ts:307-349` covers source/embedding/snapshot failures, but no assertion injects ENOSPC/free-space exhaustion after admission, verifies bounded staging cleanup, and then checks `/ready`. In the publication-fatal branch, the OPS-04 wiring leaves coordinator readiness true. Required exact outcome is absent and partially contradicted. | **FAIL** |
| EDGE-10 | `test/unit/rag-chunker.test.ts:221-229` — coarse Muse chunk retains `{startSeconds:7,endSeconds:null}` and `timestampPrecision === "chunk"`; no interpolated segment precision. | PASS |

**Edge status:** 9/10 matched; EDGE-09 uncovered/contradicted.

---

## Gate Check and Test Integrity

| Gate | Exact result |
| --- | --- |
| `npm run check` | Exit 0: Biome checked 102 files; strict TypeScript passed; Vitest 57 files / 724 tests passed; production TypeScript build passed. |
| `npm run test:rag:offline` | Exit 0: 6 files / 30 tests passed; 12 documents / 48 qrels; three-run determinism and zero-network assertions passed. |
| Baseline at `4143edc` | Detached clean worktree: 30 files / 436 tests passed. Current delta is +288 tests. |
| Skips | 0 real gate skips. No `.skip`, `.todo`, `xit`, `xtest`, or `xdescribe` syntax. Filter-induced nonselected tests in sensor runs were not counted as gate skips. |
| Assertion integrity | No behavioral assertion weakening/removal found in `4143edc..HEAD`; removed expectations were mechanical OpenAPI 1.1→1.2, Docker-stage, or renamed metric-family updates. |
| Relevant static contracts | Container + Railway tests: 14/14 passed; CI YAML parses locally with the locked `yaml` package. The `actionlint` binary was unavailable locally; the supplied actionlint-valid result is accepted only as static syntax evidence. |
| Dependencies | Installed tree resolves LanceDB 0.37.1, Transformers 4.2.0, Arrow 18.1.0, ONNX Runtime 1.24.3, `adm-zip` 0.6.0 and `sharp` 0.35.4. |
| Dependency audit | Not rerun because external network was forbidden except read-only CI queries. Current audit outcome is evidence-zero, not PASS. |
| Container runtime | Docker, Podman, Buildah, Nerdctl and Finch are unavailable locally. No real image-build claim is made. |

### LanceDB scoring warnings

The offline gate emitted 601 forward-compatibility warnings: 299 for `_distance` and 302 for
`_score`. `src/infrastructure/rag/lancedb-rag-index.ts:765-772` selects only public columns and then
reads `_distance`; `:791-798` does the same for `_score`. LanceDB 0.37.1 still auto-projects them, so
current search assertions pass. The warning says this behavior will stop: absent `_distance` becomes
`NaN`, which `toCandidate` turns into fixed storage failure; absent `_score` silently uses rank
fallback and can change FTS ordering. This is not a current SEARCH failure, but it is a concrete
future-functional risk and warning flood.

### GitHub Actions and image evidence

- [Run 33042513294](https://github.com/tadeumx1/transcript-youtube-videos-api/actions/runs/33042513294),
  commit `9bb0f71...`: completed `startup_failure`, `path=BuildFailed`, zero jobs.
- [Run 33042563567](https://github.com/tadeumx1/transcript-youtube-videos-api/actions/runs/33042563567),
  commit `a10c357...`: completed `startup_failure`, `path=BuildFailed`, zero jobs.
- Workflow `CI` (`.github/workflows/ci.yml`, GitHub workflow id 343490888) is active and its supplied
  actionlint result/YAML/static contract is valid, but action validity is not execution evidence.
  Neither source checks nor `rag-smoke` nor the production image build started.
- Clean-checkout proof: a detached HEAD worktree with no ignored `.models` ran the real local-encoder
  integration file and failed 2/2 with `RAG_MODEL_UNAVAILABLE`. CI has no fetch/cache step before
  `npm run check`, so it remains non-hermetic even after the platform startup failure is repaired.

---

## P0 Discrimination Sensor

All mutations were applied one at a time in isolated detached worktree
`/tmp/rag-verifier-sensor.cXLwxQ`, with read-only-equivalent symlinks to the existing dependencies and
model. Each patch was reversed before the next mutation. The scratch diff was empty before removal;
the real-tree porcelain remained empty. No stash was used.

| ID | Required risk | Semantic mutation | Exact killing assertion/outcome | Result |
| --- | --- | --- | --- | --- |
| M01 | Authentication | Removed `onRequest: authenticate` from RAG search POST | `test/integration/rag-routes.test.ts:299` expected 401, mutant returned 400 | KILLED |
| M02 | Persistence/atomicity | Removed `whenNotMatchedBySourceDelete(...)` from Lance replacement | `test/integration/lancedb-rag-index.test.ts:244` smaller replacement failed with `RAG_STORAGE_UNAVAILABLE` instead of committing the exact replacement | KILLED |
| M03 | Retrieval/fusion | Reversed the stable tie comparator | `test/unit/rag-search-service.test.ts:176` expected chunk order `[1,2,3]`, mutant returned `[2,1,3]` | KILLED |
| M04 | Lifecycle/readiness | Removed `ragCoordinator.isReady` from `/ready` condition | `test/integration/rag-http-app.test.ts:222` expected 503, mutant returned 200 | KILLED |
| M05 | Model/path integrity | Bypassed model SHA-256 comparison | `test/unit/model-manifest.test.ts:224` expected wrong-SHA rejection; five cases resolved instead | KILLED |

**Sensor:** 5 injected, 5 killed, 0 survived — PASS. The sensor demonstrates discrimination for
implemented behaviors; it cannot manufacture missing post-start-fatal, telemetry, lifecycle, CI,
or post-admission ENOSPC evidence.

---

## Coding Principles and Repository Guidance

| Principle | Status | Evidence |
| --- | --- | --- |
| Surgical scope / no scope creep | PASS | Diff is confined to the approved RAG implementation, config/IaC/container/docs, spec artifacts and tests. No remote mutation occurred. |
| Existing style and quality gates | PASS | Biome, strict TypeScript, build and 724 tests pass; package/README/Vitest conventions are followed. |
| Spec-anchored outcomes | FAIL | 4/52 ACs and EDGE-09 do not have the required production/test outcome. |
| Per-layer coverage | PARTIAL | Domain, filesystem, real LanceDB, model, HTTP, OpenAPI and evaluation are strong; fatal lifecycle, operational telemetry, source-retention independence and post-admission disk degradation are missing. |
| Test integrity | PASS | +288 tests versus baseline, zero real skips, no weakened behavioral assertions. |
| Atomic task protocol | PASS | 28/28 task commits map one-to-one and all Conventional Commit subjects validate. |
| Runtime/container truthfulness | FAIL | Static Docker/CI text passes, but both remote runs executed zero jobs and no local container engine exists. |
| Dependency hygiene | PARTIAL | Exact dependency tree is pinned/resolved; current network-backed audit and real Linux image evidence are zero. |

---

## Ranked Gaps and Concrete Fix Plans

### P0 — Fatal RAG worker does not invalidate service readiness (OPS-04, EDGE-09)

**Gap:** the worker owns the fatal condition, but its callback cannot change the coordinator's
private readiness flag. Search admission is disabled; `/ready` can still be 200 and submit/get/delete
remain exposed through a coordinator whose only worker has exited.

**Fix plan:**

1. Add a coordinator-owned degradation transition invoked by the worker-fatal callback; atomically
   set coordinator readiness false, mark admission unavailable, and set fixed component health.
2. Define whether recovery requires process restart or creates a new worker loop. The current worker
   retains its fatal/loop state, so do not claim in-place recovery without resetting all invariants.
3. Add a composed integration test that starts fully ready, injects a real loop fatal after startup,
   and asserts exact `/ready` 503 body, fixed sanitized errors for every RAG content operation,
   `/health` 200, and unchanged transcript/job handler contracts.
4. Inject ENOSPC after admission at snapshot/staging/publication boundaries; assert fixed failure,
   prior-version preservation, bounded staging cleanup, and readiness false.

### P0 — Metrics and maintenance are declarations, not operational telemetry (OPS-05)

**Gap:** most families are populated only by the unit test. There is no automatic optimize trigger;
the only `optimize()` invocation is a test. This contradicts the designed 20-mutation/100,000-row
maintenance threshold and leaves reconcile/sweep/optimize/delete outcomes unobservable.

**Fix plan:**

1. Inject narrow metrics ports into coordinator, worker, search service and index/lifecycle paths.
   Record submission disposition, current ingestion states, duration/failure, active docs/chunks,
   repository/index/model/worker health, all search terminal outcomes/duration/result count, and
   maintenance outcomes on real success, failure and abort paths.
2. Maintain durable/serialized successful-mutation and changed-row counters. Trigger optimize after
   20 successful mutations or 100,000 changed rows, serialize it with publication/delete, and only
   reset counters after successful maintenance.
3. Add composition tests that perform real submit/process/search/delete/sweep/reconcile/optimize,
   scrape `/metrics`, and assert exact counter/gauge deltas without directly calling metric methods.
4. Add failure/abort tests proving fixed labels and no dynamic content/identifiers.

### P1 — CI/container gate has zero execution evidence and clean checkout lacks the model (OPS-10)

**Gap:** both requested runs stopped before job creation, and the source job's ignored-model
dependency is reproducibly missing. A valid action file and static Docker tests cannot satisfy a real
Linux smoke/build or dependency audit.

**Fix plan:**

1. Diagnose and repair the repository/account-level GitHub Actions `startup_failure` outside this
   verifier; rerun until jobs actually start.
2. Make source gates hermetic: fetch the immutable manifest-verified model before model-dependent
   tests, restore it from a keyed cache, or split offline-model checks into a job/stage that builds
   the pinned assets. Never weaken the real-model tests.
3. Run and retain successful `npm run check`, `npm run test:rag:offline`, `npm audit --omit=dev`,
   `rag-smoke` target build/run, and production image build logs on Linux with network denial where
   specified.
4. Revalidate non-root execution, runtime-only x64 ORT assets, model hashes and reported image/RSS/
   index sizes from the built image.

### P1 — Source-artifact independence is unproved (LIFE-04)

**Gap:** the only related assertion says repeated DELETE does not call source access. It does not
compare real source records/artifact bytes or prove the active RAG copy remains searchable after
source expiry.

**Fix plan:**

1. Use a real durable artifact store plus real RAG repository/index: ingest, hash/snapshot the source
   job record, transcript JSON and PDF bytes, then replace/delete RAG and assert every source byte and
   record is unchanged.
2. Independently expire/sweep the source artifact while retaining the active RAG document; search
   and assert exact text plus all stored provenance fields still match the pre-expiry result.
3. Fix only the boundary exposed if the end-to-end test fails; do not couple RAG lifecycle back to
   source deletion/retention.

### P1 — LanceDB score metadata relies on deprecated auto-projection

**Gap:** 601 warnings show `_distance`/`_score` are consumed without explicit projection. Current
0.37.1 behavior passes, but a future LanceDB changes vector failure semantics and lexical ranking.

**Fix plan:** explicitly select/project the score metadata using the supported LanceDB API, add a
test with legacy auto-projection disabled (or the next compatible version), assert finite vector/FTS
scores and stable ranks, and require the offline gate to emit zero such warnings.

### P2 — Traceability artifacts are stale

After implementation fixes and independent revalidation, update the 32 stale requirement rows,
7 goal boxes, and inconsistent heading suffixes through the authorized spec workflow. Do not mark a
failed AC Verified merely because its task checkbox is complete.

---

## Closing Gate

**Overall:** NOT READY.

- ACs: **48/52 matched**; failures: LIFE-04, OPS-04, OPS-05, OPS-10.
- Edge cases: **9/10 matched**; failure: EDGE-09.
- Local gate: **724 passed, 0 failed, 0 skipped**; baseline 436; delta +288.
- Offline RAG gate: **30 passed, 0 failed, 0 skipped**.
- Sensor: **5/5 killed**, 0 survived; worktree isolation preserved.
- Real CI/container build: **evidence-zero**; both runs were `startup_failure` with zero jobs.

Because the verdict is FAIL, `validate_state.py` was intentionally not run: the skill's closing gate
cannot accept this report or mark the feature complete. The verifier did not modify `spec.md`,
`tasks.md`, `STATE.md`, implementation, tests, or lessons. This validation produced actionable
signal, but the task explicitly authorized only `validation.md`, so no lesson file was written.
