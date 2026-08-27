# Durable Transcript Jobs and Artifact Cache Validation - Round 3

**Verdict**: PASS
**Date**: 2026-08-26
**Spec**: `.specs/features/durable-transcript-jobs/spec.md`
**Diff range**: `ee4aa46..ef8e4b0` (Round 2 fixes: `8550f88..ef8e4b0`)
**Verifier**: `/root/verify_durable_jobs_round3`, independent sub-agent (author != verifier and != prior verifiers)

All 46 requirements match their spec-defined outcomes. The build gate passes with 436 tests, and
the expanded storage/runtime sensor killed all 24 mutations. The Round 2 gaps are closed: every
listed malformed manifest and missing-child case is pointer-invalidated and quarantined for cache
lookup while completed-job reads remain sanitized 503; true EIO is not quarantined; and publication
failures roll back only the new bundle while preserving prior/unrelated content.

---

## Task Completion

| Tasks | Status | Notes |
| --- | --- | --- |
| T1-T15 | Done | Domain, runtime, persistence, cache, worker, HTTP, OpenAPI, and production composition gates pass. |
| T16-T20 | Done | Railway IaC, non-root container contract, ignore policy, and operations documentation pass. |
| T21-T28 | Done | Round 1 fixes and read-only Railway plan evidence remain effective. |
| T29 | Done | Invalid manifest cache key, artifact ID, producer ID, checksum, and missing child are covered through cache and completed-job reads. |
| T30 | Done | Pointer/directory failure tests prove pre/post-rename rollback and preservation of prior/unrelated bundles. |

All 35 commit subjects in `ee4aa46..ef8e4b0` pass `check_commit.py`; `git diff --check` passes. The
historical T9 follow-up formatting commit `59a9d14` remains documented as a past atomic-protocol
deviation. The Round 2 fix tasks themselves are atomic.

---

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| JOB-01 | Authenticated valid submit returns exact 202 resource, Location, and Retry-After 2 | `test/integration/job-routes.test.ts:149-152` - exact status, headers, and `toEqual(submission(disposition))` for miss/joined/hit | PASS |
| JOB-02 | Status returns exact public queued/processing/completed/failed resource | `test/integration/job-routes.test.ts:176-178` - `toBe(200)`, exact resource, exact job ID delegation across all states | PASS |
| JOB-03 | Completed JSON and PDF preserve exact content, bytes, media type, and safe filename | `test/integration/job-routes.test.ts:196-203` - exact transcript, headers, and `rawPayload.equals(pdf)` | PASS |
| JOB-04 | Active result is sanitized 409/Retry-After 2; failed is sanitized 409 without retry | `test/integration/job-routes.test.ts:268-296` and `:345-366` - exact code/status/message/header tables for JSON and PDF | PASS |
| JOB-05 | Unknown valid UUID is 404; retained tombstone is 410 | `test/unit/durable-job-coordinator.test.ts:432-446` - exact 410/404 codes and zero artifact reads | PASS |
| JOB-06 | Bearer authentication runs before body/UUID/coordinator access and missing config fails closed | `test/integration/job-routes.test.ts:245-264` and `:370-391` - exact 401/503 results and all coordinator calls remain zero | PASS |
| JOB-07 | Persisted/public failure is allowlisted, fixed, and redacted | `test/unit/job.test.ts:190-220` - exact failure resource, prohibited-field absence, and diagnostic rejection | PASS |
| WORK-01 | Startup probes, initializes, reconciles, starts one worker, and becomes ready in order | `test/unit/durable-job-coordinator.test.ts:466-482` - exact probe/initialize/recover/start calls, readiness, gauges, and one stop | PASS |
| WORK-02 | FIFO worker obtains one permit before claim/work and propagates signal/metrics | `test/unit/durable-job-worker.test.ts:230-255` - exact start/complete transitions, work/options payload, release, duration, and gauges; `test/unit/execution-controller.test.ts:151-165` - FIFO admissions | PASS |
| WORK-03 | Saturation leaves the job queued with no work or rejection metric | `test/unit/durable-job-worker.test.ts:211-224` - exact queued record and zero provider/render/publish/release; `test/unit/execution-controller.test.ts:147-165` - FIFO wait and zero rejection | PASS |
| WORK-04 | Stale or terminal records perform no external/publication/terminal overwrite work | `test/unit/durable-job-worker.test.ts:258-290` - zero transitions/provider/publication after revision loss or terminal observation | PASS |
| WORK-05 | Client disconnect does not cancel durable work; shutdown interrupts and persists safely | `test/integration/durable-http-app.test.ts:297-343` - submit settles after disconnect; `test/unit/durable-job-worker.test.ts:551-570` - exact interrupted state, one release, stopped loop | PASS |
| WORK-06 | Recovery completes a bundle, locally resumes transcript-only work, or interrupts without provider retry | `test/unit/durable-job-worker.test.ts:464-477`, `:504-527`, and `:534-548` - exact three branches with explicit zero provider calls | PASS |
| WORK-07 | Terminal paths release/update once and leave no work/listener/timer residue | `test/unit/durable-job-worker.test.ts:321-360` and `:428-446` - real work cleanup and exact rollback order; `test/unit/execution-controller.test.ts:218-237` - shutdown listener/waiter cleanup | PASS |
| STORE-01 | Files sync/close/rename/sync-directory and publish references only after durable content | `test/unit/atomic-file-writer.test.ts:121-131` - exact durability event order; `test/unit/file-artifact-store.test.ts:144-183` - immutable files/manifest before pointer | PASS |
| STORE-02 | Manifest contains exact producer, versions, timestamps, sizes, and SHA-256 checksums | `test/unit/file-artifact-store.test.ts:156-183` - exact manifest metadata and pointer values | PASS |
| STORE-03 | Schema/size/checksum/incomplete/malformed content is never returned and is opaquely quarantined pointer-first | `test/unit/file-artifact-store.test.ts:342-427` - schema/size/byte-checksum/partial plus cacheKey/artifactId/producerId/checksum/missing-child tables; `:430-455` - EIO preserves pointer and avoids quarantine | PASS |
| STORE-04 | Completed missing/corrupt reference returns sanitized 503 without retranscription | `test/unit/file-artifact-store.test.ts:399-427` and `:458-545` - exact 503, pointer-first corruption handling, missing/EIO distinction; `test/unit/durable-job-coordinator.test.ts:449-459` - sanitized coordinator mapping | PASS |
| STORE-05 | Startup removes temps, quarantines corrupt records, and repairs duplicate owners deterministically | `test/unit/file-job-repository.test.ts:206-264` - exact cleanup/quarantine and oldest-owner/interrupted-duplicate assertions | PASS |
| STORE-06 | Storage failures drop readiness, sanitize miss 503, keep health callable, and recover by local probe | `test/integration/application-composition.test.ts:280-340` - exact health/readiness/503/redaction/no-provider/recovery assertions; `test/unit/file-artifact-store.test.ts:641-676` - ENOSPC/EROFS health recovery | PASS |
| STORE-07 | Per-key lock prevents read/delete races; expiry removes pointer/content before tombstone | `test/unit/file-artifact-store.test.ts:583-639` - exact expiry and complete-read serialization; `test/unit/file-job-repository.test.ts:287-310` - artifact expiry precedes tombstone publication | PASS |
| STORE-08 | Strict UUID/SHA paths are confined and invalid input touches no filesystem | `test/unit/atomic-file-writer.test.ts:188-225` and `test/unit/file-artifact-store.test.ts:678-700` - strict shards/confinement and zero-read rejection | PASS |
| CACHE-01 | Cache identity is exact versioned SHA-256 without public preimage | `test/unit/transcript-request.test.ts:19-26` and `:67-73` - exact key/versions, exact public keys, and recomputation | PASS |
| CACHE-02 | Defaults/case/order/duplicates canonicalize exactly before dependencies | `test/unit/transcript-request.test.ts:29-44` and `:55-64`; `test/integration/job-routes.test.ts:224-242` - exact lists/keys and zero submit on duplicates | PASS |
| CACHE-03 | Concurrent equivalent misses create one miss, one joined ID, and one worker execution | `test/unit/durable-job-coordinator.test.ts:217-238` - exact resources, one create, one notify, and miss/joined metrics | PASS |
| CACHE-04 | Active/completed state joins/hits; failed/corrupt state allows new work and never caches failure | `test/unit/durable-job-coordinator.test.ts:241-275` and `:350-358` - joined/hit/fresh miss; `test/unit/file-artifact-store.test.ts:371-427` - every listed corruption becomes cache miss but completed read stays 503 | PASS |
| CACHE-05 | Capacity rejects only a new miss; joined/hit bypass exact cap | `test/unit/durable-job-coordinator.test.ts:278-302` and `:324-347` - hit-at-cap succeeds, miss gets exact 429/30, and no record/work is created | PASS |
| CACHE-06 | Cached metadata/PDF bytes remain exact and reads do not slide expiry | `test/unit/file-artifact-store.test.ts:328-340` - exact transcript/PDF/expiry and unchanged pointer; `test/integration/durable-http-app.test.ts:210-219` - exact sync JSON/PDF hit and zero production | PASS |
| CACHE-07 | Fixed completed/failed/tombstone TTLs remove content and allow a new equivalent job | `test/integration/application-composition.test.ts:378-436` - exact boundary, 410 tombstone, new UUID/miss/provider work; `test/unit/file-artifact-store.test.ts:186-325` - failed publication leaves no orphan and preserves prior/unrelated bundles | PASS |
| CACHE-08 | Sync routes reuse/publish verified cache while preserving auth/admission/cancel/error behavior | `test/integration/durable-http-app.test.ts:186-293` - exact hits, admitted miss, fail-open storage error, and preserved saturation | PASS |
| OPS-01 | Durable configuration defaults, bounds, and sanitized errors are exact | `test/unit/config.test.ts:46-54`, `:57-100`, and `:134-157` - every default/bound and variable-name-only rejection | PASS |
| OPS-02 | Railway declares one 1024 MB `/data` Volume, one replica, correct root, preserved secrets, and no extra resource | `test/unit/railway-contract.test.ts:26-54` and `:57-73` - exact topology and prohibited-resource checks; `test/unit/container-contract.test.ts:24-35` - fixed non-recursive mount ownership | PASS |
| OPS-03 | Ready is exact 200 only for healthy lifecycle/storage/worker and exact 503 otherwise without network | `test/integration/application-composition.test.ts:107-113`, `:280-299`, and `:317-340` - exact readiness/liveness transitions and zero provider/render work | PASS |
| OPS-04 | Fixed-label metrics report exact queue/processing/terminal/cache/recovery/storage state | `test/integration/application-composition.test.ts:245-262` - real lifecycle gauges; `test/unit/runtime-metrics.test.ts:89-110` and `:113-142` - exact families, values, and redaction | PASS |
| OPS-05 | OpenAPI 1.1 has nine-route parity, exact job schemas/statuses/headers/security, and no secrets | `test/integration/openapi.test.ts:110-170`, `:227-258`, `:294-348`, and `:357-368` - version/parser/parity/security/schema/status/header/redaction assertions | PASS |
| OPS-06 | Logs/errors use fixed fields and omit protected identifiers/content/diagnostics | `test/integration/durable-http-app.test.ts:346-379` - log redaction; `test/unit/runtime-metrics.test.ts:113-142` - dynamic labels collapse to `unknown` and protected values are absent | PASS |
| OPS-07 | Local root is ignored/temp-replaceable and deterministic gates need no provider/network | `test/integration/application-composition.test.ts:102-113` - root created only at startup; `test/unit/storage-ignore-contract.test.ts:17-39` - exact `.data/` ignore behavior | PASS |
| OPS-08 | Docs state fixed TTLs, topology, retry, backup risk, and LanceDB namespace | `test/unit/durable-jobs-readme-contract.test.ts:38-62` and `:65-90` - exact defaults/retention/no-retry/Volume/replica/downtime/backup/namespaces | PASS |
| EDGE-01 | Joined and hit succeed while queue is full | `test/unit/durable-job-coordinator.test.ts:241-260` and `:278-302` - both return existing job without record/work at cap | PASS |
| EDGE-02 | Transcript-only restart renders/publishes locally without provider work | `test/unit/durable-job-worker.test.ts:504-523` - provider zero, one exact render/publication, unchanged transcript | PASS |
| EDGE-03 | Uncertain external work without transcript becomes interrupted with no retry | `test/unit/durable-job-worker.test.ts:534-548` - exact failure and zero provider/render/publish | PASS |
| EDGE-04 | Concurrent read/expiry yields complete bytes or absence, never partial | `test/unit/file-artifact-store.test.ts:599-639` - expiry waits for a complete read and then removes content | PASS |
| EDGE-05 | Case/default equivalence deduplicates while preference order changes identity | `test/unit/transcript-request.test.ts:29-44` - exact same/different keys and ordered languages | PASS |
| EDGE-06 | Sync cache failure preserves produced response and is sanitized/observable | `test/integration/durable-http-app.test.ts:249-268` - exact 200 transcript, write-failed metric, and no storage detail | PASS |
| EDGE-07 | Duplicate recovery retains oldest and interrupts later owners without provider work | `test/unit/file-job-repository.test.ts:239-264` - exact owner, repaired failure, and zero artifact work | PASS |
| EDGE-08 | Invalid job/cache/artifact identifiers touch no filesystem path | `test/integration/job-routes.test.ts:206-221`, `test/unit/file-artifact-store.test.ts:678-700`, and `test/unit/file-job-repository.test.ts:395-414` - exact rejection and zero access | PASS |

**Spec-anchored status**: 46/46 matched; 0 uncovered; 0 spec-precision gaps.

---

## Gate Check

- **Build gate**: `npm run check`, exit 0.
- **Result**: Biome lint, strict TypeScript typecheck, Vitest, and production build passed.
- **Tests**: 30 files, 436 passed, 0 failed, 0 skipped.
- **Unit**: 25 files, 337 passed.
- **Integration**: 5 files, 99 passed.
- **Baseline**: 215 tests before this feature; delta +221.
- **Integrity**: no `.skip`, `.todo`, `.only`, `xit`, `xdescribe`, or `SPEC_DEVIATION` marker in source/tests.
- **Validators**: spec 0 errors/0 warnings; tasks strict 0 errors/0 warnings; 35 commit subjects valid; `git diff --check` clean.
- **Docker**: unavailable locally (`docker`: command not found). No runtime-container claim is made; static contracts pass and CI remains authoritative.
- **Railway**: `.specs/features/durable-transcript-jobs/railway-plan.md:1` records the read-only `1 to add, 2 to change, 0 to destroy` plan. No apply, deploy, domain, variable write, or remote mutation ran.

---

## Discrimination Sensor

Each counted mutation ran alone in a detached temporary git worktree at `ef8e4b0`, with the real
`node_modules` mounted only by a scratch symlink. Every worktree was removed. No stash, reset, or
real-tree mutation was used. A preliminary M05 invocation selected only the cache `find` case; it
was discarded as an invalidly narrow run. The corrected `missing child` filter executed both
`find` and `readForJob` and killed the mutant.

| ID | Semantic mutation | Killing evidence | Result |
| --- | --- | --- | --- |
| M01 | Let manifest cache-key validator `TypeError` escape corruption normalization | Cache-miss and completed-read invalid-cache-key assertions failed | KILLED |
| M02 | Let manifest artifact-ID validator `TypeError` escape normalization | Invalid-artifact-ID assertions failed | KILLED |
| M03 | Let manifest producer-ID validator `TypeError` escape normalization | Invalid-producer-ID assertions failed | KILLED |
| M04 | Let manifest checksum validator `TypeError` escape normalization | Invalid-checksum assertions failed | KILLED |
| M05 | Classify a missing child as merely missing instead of corrupt | Completed-read pointer/quarantine assertions failed | KILLED |
| M06 | Classify operational child-read EIO as corruption | EIO pointer-preservation/no-quarantine assertions failed | KILLED |
| M07 | Quarantine a corrupt cache bundle before removing its pointer | Cache pointer-first event table failed | KILLED |
| M08 | Quarantine a corrupt completed bundle before removing its owned pointer | Completed-read pointer-first event assertion failed | KILLED |
| M09 | Assume target publication after a pre-rename failure | Pre-existing target/pointer preservation failed | KILLED |
| M10 | Deny target publication after a post-rename failure | Post-rename orphan-bundle assertion failed | KILLED |
| M11 | Disable new-bundle cleanup after cache-pointer write failure | No-orphan and subsequent-clean-miss assertions failed | KILLED |
| M12 | Remove artifact-ID ownership from pointer rollback | Prior pointer/bundle preservation assertion failed | KILLED |
| M13 | Call provider production during transcript-only recovery | Explicit zero-provider-call assertion failed | KILLED |
| M14 | Add one to the queued lifecycle gauge | Exact worker/composition gauge assertions failed | KILLED |
| M15 | Evaluate queue capacity before completed-cache lookup | Hit-at-cap returned rejection and failed | KILLED |
| M16 | Remove success-path private-work cleanup | Real work manifest remained and failed | KILLED |
| M17 | Remove bundle invalidation after completion-transition failure | Exact rollback order/content assertions failed | KILLED |
| M18 | Re-throw raw cache lookup failure without degrading readiness | Sanitized 503/readiness/no-work assertions failed | KILLED |
| M19 | Delay expiry at the exact TTL boundary (`>` to `>=`) | Tombstone/resubmit/new-UUID integration failed | KILLED |
| M20 | Remove Bearer hook from job status route | Auth-before-invalid-UUID assertion failed | KILLED |
| M21 | Remove file `sync()` before atomic rename | Exact durability event assertion failed | KILLED |
| M22 | Change Railway Volume from 1024 to 2048 MB | Exact IaC topology assertion failed | KILLED |
| M23 | Make entrypoint ownership recursive | Fixed non-recursive container contract failed | KILLED |
| M24 | Document TTLs as sliding | Fixed non-sliding retention contract failed | KILLED |

**Sensor depth**: expanded high-risk manual sensor.
**Result**: 24 injected, 24 killed, 0 survived. PASS.
**Isolation**: real-tree porcelain was empty before and after; final `git worktree list` contained
only `/home/matheus/transcript-youtube-videos-api` at `ef8e4b0`.

---

## Code Quality

| Principle | Status | Evidence |
| --- | --- | --- |
| Minimum/surgical scope | PASS | Complete diff remains inside durable jobs/cache/runtime/IaC/docs and their tests/spec artifacts. |
| Existing patterns/style | PASS | Biome, strict TypeScript, build, and all tests pass. |
| No scope creep | PASS | No RAG/LanceDB implementation, database, bucket, deploy, or remote mutation. |
| Spec-anchored outcomes | PASS | All 46 rows assert precise spec-defined values/states; no precision gap. |
| Per-layer coverage | PASS | Domain branches, real-filesystem durability/corruption/races, every job route state, lifecycle integration, OpenAPI, IaC, container, and docs are covered. |
| Test ownership/integrity | PASS | 436 >= 215 baseline; no skip/weakening marker; all in-scope tests map to a requirement, edge case, or task done-when criterion. |
| Atomic task protocol | HISTORICAL DEVIATION | T9 received formatting commit `59a9d14` after its task commit; the deviation is preserved and was not repeated by T21-T30. |
| Project guidance | PASS | README Quality, package scripts, Vitest, Biome, and CI conventions were followed. |

---

## Requirement Traceability

| Previous status | Recommended verified status | Requirements |
| --- | --- | --- |
| Completed | Verified (46) | JOB-01..JOB-07; WORK-01..WORK-07; STORE-01..STORE-08; CACHE-01..CACHE-08; OPS-01..OPS-08; EDGE-01..EDGE-08 |

The verifier did not modify `spec.md`, `tasks.md`, `STATE.md`, code, tests, or lessons. A clean PASS
has no new execution signal, so no lesson is recorded.

## Summary

**Overall**: READY

- **Spec-anchored check**: 46/46 matched; 0 gaps; 0 spec-precision gaps.
- **Gate**: 436 passed, 0 failed, 0 skipped.
- **Sensor**: 24/24 killed; 0 survived; isolation preserved.
- **Remote state**: unchanged. Railway apply still requires separate approval of the recorded exact plan.
- **Next step**: orchestrator may mark all 46 requirements Verified and close this feature.
