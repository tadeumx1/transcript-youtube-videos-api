# RAG-native LanceDB Ingestion Validation — Post-T41 final verification

**Result:** PASS
**Date:** 2026-08-27
**Spec:** `.specs/features/rag-lancedb/spec.md`
**HEAD:** `3f85c6aafb217b8e17c562c476a7d714559b3c8e`
**Full diff:** `4143edc21cad4e02f771753c222f4d3aab4e4734..3f85c6aafb217b8e17c562c476a7d714559b3c8e`
**T41 delta:** `87fe16f4503f5a4185815270b93b4647effbe5b7..3f85c6aafb217b8e17c562c476a7d714559b3c8e`
**Verifier:** `/root/production_backlog_final_verifier`, independent sub-agent (author != verifier)

The implementation matches **52 of 52** acceptance criteria, **10 of 10** explicit edge cases, and
**10 of 10** production improvements. T41 replaces the CPU-ISA-sensitive signed INT8 model with the
immutable official UINT8 artifact, versions the embedding policy and RAG namespace, preserves the
prior namespace, and retains every retrieval threshold on local, GitHub x64, container, and Railway
execution.

## Verification Boundary and Tree Integrity

- The real-tree baseline was exactly this verifier-owned modified report. No source, test, task,
  spec, STATE, workflow, IaC, deployment, or production data was changed by this verifier.
- Mutations ran only in detached temporary worktrees. Both worktrees were removed and pruned. No
  stash, reset, push, deploy, apply, restart, or remote write ran.
- The final real-tree porcelain again contains only this report.
- All 49 commit subjects in the feature range pass `check_commit.py`; `git diff --check` passes.

## Task Completion and Structural Gates

| Check | Independent result |
| --- | --- |
| T1-T40 | Complete with retained executable evidence and prior independent sensors. |
| T41 | PASS: exact UINT8 model, policy v2, RAG namespace v2, green retrieval/CI/container/Railway/UAT, and five new behavior mutations killed. |
| Task artifact | 41 task headings; 176 checked Done-When boxes. The sole open box and pending header include this independent verification itself and are the orchestrator's post-verdict documentary closeout, not an implementation gap. |
| Spec validator | `validate_spec.py --strict rag-lancedb`: 0 errors, 0 warnings. |
| Tasks validator | `validate_tasks.py --strict rag-lancedb`: 0 errors, 0 warnings. |
| Other backlog features | Strict spec/tasks/state validators for `production-runtime-hardening` and `durable-transcript-jobs`: 0 errors, 0 warnings. |

## Spec-Anchored Acceptance Criteria

Every PASS below cites an assertion of the precise spec-defined outcome. There are zero
spec-precision gaps.

### Ingestion

| AC | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| ING-01 | `test/integration/rag-routes.test.ts:164-181` asserts 202, exact Location/Retry-After, eight fields, and relative links. | PASS |
| ING-02 | `test/unit/file-rag-repository.test.ts:125-153` asserts durable snapshot publication before queued persistence and verified restart read. | PASS |
| ING-03 | `test/unit/rag-ingestion-worker.test.ts:397-429` asserts snapshot-only local batching; `test/integration/local-e5-encoder.test.ts:22-47` asserts zero fetch. | PASS |
| ING-04 | `test/integration/rag-routes.test.ts:185-200` asserts every retained state and fixed failed resource. | PASS |
| ING-05 | `test/unit/durable-job-coordinator.test.ts:540-590` asserts every exact `JOB_*` mapping and zero downstream creation. | PASS |
| ING-06 | `test/unit/rag-ingestion-coordinator.test.ts:733-762` asserts exact 404/410 not-found/expired outcomes. | PASS |
| ING-07 | `test/unit/rag-ingestion-coordinator.test.ts:637-654` and `test/integration/rag-http-app.test.ts:429-442` assert ordered reconcile/recovery, one worker start, and no post-shutdown start. | PASS |
| ING-08 | `test/unit/rag-ingestion-worker.test.ts:377-394`, `test/unit/rag-ingestion-coordinator.test.ts:780-798`, and `test/integration/rag-http-app.test.ts:368-442` assert degraded/shutdown recovery boundaries. | PASS |

### Versioning and publication

| AC | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| VER-01 | `test/unit/rag-domain.test.ts:77-151` recomputes canonical SHA-256 identities and frozen version inputs. | PASS |
| VER-02 | `test/unit/rag-ingestion-coordinator.test.ts:443-472` asserts one miss, joined identical IDs, one record, and one notification. | PASS |
| VER-03 | `test/unit/rag-ingestion-coordinator.test.ts:497-535` asserts completed hits preserve IDs with zero mutation/work. | PASS |
| VER-04 | `test/unit/rag-ingestion-coordinator.test.ts:539-558` asserts exact 409/Retry-After before work. | PASS |
| VER-05 | `test/unit/rag-ingestion-worker.test.ts:432-479` and `test/integration/rag-search-service.test.ts:132-179` assert prior-version preservation and old-or-new visibility. | PASS |
| VER-06 | `test/integration/lancedb-rag-index.test.ts:242-289` asserts exact replacement counts, surplus removal, and no mixed version. | PASS |
| VER-07 | `test/unit/rag-ingestion-worker.test.ts:432-479` asserts invisible staging, fixed failures, and unchanged prior version. | PASS |
| VER-08 | `test/unit/rag-ingestion-worker.test.ts:397-429,483-502` and `test/unit/file-rag-repository.test.ts:266-290` assert deterministic recovery and duplicate collapse. | PASS |

### Chunking and embeddings

| AC | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| CHUNK-01 | `test/unit/rag-chunker.test.ts:104-152` asserts equal runs and exact ordered core reconstruction. | PASS |
| CHUNK-02 | `test/unit/rag-chunker.test.ts:196-229` asserts preferred boundaries and Unicode-safe lossless splitting. | PASS |
| CHUNK-03 | `test/unit/rag-chunker.test.ts:155-193` asserts <=320 tokens, <=48 overlap, and exact boundary fixtures. | PASS |
| CHUNK-04 | `test/unit/rag-chunker.test.ts:104-152` asserts IDs/checksums, ordinals, ranges, seconds, and precision. | PASS |
| CHUNK-05 | `test/unit/rag-chunker.test.ts:123-149` asserts complete source/job/artifact/schema/model provenance. | PASS |
| CHUNK-06 | `test/unit/rag-chunker.test.ts:267-287` asserts both exact limits and +1 `RAG_SOURCE_TOO_LARGE`. | PASS |
| EMB-01 | `test/unit/model-manifest.test.ts:90-135,149-226` asserts exact repository/revision, UINT8 artifact (`118054630` bytes; SHA-256 `ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1`), dtype, policy v2, fingerprint, and fail-closed integrity. | PASS |
| EMB-02 | `test/unit/local-e5-encoder.test.ts:61-104` asserts local-only UINT8, prefixes/mean/normalization; `test/integration/local-e5-encoder.test.ts:22-47` asserts zero network. | PASS |
| EMB-03 | `test/integration/local-e5-encoder.test.ts:39-46` asserts 384 finite unit-norm vectors and exact portable golden cosines `0.9059204`/`0.8040529`. | PASS |
| EMB-04 | `test/unit/rag-ingestion-worker.test.ts:397-429` and `test/unit/rag-encoder-scheduler.test.ts:60-109` assert batch <=8, one permit, and bounded fairness. | PASS |

### Search

| AC | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| SEARCH-01 | `test/integration/rag-routes.test.ts:262-280` and `test/unit/rag-search-service.test.ts:122-140` assert strict bounds before dependencies. | PASS |
| SEARCH-02 | `test/unit/rag-search-service.test.ts:161-200` asserts exact RRF, 50+50 limits, <=100 fusion, and <=topK. | PASS |
| SEARCH-03 | `test/unit/rag-search-service.test.ts:161-200` and `test/integration/rag-search-service.test.ts:94-129` assert deterministic ties and three-run IDs/order. | PASS |
| SEARCH-04 | `test/unit/rag-search-service.test.ts:202-255` asserts finite public result/provenance and absence of query/vector/path internals. | PASS |
| SEARCH-05 | `test/integration/rag-search-service.test.ts:94-129` asserts empty/unknown/deleted filters all return `results: []`. | PASS |
| SEARCH-06 | `test/unit/rag-search-service.test.ts:143-158` asserts exact fifth-search 429/code/Retry-After before dependencies. | PASS |
| SEARCH-07 | `test/integration/lancedb-rag-index.test.ts:414-445` asserts fingerprint/dimension mismatch fails closed and preserves rows; `test/unit/rag-storage-paths.test.ts:29-71` asserts isolated v2 paths. | PASS |
| SEARCH-08 | `test/unit/rag-encoder-scheduler.test.ts:60-109` asserts bounded search/ingestion fairness without duplicate encoder. | PASS |

### Lifecycle and capacity

| AC | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| LIFE-01 | `test/integration/rag-routes.test.ts:223-234` and `test/integration/lancedb-rag-index.test.ts:373-385` assert exact 204 and immediate search absence. | PASS |
| LIFE-02 | `test/unit/rag-ingestion-coordinator.test.ts:606-633` and `test/integration/rag-routes.test.ts:237-258` assert exact 404 and pre-storage ID validation. | PASS |
| LIFE-03 | `test/integration/rag-search-service.test.ts:132-209` and `test/unit/rag-ingestion-worker.test.ts:542-558` assert serializable old/new/deleted outcomes. | PASS |
| LIFE-04 | `test/integration/rag-lifecycle-independence.test.ts:258-336` proves source bytes unchanged and exact post-expiry RAG search. | PASS |
| LIFE-05 | `test/unit/rag-readme-contract.test.ts:118-130` requires logical deletion/fragment/backup/retention language. | PASS |
| LIFE-06 | `test/unit/file-rag-repository.test.ts:240-263` asserts terminal metadata -> content-free tombstone -> removal. | PASS |
| CAP-01 | `test/unit/file-rag-repository.test.ts:293-307` and `test/unit/rag-ingestion-coordinator.test.ts:559-581` assert the 128 MiB boundary and pre-work 507. | PASS |
| CAP-02 | `test/unit/rag-ingestion-coordinator.test.ts:539-581` asserts exact queue cap/429/Retry-After while hit/join bypass. | PASS |

### Operations and evidence

| AC | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| OPS-01 | `test/unit/config.test.ts:70-132` asserts exact defaults/bounds and sanitized variable-only failures. | PASS |
| OPS-02 | `test/unit/railway-contract.test.ts:21-82` asserts one replica, 1024 MB sfo Volume, roots/model, and no extra resource; Railway plan exited 0. | PASS |
| OPS-03 | `test/integration/application-composition.test.ts:169-203` and `test/unit/rag-ingestion-coordinator.test.ts:637-654` assert warmup/reconcile/workers before readiness; production health/ready are 200. | PASS |
| OPS-04 | `test/unit/rag-ingestion-coordinator.test.ts:691-730` and `test/integration/rag-http-app.test.ts:359-442` assert deterministic fatal degradation/recovery and no resurrection. | PASS |
| OPS-05 | `test/integration/application-composition.test.ts:499-539`, `test/unit/rag-ingestion-coordinator.test.ts:355-439`, and `test/unit/runtime-metrics.test.ts:217-246` assert exact 23 families and bounded labels. | PASS |
| OPS-06 | `test/unit/rag-domain.test.ts:369-385` and `test/unit/runtime-metrics.test.ts:217-246` assert fixed sanitized errors and protected-value absence. | PASS |
| OPS-07 | `test/integration/openapi.test.ts:125-167,383-475` asserts OpenAPI 1.2.0, four strict Bearer operations, schemas/statuses, and parity. | PASS |
| OPS-08 | `test/evaluation/rag-retrieval.test.ts:792-813` asserts the exact 12-document/48-qrel versioned fixture and groups. | PASS |
| OPS-09 | `test/evaluation/rag-retrieval.test.ts:815-863` asserts every threshold, 8/8 disambiguation, identical three-run IDs/ranks, and zero network. UINT8 observed hybrid Recall@5/MRR@10/nDCG@10 = `0.979167/0.888889/0.912200`; semantic Recall@5 = `0.958333`. | PASS |
| OPS-10 | `.github/workflows/ci.yml:27-72`, `test/unit/ci-contract.test.ts:93-119`, and `test/unit/container-contract.test.ts:145-188` assert the hermetic gate. Exact-HEAD run `33101923417` executed Source job `98621578883` and Container job `98621994139` successfully. | PASS |

**Acceptance status:** **52/52 matched**; zero uncovered criteria; zero spec-precision gaps.

## Explicit Edge Cases

| Edge | `file:line` + asserted outcome | Result |
| --- | --- | --- |
| EDGE-01 | `test/integration/rag-routes.test.ts:283-305` asserts 401/Bearer before malformed RAG input/dependencies. | PASS |
| EDGE-02 | `test/integration/artifact-snapshot-lock.test.ts:32-65` asserts complete snapshot or exact expiry error. | PASS |
| EDGE-03 | `test/unit/rag-ingestion-worker.test.ts:659-688` asserts precommit staging stays invisible without retranscription. | PASS |
| EDGE-04 | `test/unit/rag-ingestion-worker.test.ts:561-586,635-656` asserts postcommit completion with zero re-embedding. | PASS |
| EDGE-05 | `test/integration/lancedb-rag-index.test.ts:242-289` asserts smaller replacement removes every surplus row. | PASS |
| EDGE-06 | `test/unit/rag-chunker.test.ts:233-251` asserts whitespace coverage/attachment and fixed all-empty failure. | PASS |
| EDGE-07 | `test/unit/model-manifest.test.ts:90-135` fingerprints UINT8/policy v2; `test/unit/rag-storage-paths.test.ts:29-71` isolates v2; `test/integration/lancedb-rag-index.test.ts:414-445` rejects incompatibility without mutation. | PASS |
| EDGE-08 | `test/unit/rag-ingestion-worker.test.ts:285-374` and `test/integration/lancedb-rag-index.test.ts:522-586` assert serialized safe maintenance. | PASS |
| EDGE-09 | `test/unit/rag-ingestion-worker.test.ts:505-539,589-632` and `test/integration/rag-http-app.test.ts:359-442` assert post-admission cleanup/prior preservation/recovery. | PASS |
| EDGE-10 | `test/unit/rag-chunker.test.ts:209-229` asserts nullable/coarse timestamps without interpolation. | PASS |

**Edge status:** **10/10 matched**.

## Production Improvement Backlog

`.specs/features/railway-production-deploy/improvements.md:14-23` contains exactly IMP-01 through
IMP-10, each with status `Verified`, a complete requirement mapping, and a valid local link to an
independent PASS report. `test/unit/production-improvements-contract.test.ts:91-117` enforces the
exact rows and canonical state.

| Improvements | Delivery evidence | Result |
| --- | --- | --- |
| IMP-01, IMP-02, IMP-05..IMP-09 | `production-runtime-hardening/validation.md:7-10,88-100` proves 46/46 HARD/PROC/PROV/OBS/API/CI/OPS requirements and 6/6 sensor. | PASS |
| IMP-03, IMP-04 | `durable-transcript-jobs/validation.md:35-84,138-140,171-175` proves 46/46 JOB/WORK/STORE/CACHE/OPS/EDGE requirements and 24/24 sensor. | PASS |
| IMP-10 | This report proves 52/52 RAG requirements, 10/10 edges, hermetic CI, Railway/UAT, and sensor coverage. | PASS |

**Backlog status:** **10/10 verified**. All 11 local evidence links resolve. No obsolete Proposed,
In Progress, billing-lock, or evidence-zero canonical marker remains.

## Gate Check and Test Integrity

| Gate | Exact result |
| --- | --- |
| T41 focused | 9 files / **58 tests passed**: manifest/fetch/encoder/storage/docs/backlog plus real encoder and three-run evaluation. |
| Mandatory local Build | `npm run check` exit 0: Biome 104 files, strict TypeScript, **59/59 files and 740/740 tests**, production build. |
| Offline RAG | `npm run test:rag:offline`: **7/7 files and 31/31 tests**, no network/credentials. |
| Dependency audit | `npm audit --omit=dev`: **0 vulnerabilities**. |
| Baseline | 436 tests before RAG; current delta **+304**. No count regression. |
| Skips | 0 runtime skips; static search found no skip/todo/only/xit/xtest/xdescribe syntax. |
| Structural | Three relevant feature specs/tasks/state gates green; 49/49 commit subjects valid; diff-check clean. |
| Container | Exact-HEAD Linux job built one production image and passed packaged smoke with Docker network disabled. |

## P0 Discrimination Sensor

The nine prior production/workflow mutations still target unchanged code/assertions and remain
applicable. Six fresh mutations ran one at a time in detached HEAD worktrees for T41/backlog.

| ID | Mutation | Killing evidence | Result |
| --- | --- | --- | --- |
| M01-M09 | Chunk bound, RRF, metrics privacy, maintenance threshold, CI network denial, Volume region, packaged smoke, auth order, and fatal retry boundary. | Prior report cites exact unchanged killing assertions; 9/9 killed. | KILLED |
| M10 | UINT8 dtype -> signed INT8. | `model-manifest` and `local-e5-encoder` failed exact dtype/pipeline/fingerprint assertions (3 failures). | KILLED |
| M11 | Official `model_uint8.onnx` path -> `model_int8.onnx`. | `model-manifest` rejected exact artifact/fingerprint (2 failures). | KILLED |
| M12 | UINT8 SHA-256 final nibble `f1` -> `f0`. | Manifest and real encoder failed exact integrity/fingerprint checks (4 failures). | KILLED |
| M13 | Embedding policy v2 -> v1. | `model-manifest` failed exact policy/fingerprint assertions (2 failures). | KILLED |
| M14 | RAG namespace v2 -> v1. | `rag-storage-paths` failed exact namespace and fail-closed layout assertions (3 failures). | KILLED |
| M15 | Removed `STORE-01..08` from IMP-03 delivery mapping. | `production-improvements-contract` failed the exact delivery row (1 failure). | KILLED |

**Sensor depth:** P0 expanded manual sensor. **Result:** **15 injected, 15 killed, 0 survived — PASS**.
Scratch cleanup restored the exact report-only real-tree baseline.

## GitHub CI Evidence

- Push run **33101923417** targets exact HEAD
  `3f85c6aafb217b8e17c562c476a7d714559b3c8e` and concluded `success`.
- Source job **98621578883** executed every required step: locked install/model fetch+verification,
  **740/740**, Offline RAG **31/31**, and audit **0**. Its x64 evaluation reproduced the same UINT8
  thresholds and portable golden vector.
- Container job **98621994139** built/loaded the unpublished production image with manifest
  `sha256:49daa4ef8cd861d882c09dff775822a422fe4b506dd71721e591eb12b9694ca9`.
- It then ran exactly `docker run --rm --network none transcript-youtube-videos-api:ci node
  scripts/rag-container-smoke.mjs` and emitted `RAG_SMOKE_OK` with 384 dimensions, unit norm, one
  vector hit, one text hit, packaged model bytes, `/data/lancedb`, and an on-disk index.

## Railway Production and UAT Evidence

Read-only checks were scoped to project `cf42a201-0f75-4029-af45-222b3b8f3f27`, production
environment `969aaf93-84e0-4479-9a17-71d59d1c0752`, and service
`bdcca9c0-aa9e-4e54-b0a8-0836a6dc076e`. No secret value was requested or printed.

| Check | Observed result |
| --- | --- |
| Deployment | `c9b69eb6-366d-4fcf-a9f1-bcf6348f5093` is `SUCCESS` with one `RUNNING` instance and image `sha256:faba7e9cf48b04f120b670146ece9936d2811a7816961e2b64f6e75003e1a9f9`. |
| Topology/storage | One sfo replica; `transcript-data` Volume is READY, 1024 MB, mounted at `/data`. |
| IaC drift | `railway config plan --detailed-exit-code` exited 0: already up to date. |
| Current probes | `/health` 200 `{"status":"ok"}`; `/ready` 200 `{"status":"ready"}`; unauthenticated `/metrics` 401. HTTP logs corroborate those statuses on the active deployment. |
| Namespace upgrade | Read-only SSH proves `/data/lancedb/v1` and `/data/lancedb/v2` both exist; v1 has 14 files/30,436 bytes and v2 has 12 files/28,562 bytes. No v1 migration/deletion occurred. |
| Authenticated UAT | Operator evidence: empty search 200/0; retained-source reingestion 202 -> completed; post-reingestion search 200 with two results. |

## Code Quality

| Principle | Result | Evidence |
| --- | --- | --- |
| Surgical compatibility fix | PASS | T41 changes only the inseparable model artifact/dtype/fingerprint/storage-version policy, docs, tests, and TLC evidence. |
| No threshold weakening | PASS | Fixture, query, RRF, and all OPS-09 thresholds are unchanged; scores improved and pass on local/GitHub/container/Railway. |
| Fail-closed upgrade | PASS | Exact integrity verification rejects the old artifact; v2 starts isolated while v1 remains untouched for backup/explicit reingestion. |
| Spec-anchored/per-layer coverage | PASS | 52/52 direct outcome rows; route happy/error/auth/capacity/lifecycle coverage retained. |
| Test integrity | PASS | 740 >= 436, zero skips, no deleted/weakened behavioral assertion, 15/15 sensor mutations killed. |
| Runtime truthfulness | PASS | Exact-HEAD GitHub/container evidence and deployed Railway/UAT agree with local outcomes. |

## Requirement Traceability

| Group | Verified | Status |
| --- | ---: | --- |
| ING | 8/8 | Verified |
| VER | 8/8 | Verified |
| CHUNK | 6/6 | Verified |
| EMB | 4/4 | Verified |
| SEARCH | 8/8 | Verified |
| LIFE | 6/6 | Verified |
| CAP | 2/2 | Verified |
| OPS | 10/10 | Verified |
| Explicit edges | 10/10 | Verified |
| Production improvements | 10/10 | Verified |

## Ranked Gaps

None. The remaining unchecked T41 box and pending header are deliberately self-referential to this
independent verdict. The orchestrator should mark them complete and record this report in the final
documentation commit; no implementation or deployment change is required.

## Closing Gate

**Overall:** READY — independent validation PASS.

- Acceptance criteria: **52/52**; explicit edges: **10/10**; IMP backlog: **10/10**.
- Local current-HEAD Build: **740 passed, 0 failed, 0 skipped**.
- Offline RAG: **31/31**; dependency audit: **0 vulnerabilities**.
- Exact-HEAD CI: Source and Container jobs green, including network-denied runtime smoke.
- Sensor: **15/15 killed**, including five T41 production-policy mutations and the IMP-03 crosswalk.
- Railway: exact UINT8 release `SUCCESS/RUNNING`, healthy, drift-free, v1 preserved, v2 reingested.

No lesson is created because this round has no surviving mutant, uncovered AC, spec-precision gap,
or `SPEC_DEVIATION`. This verifier changed only this report.
