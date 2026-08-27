# RAG-native LanceDB Ingestion Validation — Round 3 (final loop)

**Verdict:** FAIL
**Date:** 2026-08-27
**Spec:** .specs/features/rag-lancedb/spec.md
**HEAD:** e8c45c35348b17310ed45dbb7a5169a0751c809c
**Full diff:** 4143edc21cad4e02f771753c222f4d3aab4e4734..e8c45c35348b17310ed45dbb7a5169a0751c809c
**Round-3 diff:** ac78b4f1e48bf2e8fd0126a71ede580625d6e62f..e8c45c35348b17310ed45dbb7a5169a0751c809c
**T39 delta:** 4da731e1cb37f4ec4ca6c7ada5b75299d6ed26c9..e8c45c35348b17310ed45dbb7a5169a0751c809c
**Verifier:** /root/rag_reverifier_3, independent verifier (author != verifier)

The implementation matches **51 of 52** acceptance criteria and **10 of 10** explicit edge cases.
T35-T38 close the Railway parser, CI runtime-smoke, obsolete-stage, and Volume-region fixes. T39
closes the stale README/contract gap found during this round. The sole remaining failure is OPS-10:
GitHub run 33094772986 targets the exact HEAD, but Source checks started zero steps because the
account is locked for billing; Container build was skipped. The real Linux runtime-network-denied
smoke therefore remains evidence-zero.

## Verification Boundary and Tree Integrity

- The real-tree porcelain baseline was empty at 4da731e before gates and sensor work.
- The complete spec, context, design, tasks, prior validation, full feature diff, and T35-T39 delta
  were independently read. The full diff before this report is 77 files, 21,960 insertions, and 314
  deletions. T39 changes only README.md, its unit contract, and tasks.md.
- No stash, reset, code/test/task/spec/STATE edit, push, deploy, apply, restart, or remote mutation
  was performed by this verifier.
- Eight mutations ran one at a time in detached worktree /tmp/rag-r3-sensor.DEO6nU. Its tracked diff
  was empty before removal; the worktree was removed and pruned. Real-tree porcelain matched the
  original empty baseline afterward.
- After T39, the focused documentation gate and the complete Build gate passed with empty porcelain.
  The only intended real-tree change after this report is validation.md.

## Task Completion and Structural Gates

| Check | Exact result |
| --- | --- |
| Tasks | 39 task headings; 170 Done-When boxes checked; exactly one unchecked box at tasks.md:1229. |
| T1-T33 | Complete with executable local evidence retained from the feature implementation. |
| T34 | **PARTIAL**: hermetic clean-checkout/static behavior is covered, but its explicit green GitHub source/audit/runtime-smoke/production-image checkbox remains unchecked. |
| T35-T38 | Complete: Railway Docker parsing, single production-image runtime smoke contract, obsolete stage removal, and sfo Volume declaration. |
| T39 | Complete: README.md:536-537 builds the production image once and runs the packaged smoke with Docker network disabled; test/unit/rag-readme-contract.test.ts:103-115 requires the exact command and rejects the removed target. |
| Atomic commits | All 44 subjects in the full range passed check_commit.py; T39 is e8c45c3 docs(rag): document runtime container smoke. |
| Spec validator | validate_spec.py --strict rag-lancedb: 0 errors, 0 warnings. |
| Tasks validator | validate_tasks.py --strict rag-lancedb: 0 errors, 0 warnings. |
| Diff hygiene | git diff --check passed for the feature and T39 ranges. |

## Spec-Anchored Acceptance Criteria

Each PASS cites an assertion of the spec-defined value or state. Static/mock evidence is not used to
replace the missing OPS-10 remote execution conjunct.

### Ingestion

| AC | file:line + asserted outcome | Result |
| --- | --- | --- |
| ING-01 | test/integration/rag-routes.test.ts:164-181 asserts 202, exact Location, Retry-After 2, exact eight fields, and relative links. | PASS |
| ING-02 | test/unit/file-rag-repository.test.ts:125-153 asserts snapshot sync/publication precedes queued-record persistence and restart reads the verified snapshot. | PASS |
| ING-03 | test/unit/rag-ingestion-worker.test.ts:397-429 asserts recovery reads only the snapshot and batches locally; test/integration/local-e5-encoder.test.ts:37 asserts zero fetch. | PASS |
| ING-04 | test/integration/rag-routes.test.ts:185-200 asserts all retained states and the fixed allowlisted failed resource. | PASS |
| ING-05 | test/unit/durable-job-coordinator.test.ts:540-590 asserts every exact JOB_* mapping and zero downstream creation for ineligible sources. | PASS |
| ING-06 | test/unit/rag-ingestion-coordinator.test.ts:733-762 asserts exact 404 RAG_INGESTION_NOT_FOUND and 410 RAG_INGESTION_EXPIRED. | PASS |
| ING-07 | test/unit/rag-ingestion-coordinator.test.ts:637-654 asserts reconcile/recover/single-worker start precede readiness. | PASS |
| ING-08 | test/unit/rag-ingestion-worker.test.ts:377-394 and test/unit/rag-ingestion-coordinator.test.ts:780-798 assert readiness/claims stop first and batch-boundary work remains recoverable. | PASS |

### Versioning and publication

| AC | file:line + asserted outcome | Result |
| --- | --- | --- |
| VER-01 | test/unit/rag-domain.test.ts:77-151 independently recomputes canonical SHA-256 identities and asserts every frozen version input. | PASS |
| VER-02 | test/unit/rag-ingestion-coordinator.test.ts:443-472 asserts one miss, joined callers with identical IDs, one record, and one execution notification. | PASS |
| VER-03 | test/unit/rag-ingestion-coordinator.test.ts:497-535 asserts retained/fresh completed hits preserve identities with zero snapshot/capacity/worker/index mutation. | PASS |
| VER-04 | test/unit/rag-ingestion-coordinator.test.ts:539-558 asserts exact 409 and Retry-After 2 before work. | PASS |
| VER-05 | test/unit/rag-ingestion-worker.test.ts:432-479 and test/integration/rag-search-service.test.ts:132-179 assert prior version preservation and complete old-then-new visibility. | PASS |
| VER-06 | test/integration/lancedb-rag-index.test.ts:242-289 asserts exact replacement counts, surplus removal, unrelated preservation, and no mixed version. | PASS |
| VER-07 | test/unit/rag-ingestion-worker.test.ts:432-479 asserts fixed failure reasons, invisible staging, and unchanged prior version at every prepublication boundary. | PASS |
| VER-08 | test/unit/rag-ingestion-worker.test.ts:397-429,483-502 and test/unit/file-rag-repository.test.ts:266-290 assert deterministic local recovery, postcommit completion, and duplicate-owner collapse. | PASS |

### Chunking and embeddings

| AC | file:line + asserted outcome | Result |
| --- | --- | --- |
| CHUNK-01 | test/unit/rag-chunker.test.ts:104-152 asserts two equal runs and exact ordered core reconstruction. | PASS |
| CHUNK-02 | test/unit/rag-chunker.test.ts:196-229 asserts preferred segment boundaries and deterministic Unicode-safe splitting without loss/reorder. | PASS |
| CHUNK-03 | test/unit/rag-chunker.test.ts:155-193 asserts passage inputs <=320 tokens, overlap <=48, and exact 319/320/321 plus 511/512/513 behavior. | PASS |
| CHUNK-04 | test/unit/rag-chunker.test.ts:104-152 asserts ID/checksum, ordinal/count, every half-open range, nullable seconds, and source precision. | PASS |
| CHUNK-05 | test/unit/rag-chunker.test.ts:123-149 asserts the complete source/job/artifact/cache/checksum/schema/chunk/model provenance payload. | PASS |
| CHUNK-06 | test/unit/rag-chunker.test.ts:267-287 asserts both exact limits pass, +1 rejects RAG_SOURCE_TOO_LARGE, and no publication occurs. | PASS |
| EMB-01 | test/unit/model-manifest.test.ts:90-113,149-226 asserts exact model/revision/dtype/dimension and five artifact hashes; missing/extra/mismatch fail closed. | PASS |
| EMB-02 | test/unit/local-e5-encoder.test.ts:61-104 asserts local-only flags, exact prefixes, mean pooling, and normalization; real integration asserts zero fetch. | PASS |
| EMB-03 | test/integration/local-e5-encoder.test.ts:39-45 asserts 384 finite unit-norm values; unit tests map dimension/value/norm faults to fixed failure. | PASS |
| EMB-04 | test/unit/rag-ingestion-worker.test.ts:397-429 and test/unit/rag-encoder-scheduler.test.ts:60-109 assert batch <=8, one permit, and bounded inter-batch fairness. | PASS |

### Search

| AC | file:line + asserted outcome | Result |
| --- | --- | --- |
| SEARCH-01 | test/integration/rag-routes.test.ts:262-280 and test/unit/rag-search-service.test.ts:122-140 assert strict query/topK/filter bounds before encoder/index access. | PASS |
| SEARCH-02 | test/unit/rag-search-service.test.ts:161-200 asserts exact 1/(60+rank), 50+50 backend limits, <=100 unique fusion, and <=topK active results. | PASS |
| SEARCH-03 | test/unit/rag-search-service.test.ts:161-200 and test/integration/rag-search-service.test.ts:94-129 assert exact tie order and identical IDs/order over three runs. | PASS |
| SEARCH-04 | test/unit/rag-search-service.test.ts:202-255 asserts exact finite public result/provenance while query, vector, path, publication, and overlap internals are absent. | PASS |
| SEARCH-05 | test/integration/rag-search-service.test.ts:94-129 asserts empty index/filter and unknown/deleted filter all equal results: []. | PASS |
| SEARCH-06 | test/unit/rag-search-service.test.ts:143-158 asserts fifth search rejects exact 429/code/Retry-After 5 before encoder/index. | PASS |
| SEARCH-07 | test/integration/lancedb-rag-index.test.ts:414-445 asserts fingerprint/dimension mismatch fails fixed and preserves rows; model faults do not rebuild/fallback. | PASS |
| SEARCH-08 | test/unit/rag-encoder-scheduler.test.ts:60-109 asserts the four-search fairness bound without interrupting an in-flight batch or duplicating the encoder. | PASS |

### Lifecycle and capacity

| AC | file:line + asserted outcome | Result |
| --- | --- | --- |
| LIFE-01 | test/integration/rag-routes.test.ts:223-234 asserts exact 204/empty body; test/integration/lancedb-rag-index.test.ts:373-385 asserts immediate vector/FTS/hybrid absence. | PASS |
| LIFE-02 | test/unit/rag-ingestion-coordinator.test.ts:606-633 and test/integration/rag-routes.test.ts:237-258 assert exact 404 and malformed-ID rejection before storage. | PASS |
| LIFE-03 | test/integration/rag-search-service.test.ts:132-209 and test/unit/rag-ingestion-worker.test.ts:542-558 assert one serializable old/new/deleted outcome and no resurrection. | PASS |
| LIFE-04 | test/integration/rag-lifecycle-independence.test.ts:258-336 hashes real source job/transcript/PDF bytes, proves replace/delete do not mutate them, and proves exact post-expiry RAG text/provenance with zero provider calls. | PASS |
| LIFE-05 | test/unit/rag-readme-contract.test.ts:118-130 requires immediate logical removal plus fragment/backup/compaction/retention language and rejects secure-erase claims. | PASS |
| LIFE-06 | test/unit/file-rag-repository.test.ts:240-263 asserts terminal metadata -> content-free 24h tombstone -> removal independently of documents. | PASS |
| CAP-01 | test/unit/file-rag-repository.test.ts:293-307 and test/unit/rag-ingestion-coordinator.test.ts:559-581 assert the exact 134,217,728-byte boundary and 507 before miss work while non-miss operations remain callable. | PASS |
| CAP-02 | test/unit/rag-ingestion-coordinator.test.ts:539-581 asserts 25 queued rejects exact 429/Retry-After 30 before record creation while joined/hit bypass it. | PASS |

### Operations and evidence

| AC | file:line + asserted outcome | Result |
| --- | --- | --- |
| OPS-01 | test/unit/config.test.ts:70-132 asserts all exact defaults and inclusive bounds with variable-name-only failures. | PASS |
| OPS-02 | test/unit/railway-contract.test.ts:21-82 asserts one replica, 1024 MB sfo Volume at /data, exact roots, packaged model, preserved secrets, and no prohibited resource/secret. Railway plan independently returned exit 0 and no drift. | PASS |
| OPS-03 | test/integration/application-composition.test.ts:169-203 and test/unit/rag-ingestion-coordinator.test.ts:637-654 assert storage/index/model warmup, reconciliation, and workers before readiness; production health/ready both returned 200. | PASS |
| OPS-04 | test/unit/rag-ingestion-coordinator.test.ts:691-730 and test/integration/rag-http-app.test.ts:349-419 assert fatal degradation, exact ready/RAG 503, health/transcript continuity, one recovery, and no post-stop resurrection. | PASS |
| OPS-05 | test/integration/application-composition.test.ts:499-539, test/unit/rag-ingestion-coordinator.test.ts:355-439, and test/unit/runtime-metrics.test.ts:217-246 assert real operation deltas, all maintenance outcomes, exact 23 families, and no dynamic-content leakage. | PASS |
| OPS-06 | test/unit/rag-domain.test.ts:369-385 and test/unit/runtime-metrics.test.ts:217-246 assert fixed code/status/message and absence of causes, credentials, URLs, paths, IDs, query, and content. | PASS |
| OPS-07 | test/integration/openapi.test.ts:125-167,383-475 asserts OpenAPI 1.2.0, all four strict Bearer operations, every header/status/error, and legacy parity. | PASS |
| OPS-08 | test/evaluation/rag-retrieval.test.ts:792-811 asserts fixture/version, 12 unique documents, 48 ranged qrels, and exact category counts. | PASS |
| OPS-09 | test/evaluation/rag-retrieval.test.ts:823-863 asserts every global/subgroup threshold, 8/8 disambiguation top-1, identical three-run IDs/ranks, and zero network. Observed hybrid Recall@5/MRR@10/nDCG@10 = 0.9791667/0.8833333/0.9074851. | PASS |
| OPS-10 | .github/workflows/ci.yml:27-72 statically includes check, offline, audit, one loaded production image, and docker run --network none; test/unit/ci-contract.test.ts:93-119 and test/unit/container-contract.test.ts:145-188 assert it. README.md:536-564 now matches. However exact-HEAD GitHub run 33094772986 executed zero Source steps because of the billing lock and skipped Container build. No real GitHub/Linux runtime smoke ran. | **FAIL** |

**Acceptance status:** **51/52 matched**; one external execution gap; zero spec-precision gaps.

## Explicit Edge Cases

| Edge | file:line + asserted outcome | Result |
| --- | --- | --- |
| EDGE-01 | test/integration/rag-routes.test.ts:283-305 asserts malformed unauthenticated requests return 401/Bearer before every dependency. | PASS |
| EDGE-02 | test/integration/artifact-snapshot-lock.test.ts:32-65 asserts expiry yields one complete snapshot or exact post-expiry error, never a dangling reference. | PASS |
| EDGE-03 | test/unit/rag-ingestion-worker.test.ts:659-688 asserts precommit/mixed crash staging stays invisible and retries/fails without retranscription. | PASS |
| EDGE-04 | test/unit/rag-ingestion-worker.test.ts:561-586,635-656 asserts exact active state completes metadata with zero re-embedding/republication. | PASS |
| EDGE-05 | test/integration/lancedb-rag-index.test.ts:242-289 asserts a smaller replacement removes every surplus old row while preserving unrelated rows. | PASS |
| EDGE-06 | test/unit/rag-chunker.test.ts:233-251 asserts whitespace coverage/attachment and all-empty RAG_SOURCE_UNAVAILABLE without empty/NaN vectors. | PASS |
| EDGE-07 | test/integration/lancedb-rag-index.test.ts:414-445 asserts fingerprint/dimension mismatch fails closed and leaves prior rows unchanged. | PASS |
| EDGE-08 | test/unit/rag-ingestion-worker.test.ts:285-374 and test/integration/lancedb-rag-index.test.ts:522-586 assert exact optimize thresholds, write serialization, success-only reset, safe options, and preserved active results. | PASS |
| EDGE-09 | test/unit/rag-ingestion-worker.test.ts:505-539,589-632, test/unit/rag-ingestion-coordinator.test.ts:585-602, and test/integration/rag-http-app.test.ts:349-419 assert post-admission storage failure, cleanup/prior-version preservation, readiness failure, and recovery. | PASS |
| EDGE-10 | test/unit/rag-chunker.test.ts:209-229 asserts nullable/coarse Muse timestamps remain exact without interpolation. | PASS |

**Edge status:** **10/10 matched**.

## T35-T39 Closure

| Task | Independent outcome |
| --- | --- |
| T35 | Dockerfile contains no Railway-unsupported RUN --network=none; focused contracts pass; Railway built the resulting image successfully. |
| T36 | CI builds/loads exactly one production image and runs its packaged smoke with docker run --network none; 14 focused CI/container tests passed. Remote execution remains pending under T34/OPS-10. |
| T37 | Dockerfile has no rag-smoke build stage, still packages rag-container-smoke.mjs, and retains the final runtime/non-root/data/model contracts. |
| T38 | .railway/railway.ts:23 declares region sfo and sizeMB 1024; the contract passed 2/2 and the read-only production plan has zero drift. |
| T39 | The pre-fix stale README command was confirmed. HEAD now documents one production build plus runtime-isolated smoke; 5/5 focused tests and the full 738-test gate pass. |

## Gate Check and Test Integrity

| Gate | Exact result |
| --- | --- |
| npm run check at HEAD | Exit 0: Biome 103 files; strict TypeScript; Vitest **58 files / 738 tests passed**; production build passed. |
| npm run test:rag:offline | Exit 0: **7 files / 31 tests passed**; 12 documents/48 qrels; deterministic retrieval and runtime network denial passed; no score auto-projection warning appeared. |
| T39 focused | test/unit/rag-readme-contract.test.ts: **5/5 passed**. |
| Baseline | 4143edc detached baseline had 436 tests. Current delta is **+302**, with no count regression. |
| Skips | **0** real skips; no skip/todo/only/xit/xtest/xdescribe syntax found. |
| Dependency audit | npm audit --omit=dev: **0 vulnerabilities**. |
| Structural | Spec 0/0; tasks 0/0; 44/44 commit subjects valid. |
| Local container runtime | Docker, Podman, Buildah, Nerdctl, and Finch are unavailable; no local image execution is claimed. |

## P0 Discrimination Sensor

Eight behavior-level mutations were injected one at a time in the isolated detached worktree. All
were killed by outcome assertions. No stash was used.

| ID | Risk / mutation | Killing assertion | Result |
| --- | --- | --- | --- |
| M01 | Chunk model-token limit 320 -> 321 | test/unit/rag-chunker.test.ts:164 expected <=320 and received 321; four cases failed. | KILLED |
| M02 | RRF constant 60 -> 61 | test/unit/rag-search-service.test.ts:216 exact result/score mismatched; two cases failed. | KILLED |
| M03 | Metrics allowlist returned raw untrusted value | test/unit/runtime-metrics.test.ts:232 expected unknown and content absence; two privacy cases failed. | KILLED |
| M04 | Optimize mutation threshold 20 -> 21 | test/unit/rag-ingestion-worker.test.ts:386 expected a waiting writer at the exact threshold; four cases failed. | KILLED |
| M05 | Removed Docker --network none from CI smoke | test/unit/ci-contract.test.ts and test/unit/container-contract.test.ts:181 rejected the command; two cases failed. | KILLED |
| M06 | Railway Volume region sfo -> iad | test/unit/railway-contract.test.ts:28 exact service/Volume conjunction failed. | KILLED |
| M07 | Removed packaged smoke script from Dockerfile | test/unit/container-contract.test.ts:148 required the exact COPY; one case failed. | KILLED |
| M08 | Removed auth hook from RAG search | test/integration/rag-routes.test.ts:299 expected 401/Bearer and received validation 400; one case failed. | KILLED |

**Sensor:** **8 injected, 8 killed, 0 survived — PASS.**

## GitHub CI Evidence

- Public GitHub API confirms run **33094772986** is the push run for exact HEAD
  e8c45c35348b17310ed45dbb7a5169a0751c809c and concluded failure.
- Source checks job **98596680486** has zero steps. Its sole failure annotation is:
  “The job was not started because your account is locked due to a billing issue.”
- Container build job **98596699046** is skipped with zero steps.
- Therefore source, audit, production-image build, model verification, and runtime network-denied
  smoke are not remote PASS evidence. Static/local green evidence cannot substitute for this
  conjunct.

## Railway Production and UAT Evidence

Read-only CLI/API checks were scoped to the linked production project/service. No secret value was
printed; variable output was filtered to the two non-secret storage roots.

| Check | Observed result |
| --- | --- |
| Deployment | Active deployment 15d6b998-29db-458f-a3cf-ba849cfd4f21 is terminal SUCCESS with image sha256:de8e36042b8e3b5141ccf46ab9ce300d4a8836c04223f436da2d85a75a5ad5b8 and Volume mount /data. Its implementation tree is 4da731e; current HEAD changes docs/test/tasks only. |
| Topology / roots | One running replica in sfo; 1024 MB READY Volume; DATA_ROOT=/data/transcripts and RAG_DATA_ROOT=/data/lancedb. |
| IaC drift | railway config plan --detailed-exit-code returned 0: configuration already up to date. |
| Health/auth probe | health 200, ready 200; unauthenticated metrics/RAG/transcripts 401; authenticated metrics 200 with 23 families; authenticated RAG search 200; authenticated invalid transcript 400. |
| Restart/Volume | Railway logs show /data remounted, shutdown/start, then health and readiness 200. The operator recorded canary SHA 7d57ba...a56 unchanged after restart and removed it; because cleanup was complete, the historical hash is UAT evidence rather than a currently reproducible file. |
| Real transcript UAT | Operator captured transcript 200 (7,403 bytes; youtube_captions; pt-BR; isGenerated false; caption precision; 60 segments) and PDF 200/application-pdf (Content-Disposition, 3,070 bytes, %PDF- magic). HTTP logs independently corroborate both 200 route calls without content logging. |
| Real job/RAG UAT | POST job 202 hit -> completed; ingestion 202 miss -> completed; filtered search 200 with two results from the document; DELETE 204; post-delete search 200 with zero results. Railway HTTP logs corroborate the 202/200/204/200 route sequence. |

Railway proves the production image can build, start, persist data, and serve the API. It does **not**
replace OPS-10's required GitHub/Linux runtime smoke under explicit network denial.

## Code Quality

| Principle | Status | Evidence |
| --- | --- | --- |
| Surgical scope | PASS | T35-T39 touch only their approved Docker/CI/IaC/docs contracts and task evidence; T39 has no runtime diff. |
| Spec-anchored outcomes | PASS | 51 PASS criteria cite exact values/states; OPS-10 is not promoted from static evidence. |
| Test integrity | PASS | 738 tests, +302 from baseline, zero skips, 8/8 mutants killed, no weakened behavioral assertion found. |
| Payload/conjunction rule | PASS | Route, provenance, metrics, Railway Volume, CI command, and T39 documentation checks assert complete conjunctions. |
| Runtime truthfulness | FAIL | Exact-HEAD GitHub jobs did not execute. |

## Ranked Gap and External Fix Plan

### 1. Release blocker / P1 — OPS-10 exact-HEAD GitHub/Linux execution

**Gap:** the workflow and documentation are now internally consistent and all local/static gates are
green. GitHub prevented Source checks from starting because of an account billing lock, then skipped
Container build. Consequently the required source/audit/production-image/runtime-network-denied
execution remains evidence-zero. T34's final checkbox stays open.

**External fix plan:**

1. The account owner resolves the GitHub billing/account lock without weakening the workflow.
2. Rerun ci.yml at e8c45c3 or a later content-equivalent commit.
3. Retain a run where Source checks executes and passes check 738 or later, offline RAG 31 or later,
   and audit 0; then Container build must build/load the production image and pass the packaged
   rag-container-smoke.mjs under docker run --network none.
4. A final evidence review closes OPS-10 and T34's remaining checkbox.

## Closing Gate

**Overall:** NOT READY solely because OPS-10's external GitHub/Linux execution did not start.

- Acceptance criteria: **51/52 matched**; only OPS-10 fails.
- Explicit edge cases: **10/10 matched**.
- Local current-HEAD gate: **738 passed, 0 failed, 0 skipped**.
- Offline RAG: **31 passed, 0 failed, 0 skipped**; audit: **0 vulnerabilities**.
- Sensor: **8/8 killed**.
- Railway deployment/runtime/UAT: operationally green, with the limitations stated above.
- Tasks: T1-T33 and T35-T39 complete; T34 partial by one intentionally unchecked remote checkbox.

Because the verdict is FAIL, validate_state.py was intentionally not run. No lesson artifact was
mutated: the only remaining signal is the already-known external GitHub billing/startup blocker, and
this verifier was authorized to rewrite validation.md only.
