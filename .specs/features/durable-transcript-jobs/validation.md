# Durable Transcript Jobs and Artifact Cache Validation

**Verdict**: FAIL
**Date**: 2026-08-26
**Spec**: `.specs/features/durable-transcript-jobs/spec.md`
**Diff range**: `ee4aa46..ec69adc`
**Verifier**: `/root/verify_durable_jobs`, independent sub-agent (author != verifier)

The build is green, but the feature is not ready. The outcome check matched 36 of 46 requirements.
Three of 18 semantic mutants survived. Scratch diagnostics also reproduced three production defects:
durable cache-read failures escape as raw errors, corrupt completed-job artifacts are not quarantined,
and the queued gauge remains at one after the only job completes.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1-T8 | Done | Expected task commits are present and the final gate passes. |
| T9 | Partial | Functional code is present, but task work spans `368e80a` and the later `59a9d14`; the latter changes source and tests after the task commit, violating the one-task/one-commit and gate-before-done protocol. |
| T10-T15 | Done with feature gaps | Expected commits are present; gaps are listed below. |
| T16 | Partial evidence | Static IaC contract passes. The checked-in tree has no recorded add/change/destroy summary proving the marked-done `railway config plan` outcome. No apply was run by this verifier. |
| T17-T20 | Done | Static/container/docs contracts pass. Docker is unavailable locally, so the unchanged CI container build remains authoritative. |

All 21 commit subjects in the range pass `check_commit.py`; the extra subject is the T9 formatting
commit. `git diff --check` passes.

---

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | `file:line` + assertion expression | Result |
| --- | --- | --- | --- |
| JOB-01 | Authenticated valid submission returns exact 202 resource, Location, and Retry-After 2 for miss/joined/hit | `test/integration/job-routes.test.ts:149` - `expect(response.statusCode).toBe(202)`; `:150` Location; `:151` Retry-After; `:152` exact body | PASS |
| JOB-02 | Retained status returns exact queued/processing/completed/failed public resource | `test/integration/job-routes.test.ts:176` - `expect(response.statusCode).toBe(200)`; `:177` `toEqual(resource(status))` across all four states | PASS |
| JOB-03 | Completed result returns exact Transcript and byte-identical safe PDF | `test/integration/job-routes.test.ts:197` - exact transcript; `:200` safe disposition; `:203` byte equality | PASS |
| JOB-04 | Active results return 409/Retry-After 2; failed returns sanitized 409 without retry | `test/integration/job-routes.test.ts:288` - exact status; `:289` exact envelope; `:295` owned retry header across error table | PASS |
| JOB-05 | Valid unknown ID is 404 and retained tombstone is 410 | `test/unit/durable-job-coordinator.test.ts:381` - expired code/status; `:385` unknown code/status; `:389` no artifact access | PASS |
| JOB-06 | Bearer authentication precedes validation and all job access; missing server auth fails closed | `test/integration/job-routes.test.ts:261` - exact 401/503; `:263`-`:264` zero preparation/submission; `:384`-`:391` all four routes authenticate before coordinator access | PASS |
| JOB-07 | Persisted/exposed failure contains only allowlisted code/fixed message and no diagnostics/content | `test/unit/job.test.ts:215` - exact `{ code, message }` for every allowlisted code; `:218` rejects diagnostic code; `test/unit/durable-job-worker.test.ts:274` exact sanitized persisted failure and `:279` prohibited-text absence | PASS |
| WORK-01 | Startup probes, initializes, reconciles, starts exactly one worker, then becomes ready | `test/unit/durable-job-coordinator.test.ts:413`-`:417` assert probe, initialize, recover, one start, and ready; `test/integration/application-composition.test.ts:100` asserts ready 200 | PASS |
| WORK-02 | FIFO job gets one lifecycle permit before claim and exact signal/metrics propagation | `test/unit/durable-job-worker.test.ts:215` - start/complete order; `:216` one production; `:221` exact work payload; `:223` one release; `test/unit/execution-controller.test.ts:153`-`:165` exact FIFO order | PASS |
| WORK-03 | No capacity leaves durable queued state and performs no external/PDF/artifact work or rejection count | `test/unit/durable-job-worker.test.ts:195` - exact queued record; `:196`-`:199` zero work/release; `test/unit/execution-controller.test.ts:165` no capacity rejection | PASS |
| WORK-04 | Terminal/stale/revision-mismatched tick performs no work and cannot overwrite state | `test/unit/durable-job-worker.test.ts:236`-`:238` stale race has no transition/work/metric; `:256`-`:258` terminal state has no transition/work/publication | PASS |
| WORK-05 | Client disconnect does not cancel durable job; shutdown drops readiness, aborts and persists interruption | `test/integration/durable-http-app.test.ts:322`-`:343` disconnect leaves submit running and stop occurs only on close; `test/unit/durable-job-worker.test.ts:379`-`:384` exact interrupted failure, one release, stopped state | PASS |
| WORK-06 | Recovery completes a verified bundle, resumes transcript-only via PDF without provider, and interrupts missing transcript without retry | Complete and missing branches are asserted at `test/unit/durable-job-worker.test.ts:303`-`:310` and `:354`-`:362`. The transcript-only branch at `:313`-`:345` has no assertion that `artifactCoordinator.produceRequired`/provider was not called; mutant M09 survived. | GAP |
| WORK-07 | Success/failure releases and updates exactly once, with no listener, timer, temp file, or unhandled rejection | Release/duration assertions exist at `test/unit/durable-job-worker.test.ts:223`-`:224` and `:282`-`:283`, but durable work is saved at `src/application/transcript-artifact-coordinator.ts:130` and no success/failure path removes `v1/work/<jobId>`. No test asserts work cleanup. | FAIL |
| STORE-01 | Mutable writes use same-filesystem temp, file sync/close, rename, directory sync, and publish references last | `test/unit/atomic-file-writer.test.ts:121` exact bytes; `:122` exact durability event order; `test/unit/file-artifact-store.test.ts:89` exact content/manifest/directory/pointer order | PASS |
| STORE-02 | Manifest contains producer, versions, timestamps, sizes, and SHA-256 checksums | `test/unit/file-artifact-store.test.ts:99` - exact manifest including versions, timestamps and both metadata values | PASS |
| STORE-03 | Every incomplete/corrupt artifact read is verified, quarantined opaquely, and never returned | Cache reads are covered at `test/unit/file-artifact-store.test.ts:153`-`:157`. Completed-job read only asserts 503 at `:170`-`:177`; `src/infrastructure/storage/file-artifact-store.ts:403`-`:411` catches without quarantine. Scratch diagnostic failed because `v1/quarantine` did not exist. | FAIL |
| STORE-04 | Completed job with missing/corrupt artifact returns sanitized 503 without retranscription/state rewrite | `test/unit/file-artifact-store.test.ts:170`-`:177` corrupt mapping; `:186`-`:191` missing mapping; `test/unit/durable-job-coordinator.test.ts:397` exact public storage error | PASS |
| STORE-05 | Startup removes stale temp, quarantines corruption, and deterministically repairs duplicate active owners | `test/unit/file-job-repository.test.ts:212`-`:217` rebuild/temp/quarantine; `:244`-`:258` exact oldest-owner repair and no artifact work | PASS |
| STORE-06 | Unavailable/full/read-only storage drops readiness and a durable cache miss returns sanitized 503 while health remains callable | Probe/startup and readiness are covered at `test/unit/file-artifact-store.test.ts:311`-`:318` and `test/integration/application-composition.test.ts:214`-`:240`. New-miss lookup is not mapped: `src/application/durable-job-coordinator.ts:247` awaits `find` without a catch and `src/http/app.ts:266` maps the raw storage error to 500. Scratch diagnostic received `Error('/data/private')`, not `DurableJobError` 503. | FAIL |
| STORE-07 | Shared per-key lock prevents read/delete races; pointer is removed before content | `test/unit/file-artifact-store.test.ts:275`-`:282` proves expiry waits for complete read; `test/unit/file-job-repository.test.ts:287`-`:304` proves artifact expiry precedes tombstone | PASS |
| STORE-08 | Paths use strict UUID/SHA-256, versioned roots and two-character shards; traversal touches no path | `test/unit/atomic-file-writer.test.ts:192`-`:203` exact paths and rejection; `test/unit/file-artifact-store.test.ts:330`-`:344` invalid identifiers with zero reads | PASS |
| CACHE-01 | Cache key is SHA-256 over exact versioned canonical identity without preimage exposure | `test/unit/transcript-request.test.ts:19`-`:26` exact key and versions; `:70`-`:73` preimage fields absent and key recomputation exact | PASS |
| CACHE-02 | Defaults/case/order/duplicate canonicalization has exact behavior before repository/provider access | `test/unit/transcript-request.test.ts:29`-`:44` case/order outcomes; `:56` exact duplicate rejection; route-level zero submit at `test/integration/job-routes.test.ts:241` | PASS |
| CACHE-03 | Concurrent same-key misses create one miss, one joined result, one job and one eligible worker notification | `test/unit/durable-job-coordinator.test.ts:216`-`:232` exact two responses, one create, one notify and exact metrics | PASS |
| CACHE-04 | Active/completed owners join/hit; failed/interrupted/corrupt/expired allow new work and failures never become cache entries | Join/hit/failed paths are partially asserted at `test/unit/durable-job-coordinator.test.ts:249`, `:261`, and `:320`. No test injects failure after bundle publication but before completed-state persistence. `src/infrastructure/storage/file-artifact-store.ts:352` publishes the pointer before `src/application/durable-job-worker.ts:244` completes the job; the catch at `:250` can persist failed state without deleting that cache entry. | FAIL |
| CACHE-05 | Queue cap rejects only a new miss with exact 429/30 before record/dependencies; join/hit bypass cap | New miss and join are asserted at `test/unit/durable-job-coordinator.test.ts:305`-`:314` and `:249`-`:255`. There is no hit-at-cap assertion; M18 proves the suite permits rejecting a valid hit while full. | GAP |
| CACHE-06 | Cached JSON metadata/PDF bytes remain exact and access does not slide expiry | `test/unit/file-artifact-store.test.ts:127`-`:130` exact transcript, byte-identical PDF, fixed manifest/pointer; synchronous hit exactness at `test/integration/durable-http-app.test.ts:210`-`:219` | PASS |
| CACHE-07 | Completed/failed/tombstone TTL boundaries expire content and later equivalent submission creates new work | Store and repository boundaries are asserted at `test/unit/file-artifact-store.test.ts:233`-`:240` and `test/unit/file-job-repository.test.ts:315`-`:334`. No test submits the same request after completed expiry/tombstoning and asserts a new miss/job/provider eligibility. | GAP |
| CACHE-08 | Synchronous routes reuse verified bundle and publish success while preserving auth/admission/cancel/error contracts | `test/integration/durable-http-app.test.ts:210`-`:219` exact hit bypass; `:262`-`:268` storage error fails open; `:289`-`:293` saturation remains intact | PASS |
| OPS-01 | Durable config uses exact defaults/bounds and variable-name-only errors | `test/unit/config.test.ts:47`-`:54` exact defaults; `:84`-`:99` exact boundaries; `:134`-`:157` invalid values and sanitized messages | PASS |
| OPS-02 | Railway IaC declares one 1024 MB Volume at /data, one instance, data root/secrets, and no extra storage | `test/unit/railway-contract.test.ts:26`-`:54` exact resource; `:62`-`:73` prohibited-resource/secret/identifier absence | PASS |
| OPS-03 | Readiness is 200 only for ready lifecycle/storage/worker and exact 503 otherwise without network work | `test/integration/durable-http-app.test.ts:162`-`:169` lifecycle ready/close; `:179`-`:183` exact not-ready and no dependency calls; real storage degradation at `test/integration/application-composition.test.ts:230`-`:240` | PASS |
| OPS-04 | Metrics expose accurate current queued/processing counts and fixed-label submission/duration/cache/recovery/storage health | Metric primitives are asserted at `test/unit/runtime-metrics.test.ts:101`-`:110`, but lifecycle accuracy is absent. `src/application/durable-job-coordinator.ts:276` sets `queued` to total active only on miss; the worker never calls `setDurableJobs`. Scratch integration observed queued=1 after the only job completed. Mutant M17 survived. | FAIL |
| OPS-05 | OpenAPI 1.1 describes four protected job operations, exact schemas/statuses/headers and retains parity/security/secret absence | `test/integration/openapi.test.ts:113`-`:145` exact version/parity; `:164`-`:170` job security; `:294`-`:348` exact job contract; `:363`-`:368` secret absence | PASS |
| OPS-06 | Logs/public errors use fixed fields and exclude identifiers/content/secrets/diagnostics | `test/integration/durable-http-app.test.ts:374`-`:379` fixed request log and prohibited-value absence; `test/unit/runtime-metrics.test.ts:127`-`:142` unknown-label mapping and absence | PASS |
| OPS-07 | Local default is ignored/temp-replaceable and deterministic tests/OpenAPI need no credential/network | `test/integration/application-composition.test.ts:95`-`:101` configured temp root initialization; `test/unit/storage-ignore-contract.test.ts:27` repository ignore contract; full gate passed without provider credentials/network | PASS |
| OPS-08 | Docs state fixed TTLs, single Volume/replica, no retry, backup loss and reserved LanceDB path | `test/unit/durable-jobs-readme-contract.test.ts:55`-`:62` TTL/retry; `:82`-`:90` exact Volume/replica/downtime/backup/namespaces | PASS |
| EDGE-01 | Joined and hit submissions both return 202 for existing job while queue is full | Joined-at-cap is asserted at `test/unit/durable-job-coordinator.test.ts:249`-`:255`; no assertion covers hit-at-cap. Mutant M18 moved the cap check before cache lookup and all 14 coordinator tests still passed. | GAP |
| EDGE-02 | Restart after verified transcript renders only PDF and never calls provider again | `test/unit/durable-job-worker.test.ts:337`-`:345` asserts completion/render/cache but does not retain or assert the `produceRequired` provider mock. Mutant M09 inserted that call and all nine worker tests passed. | GAP |
| EDGE-03 | Restart after uncertain external effect and no verified transcript fails interrupted without retry | `test/unit/durable-job-worker.test.ts:354`-`:362` exact failed state plus zero produce/render/publish calls | PASS |
| EDGE-04 | Expiry/read race returns complete old artifact or post-expiry result, never partial/unhandled | `test/unit/file-artifact-store.test.ts:275`-`:282` proves read completes before expiry under the same key lock | PASS |
| EDGE-05 | Case/default equivalence deduplicates while preference order changes key | `test/unit/transcript-request.test.ts:29`-`:44` exact canonical list, same key for case and distinct key for reorder | PASS |
| EDGE-06 | Sync cache write failure preserves original response and is sanitized/observable | `test/integration/durable-http-app.test.ts:262`-`:268` exact 200 transcript, write_failed metric and no private path; coordinator unit also asserts exact produced result at `test/unit/transcript-artifact-coordinator.test.ts:192`-`:198` | PASS |
| EDGE-07 | Crash duplicate recovery retains oldest and fails every later owner without provider work | `test/unit/file-job-repository.test.ts:244`-`:258` exact repair, fixed failure, oldest owner and zero artifact call | PASS |
| EDGE-08 | Invalid job ID/cache key accesses no filesystem path | `test/unit/file-artifact-store.test.ts:330`-`:344` strict errors and zero reads; repository zero-I/O assertions at `test/unit/file-job-repository.test.ts:400`-`:408` | PASS |

**Spec-anchored status**: 36/46 matched; 5 implementation failures and 5
evidence/discrimination gaps. No spec-precision gap was found:
the failed requirements are precise enough to implement and test.

---

## Edge Cases

- EDGE-01: GAP, no hit-at-cap proof; M18 survived.
- EDGE-02: GAP, no provider non-call proof in transcript-only recovery; M09 survived.
- EDGE-03: PASS.
- EDGE-04: PASS.
- EDGE-05: PASS.
- EDGE-06: PASS.
- EDGE-07: PASS.
- EDGE-08: PASS.

---

## Gate Check

- **Build gate**: `npm run check`
- **Result**: exit 0; lint, strict typecheck, tests, and build passed.
- **Tests**: 30 files, 412 passed, 0 failed, 0 skipped.
- **Unit**: 25 files, 316 passed.
- **Integration**: 5 files, 96 passed.
- **Baseline**: 215 tests before the feature.
- **Delta**: +197 tests.
- **Integrity**: no `.skip`, `.todo`, `.only`, `xit`, or `xdescribe`; diff has 4,343 test-line additions and 8 deletions. The only removed named test was replaced by the expanded metric-family count assertion.
- **Spec validator**: 0 errors, 0 warnings.
- **Tasks validator (`--strict`)**: 0 errors, 0 warnings.
- **Docker**: command unavailable locally; no container execution was claimed.
- **Railway**: no apply, deploy, variable mutation, or other remote mutation was performed.

---

## Discrimination Sensor

All mutations ran in detached temporary git worktrees at `ec69adc`. The real worktree was clean
before the sensor and clean after both worktrees were removed. No stash was used.

| ID | Semantic mutation | Target command and observed result | Result |
| --- | --- | --- | --- |
| M01 | Accept duplicate canonical languages instead of rejecting | `vitest transcript-request.test.ts`: duplicate assertion failed | KILLED |
| M02 | Sort languages in the key preimage, erasing preference order | `vitest transcript-request.test.ts`: exact default key and reorder distinction failed | KILLED |
| M03 | Increment start revision by two | `vitest job.test.ts`: revision chain failed | KILLED |
| M04 | Expose persisted request in public job resource | `vitest job.test.ts`: exact resource/redaction assertion failed | KILLED |
| M05 | Remove file `sync()` before atomic rename | `vitest atomic-file-writer.test.ts`: event order and injected fsync failure assertions failed | KILLED |
| M06 | Accept arbitrary cache-key text | `vitest atomic-file-writer.test.ts`: strict SHA/path rejection failed | KILLED |
| M07 | Require both size and checksum mismatch instead of either | `vitest file-artifact-store.test.ts`: size-corrupt bundle was returned | KILLED |
| M08 | Expire only after, not at, exact TTL boundary | `vitest file-artifact-store.test.ts`: boundary returned a bundle | KILLED |
| M09 | Call `produceRequired` in transcript-only restart before local PDF recovery | `vitest durable-job-worker.test.ts`: 9/9 passed | SURVIVED |
| M10 | Reject queue only when active count is greater than cap | `vitest durable-job-coordinator.test.ts`: saturated miss resolved instead of 429 | KILLED |
| M11 | Change submission Retry-After from 2 to 3 | `vitest job-routes.test.ts`: all three disposition header assertions failed | KILLED |
| M12 | Remove authentication hook from job status route | `vitest job-routes.test.ts`: unauthenticated invalid ID returned 400 instead of 401 | KILLED |
| M13 | Change Railway Volume from 1024 to 2048 MB | `vitest railway-contract.test.ts`: exact resource assertion failed | KILLED |
| M14 | Recursively chown `/data` in entrypoint | `vitest container-contract.test.ts`: non-recursive command/argument assertions failed | KILLED |
| M15 | Remove `gosu` from runtime packages | `vitest container-contract.test.ts`: package and privilege-drop assertions failed | KILLED |
| M16 | Document automatic retry instead of no retry | `vitest durable-jobs-readme-contract.test.ts`: no-retry assertion failed | KILLED |
| M17 | Remove queued gauge update from new-miss submission | `vitest durable-job-coordinator.test.ts`: 14/14 passed | SURVIVED |
| M18 | Check queue capacity before completed cache lookup | `vitest durable-job-coordinator.test.ts`: 14/14 passed | SURVIVED |

**Sensor depth**: expanded high-risk manual sensor.
**Result**: 18 injected, 15 killed, 3 survived. FAIL.

---

## Code Quality

| Principle | Status | Evidence |
| --- | --- | --- |
| Minimum/surgical scope | PASS | Diff is confined to durable jobs/cache/runtime/IaC/docs and their tests. |
| Existing patterns/style | PASS | Biome and strict TypeScript pass. |
| No scope creep | PASS | No LanceDB/RAG implementation, database, bucket, or remote mutation was added. |
| Atomic task protocol | FAIL | T9 source/tests changed in a second commit after its marked-done commit. |
| Spec-anchored outcomes | FAIL | 10 requirements lack complete matching behavior/evidence. |
| Domain 1:1 and route edge/error coverage | FAIL | Recovery provider non-call, hit-at-cap, durable storage lookup 503, and lifecycle gauges are not discriminated. |
| Every in-scope test claimed | PASS | Tests map to task done-when criteria, spec requirements, or listed edge cases. |
| Project guidance | PASS | README Quality, package scripts, Vitest, Biome, and CI conventions were followed. |

---

## Ranked Gaps and Fix Tasks

1. **Blocker: bound and clean durable content lifecycle.** Add an artifact-store operation that
   removes the private work transcript under the same validated/locked boundary after successful
   completion and terminal failure. On completion-state persistence failure after bundle publication,
   remove/invalidate the cache pointer and bundle or reconcile to completed; never leave a failed
   producer as a shared cache entry. Add real-filesystem tests for both injected transition failures
   and work-directory cleanup. Covers WORK-07 and CACHE-04.
2. **Major: map durable cache/storage failures to the specified public contract.** Catch artifact
   lookup/storage errors in `DurableJobCoordinator.submit`, mark readiness unhealthy, and throw exact
   `DurableJobError('JOB_STORAGE_UNAVAILABLE', 503)`. Add route/integration assertions for exact body,
   503, zero record/provider work, and no private diagnostics. Covers STORE-06.
3. **Major: quarantine corrupt completed-job artifacts.** Make `readForJob` distinguish corruption
   from operational I/O, remove any cache pointer, quarantine corrupt content under an opaque name,
   and still return sanitized 503. Assert quarantine and content-free naming. Covers STORE-03.
4. **Major: make current-state gauges lifecycle-accurate.** Update queued and processing gauges after
   create, claim, every terminal transition, recovery and sweep, using true per-state counts rather
   than total active count. Add production-composition metric assertions. Covers OPS-04 and kills M17.
5. **Major: prove conservative recovery cannot repeat provider work.** Retain the transcript-only
   branch's provider mock and assert zero calls, exact one local render/publication, and unchanged
   transcript. Covers WORK-06/EDGE-02 and kills M09.
6. **Major: prove hit bypasses a full queue.** Add a completed verified bundle with active count at
   `MAX_QUEUED_JOBS`; assert hit/202/same ID and zero create/provider work. Covers CACHE-05 and EDGE-01 and kills M18.
7. **Minor: close the end-to-end expiry loop.** Sweep an expired completed job, retain its tombstone,
   submit the equivalent request, and assert a new miss/new UUID/one worker notification without
   sliding old expiry. Covers CACHE-07.
8. **Minor/process: restore TLC evidence.** Fold no code retroactively, but record the T9 protocol
   deviation and ensure future task commits pass formatting before marking complete. Persist a fresh
   read-only Railway config-plan summary before requesting apply approval for the Volume.

---

## Requirement Traceability Update

| Status | Requirements |
| --- | --- |
| Verified by this pass (36) | JOB-01..JOB-07, WORK-01..WORK-05, STORE-01, STORE-02, STORE-04, STORE-05, STORE-07, STORE-08, CACHE-01..CACHE-03, CACHE-06, CACHE-08, OPS-01..OPS-03, OPS-05..OPS-08, EDGE-03..EDGE-08 |
| Needs fix (5) | WORK-07, STORE-03, STORE-06, CACHE-04, OPS-04 |
| Needs test evidence (5) | WORK-06, CACHE-05, CACHE-07, EDGE-01, EDGE-02; WORK-06 and EDGE-02 share one missing non-call assertion, and CACHE-05/EDGE-01 share the hit-at-cap case |

The verifier did not edit `spec.md` statuses because the assigned real-tree write scope permits only
this report. The orchestrator should route these gaps to fix tasks and update traceability only in the
same atomic fix commits.

---

## Lessons Signal

Validation has grounded signal: three surviving mutants and failed/uncovered acceptance criteria.
The verifier did not mutate `.specs/lessons.json` or `.specs/LESSONS.md` because its explicit write
scope allows only `validation.md`. The fix/orchestration pass must record these project-local lessons
through `lessons.py`:

- Assert prohibited external calls in every recovery branch, not only the missing/complete branches.
- Assert lifecycle metrics through real state transitions, not only metric wrapper methods.
- Test cache-hit decision ordering at full capacity, not only join and miss ordering.
- Treat cleanup/quarantine/rollback as observable persistence outcomes with real-filesystem assertions.

---

## Summary

**Overall**: NOT READY

- **Spec-anchored check**: 36/46 matched; 10 requirements need fixes or complete evidence.
- **Gate**: 412 passed, 0 failed, 0 skipped.
- **Sensor**: 15/18 killed; 3 survived.
- **Remote state**: unchanged.
- **Next step**: implement the ranked fix tasks, then run a fresh independent re-verification.
