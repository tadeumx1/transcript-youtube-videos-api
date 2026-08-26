# Durable Transcript Jobs and Artifact Cache Validation - Round 2

**Verdict**: FAIL
**Date**: 2026-08-26
**Spec**: `.specs/features/durable-transcript-jobs/spec.md`
**Diff range**: `ee4aa46..2f730d2` (Round 1 fixes: `17bde79..2f730d2`)
**Verifier**: `/root/verify_durable_jobs_round2`, independent sub-agent (author != verifier and != Round 1 verifier)

The Round 1 fixes are effective and all 14 adversarial mutations were killed. The build gate passes
with 421 tests. The feature is still not ready: malformed identifiers/checksums inside an artifact
manifest are treated as operational storage failures instead of corruption, so the pointer remains,
the artifact is not quarantined, and an equivalent submission cannot become a new miss. A separate
publication-failure diagnostic also proves that a cache-pointer write failure leaves an unreachable
complete JSON/PDF bundle outside every TTL sweep.

---

## Task Completion

| Tasks | Status | Notes |
| --- | --- | --- |
| T1-T6, T8, T10-T15, T17-T22, T24-T27 | Done | Expected behavior, task evidence, commits, and gates are present. |
| T7 | Partial | Common corruption paths pass, but malformed manifest identifiers/checksums are not quarantined. |
| T9 | Partial | Functional sync/durable production passes. Pointer-publication failure leaves the final bundle behind. The historical second formatting commit `59a9d14` remains documented and cannot be made atomic retroactively. |
| T23 | Partial | Round 1 byte-corruption quarantine is fixed, but the broader STORE-03 manifest-corruption class remains open. |
| T16/T28 | Done, plan only | `.specs/features/durable-transcript-jobs/railway-plan.md:1` records `1 to add, 2 to change, 0 to destroy`; no apply/deploy/domain/variable mutation was run. |

All 31 commit subjects in `ee4aa46..2f730d2` pass `check_commit.py`. `git diff --check` passes.
The T9 atomic-protocol deviation is historical and explicitly preserved in this report; it is not
being rewritten or concealed.

---

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| JOB-01 | Valid authenticated submit returns exact 202 resource, Location, and Retry-After 2 | `test/integration/job-routes.test.ts:149` - `expect(response.statusCode).toBe(202)`; `:150-152` exact headers/body for miss, joined, hit | PASS |
| JOB-02 | Status returns exact public queued/processing/completed/failed resource | `test/integration/job-routes.test.ts:176` - `toBe(200)`; `:177` - `toEqual(resource(status))` across all states | PASS |
| JOB-03 | Completed JSON and PDF results preserve exact content and safe filename | `test/integration/job-routes.test.ts:196-203` - exact transcript, media headers, and `rawPayload.equals(pdf)` | PASS |
| JOB-04 | Active results are 409/Retry-After 2; failed is sanitized 409 without retry | `test/integration/job-routes.test.ts:288-296` and `:363-366` - exact status/body/header table | PASS |
| JOB-05 | Unknown valid UUID is 404; retained tombstone is 410 | `test/unit/durable-job-coordinator.test.ts:437-446` - exact codes/statuses and zero artifact access | PASS |
| JOB-06 | Bearer runs before validation/access and missing server auth fails closed | `test/integration/job-routes.test.ts:250-264` and `:375-391` - 401/503 before all coordinator calls | PASS |
| JOB-07 | Persisted/exposed failure is allowlisted, fixed, and redacted | `test/unit/job.test.ts:190-210` - exact public shape and prohibited-field absence; `:213-220` allowlist rejection | PASS |
| WORK-01 | Startup probes/initializes/recovers/starts one worker before ready | `test/unit/durable-job-coordinator.test.ts:466-477` - exact probe, initialize, recover, one start, and gauges | PASS |
| WORK-02 | FIFO worker obtains one permit before claim/work and propagates signal/metrics | `test/unit/durable-job-worker.test.ts:240-255` - exact transition/work/release/gauges; `test/unit/execution-controller.test.ts:151-165` - FIFO admission | PASS |
| WORK-03 | Saturation leaves job queued with no work or rejection metric | `test/unit/durable-job-worker.test.ts:220-224` - queued/no work; `test/unit/execution-controller.test.ts:153-165` - FIFO and zero rejection | PASS |
| WORK-04 | Stale/terminal ticks do no external or terminal overwrite work | `test/unit/durable-job-worker.test.ts:267-269` and `:287-290` - zero transitions/provider/publication | PASS |
| WORK-05 | Client disconnect does not cancel durable work; shutdown aborts and persists interruption | `test/integration/durable-http-app.test.ts:322-343` - submit settles after disconnect; `test/unit/durable-job-worker.test.ts:565-570` - interrupted/one release/stopped | PASS |
| WORK-06 | Recovery completes bundle, locally resumes transcript-only, or interrupts without provider retry | `test/unit/durable-job-worker.test.ts:464-477`, `:504-527`, `:534-548` - all three exact branches; `:512` explicit provider non-call | PASS |
| WORK-07 | Terminal paths release/update once and clean private work/listeners/timers | `test/unit/durable-job-worker.test.ts:248-255`, `:357-360`, `:428-446`; `test/unit/execution-controller.test.ts:231-237` - exact release, cleanup, rollback, listener cleanup | PASS |
| STORE-01 | Atomic files sync/close/rename/sync-directory and publish references last | `test/unit/atomic-file-writer.test.ts:121-131` - exact durability event order; `test/unit/file-artifact-store.test.ts:94-101` - pointer last | PASS |
| STORE-02 | Manifest has producer, versions, timestamps, sizes, checksums | `test/unit/file-artifact-store.test.ts:105-122` - exact manifest and pointer values | PASS |
| STORE-03 | Every schema/size/checksum/incomplete corruption is pointer-invalidated, quarantined opaquely, and never returned | Existing assertions cover schema/size/byte checksum/partial at `test/unit/file-artifact-store.test.ts:139-164` and pointer-first byte corruption at `:197-210`. No assertion covers malformed manifest SHA/UUID. Diagnostic against `src/infrastructure/storage/file-artifact-store.ts:529` and catches at `:394-400`/`:411-419` returned `ArtifactStorageError` with `pointer=true`, `quarantine=[]`. | FAIL |
| STORE-04 | Completed missing/corrupt reference is sanitized 503 without retranscription | `test/unit/file-artifact-store.test.ts:197-203` and `:217-230`; `test/unit/durable-job-coordinator.test.ts:449-459` - exact storage error | PASS |
| STORE-05 | Startup cleans temps, quarantines corrupt records, repairs duplicate owners | `test/unit/file-job-repository.test.ts:218-223` - cleanup/quarantine; `:250-264` - oldest owner and fixed interruption | PASS |
| STORE-06 | Unavailable/full/read-only storage drops readiness and miss returns sanitized 503 while health stays callable | `test/unit/file-artifact-store.test.ts:351-384` - ENOSPC/EROFS and recovery; `test/integration/application-composition.test.ts:317-340` - exact 503/readiness/recovery | PASS |
| STORE-07 | Per-key lock prevents read/delete race and pointer is removed before content | `test/unit/file-artifact-store.test.ts:341-348` - read completes before expiry; `test/unit/file-job-repository.test.ts:293-300` - artifact expiry before tombstone | PASS |
| STORE-08 | Strict UUID/SHA paths are confined and invalid input touches no filesystem | `test/unit/atomic-file-writer.test.ts:192-203`; `test/unit/file-artifact-store.test.ts:396-410` - exact paths/rejections and zero reads | PASS |
| CACHE-01 | SHA-256 identity uses exact versions/video/language order and exposes no preimage | `test/unit/transcript-request.test.ts:19-26` - exact key/versions; `:70-73` - preimage fields absent and recomputation exact | PASS |
| CACHE-02 | Defaults/case/order/duplicates canonicalize exactly before dependencies | `test/unit/transcript-request.test.ts:33-44`, `:55-58`; `test/integration/job-routes.test.ts:237-242` - exact lists/keys and zero submit | PASS |
| CACHE-03 | Concurrent equivalent misses create one job/worker and return miss+joined same ID | `test/unit/durable-job-coordinator.test.ts:217-238` - exact responses, one create, one notify | PASS |
| CACHE-04 | Active/completed owners join/hit; failed/corrupt/expired state permits new work and failures never cache | Normal active/hit/failed assertions pass at `test/unit/durable-job-coordinator.test.ts:255-260`, `:267-275`, `:350-358`. Malformed-manifest diagnostic at `src/infrastructure/storage/file-artifact-store.ts:391-400` throws storage 503 and keeps the pointer instead of returning a miss, so corrupt state is not eligible for new work. | FAIL |
| CACHE-05 | Cap rejects only a new miss; joined and hit bypass exact capacity | `test/unit/durable-job-coordinator.test.ts:278-302` - hit at exact cap; `:324-347` - exact miss rejection/no work | PASS |
| CACHE-06 | Cached metadata/PDF bytes are exact and reads do not slide expiry | `test/unit/file-artifact-store.test.ts:131-136`; `test/integration/durable-http-app.test.ts:210-219` - exact values/bytes and unchanged pointer | PASS |
| CACHE-07 | Completed/failed/tombstone TTLs remove retained content and later equivalent submit creates new UUID/work | Normal path is asserted at `test/integration/application-composition.test.ts:378-436`. Pointer-write failure after `src/infrastructure/storage/file-artifact-store.ts:345` leaves the final bundle because catch cleanup at `:355-358` removes only the renamed-away temporary path; diagnostic found manifest/JSON/PDF with no pointer or job, so no sweep can enforce its TTL. | FAIL |
| CACHE-08 | Sync endpoints reuse/publish cache while preserving auth/admission/cancel/error contracts | `test/integration/durable-http-app.test.ts:210-219`, `:262-268`, `:289-293` - exact hit, fail-open write error, and saturation | PASS |
| OPS-01 | Durable configuration defaults/bounds/errors are exact and sanitized | `test/unit/config.test.ts:47-54`, `:84-100`, `:134-157` - defaults, every bound, exact variable-only errors | PASS |
| OPS-02 | Railway has one 1024 MB Volume at /data, one replica, preserved secrets, no extra storage | `test/unit/railway-contract.test.ts:26-54`, `:62-73` - exact topology and prohibited-resource absence | PASS |
| OPS-03 | Ready is exact 200 only with lifecycle/storage/worker ready; otherwise exact 503 without network | `test/integration/durable-http-app.test.ts:162-183`; `test/integration/application-composition.test.ts:288-299` - exact readiness/liveness and zero provider work | PASS |
| OPS-04 | Fixed-label metrics report accurate queued/processing lifecycle, terminal/cache/recovery/storage values | `test/integration/application-composition.test.ts:246-262` - real queued/processing/completed gauges; `test/unit/runtime-metrics.test.ts:100-110`, `:126-142` - families and redaction | PASS |
| OPS-05 | OpenAPI 1.1 has nine-route parity, exact job schemas/statuses/headers/security, no secrets | `test/integration/openapi.test.ts:113-145`, `:164-170`, `:294-348`, `:363-368` - exact version/parity/security/contracts/redaction | PASS |
| OPS-06 | Logs/errors use fixed fields and omit protected identifiers/content/diagnostics | `test/integration/durable-http-app.test.ts:374-379`; `test/unit/runtime-metrics.test.ts:126-142` - prohibited values absent | PASS |
| OPS-07 | Local root is ignored/temp-replaceable and deterministic gates need no provider/network | `test/integration/application-composition.test.ts:107-113`; `test/unit/storage-ignore-contract.test.ts:24-39` - startup root and git-ignore contract | PASS |
| OPS-08 | Docs state TTL/topology/retry/backup/LanceDB contracts | `test/unit/durable-jobs-readme-contract.test.ts:49-62`, `:68-90` - exact defaults, no retry, Volume/replica/downtime/backup/namespaces | PASS |
| EDGE-01 | Joined and hit succeed while queue is full | `test/unit/durable-job-coordinator.test.ts:241-260`, `:278-302` - both dispositions bypass cap | PASS |
| EDGE-02 | Transcript-only restart renders/publishes locally and never calls provider | `test/unit/durable-job-worker.test.ts:504-523` - provider zero, one render/publication, unchanged transcript | PASS |
| EDGE-03 | Uncertain external side effect without transcript becomes interrupted without retry | `test/unit/durable-job-worker.test.ts:534-544` - exact failed state and zero provider/render/publish | PASS |
| EDGE-04 | Concurrent read/expiry yields complete bytes or absence, never partial | `test/unit/file-artifact-store.test.ts:334-348` - expiry blocks until complete read resolves | PASS |
| EDGE-05 | Case/default equivalence deduplicates; preference order changes identity | `test/unit/transcript-request.test.ts:29-44` - exact same/different keys | PASS |
| EDGE-06 | Sync cache failure preserves produced response and is sanitized/observable | `test/integration/durable-http-app.test.ts:262-268` - 200 exact transcript, write_failed metric, no path text | PASS |
| EDGE-07 | Duplicate recovery retains oldest and interrupts later owners without provider work | `test/unit/file-job-repository.test.ts:250-264` - exact repaired owner/failure and zero artifact call | PASS |
| EDGE-08 | Invalid job/cache identifiers touch no filesystem path | `test/unit/file-artifact-store.test.ts:396-410`; `test/unit/file-job-repository.test.ts:406-414` - strict errors and zero reads | PASS |

**Spec-anchored status**: 43/46 matched. STORE-03, CACHE-04, and CACHE-07 need fixes.
No spec-precision gap was found.

---

## Gate Check

- **Build gate**: `npm run check`, exit 0.
- **Result**: lint, strict typecheck, tests, and production build passed.
- **Tests**: 30 files, 421 passed, 0 failed, 0 skipped.
- **Unit**: 25 files, 322 passed.
- **Integration**: 5 files, 99 passed.
- **Baseline**: 215 tests before this feature; delta +206.
- **Integrity**: no `.skip`, `.todo`, `.only`, `xit`, `xdescribe`, or `SPEC_DEVIATION` marker in source/tests.
- **Validators**: spec 0 errors/0 warnings; tasks strict 0 errors/0 warnings; `git diff --check` clean.
- **Docker**: unavailable locally. No runtime container claim was made; static contracts pass and CI remains authoritative.
- **Railway**: plan evidence persisted. No config apply, deploy, domain, variable write, or other remote mutation ran.

---

## Discrimination Sensor

All mutations ran one at a time in detached worktree `/home/matheus/durable-transcript-sensor-round2`
at `2f730d2`. The worktree was removed. No stash was used. Real-tree porcelain was empty before and
after the sensor.

| ID | Semantic mutation | Target evidence | Result |
| --- | --- | --- | --- |
| M01 | Call provider production during transcript-only recovery (Round 1 M09 equivalent) | Worker test failed explicit zero-call assertion at `test/unit/durable-job-worker.test.ts:512` | KILLED |
| M02 | Add one to queued lifecycle gauge (Round 1 M17 equivalent) | Worker exact gauge assertions and composition lifecycle gauge failed | KILLED |
| M03 | Check queue cap before completed-cache lookup (Round 1 M18 equivalent) | Hit-at-cap test rejected instead of resolving at `test/unit/durable-job-coordinator.test.ts:293` | KILLED |
| M04 | Remove success-path private-work cleanup | Real-filesystem work manifest remained; `test/unit/durable-job-worker.test.ts:357` failed | KILLED |
| M05 | Remove pointer/bundle rollback after completion transition failure | Exact rollback ordering failed at `test/unit/durable-job-worker.test.ts:428` | KILLED |
| M06 | Re-throw raw cache lookup error and keep readiness true | Unit sanitized error/readiness and integration 503 assertions failed | KILLED |
| M07 | Quarantine corrupt completed bundle before removing its pointer | Pointer-first event assertion failed at `test/unit/file-artifact-store.test.ts:205` | KILLED |
| M08 | Expire jobs only after, not at, exact TTL boundary | Repository boundaries and resubmit/new-UUID integration failed | KILLED |
| M09 | Remove authentication from status route | Unauthenticated invalid UUID returned 400 instead of 401 | KILLED |
| M10 | Remove file `sync()` before atomic rename | Durability event and injected fsync-failure assertions failed | KILLED |
| M11 | Change Railway Volume from 1024 to 2048 MB | Exact IaC contract failed | KILLED |
| M12 | Recursively chown `/data` in entrypoint | Fixed non-recursive command and argument-log assertions failed | KILLED |
| M13 | Sort languages in cache preimage, erasing caller preference | Exact default key and reorder distinction failed | KILLED |
| M14 | Require both size and checksum mismatch instead of either | Size-corrupt bundle was returned and test failed | KILLED |

**Sensor depth**: expanded high-risk manual sensor.
**Result**: 14 injected, 14 killed, 0 survived. PASS.

---

## Independent Diagnostics

Both diagnostics used unique OS temporary directories and removed them. They did not edit the real
tree.

1. A valid bundle manifest was changed to contain an invalid cache key/SHA field. `readForJob` and
   `find` returned sanitized `ArtifactStorageError`, but the observable result was
   `pointer=true, quarantine=[]`. Root cause: validators called by
   `src/infrastructure/storage/file-artifact-store.ts:529` throw `TypeError`; the corruption catches
   at `:394` and `:411` do not classify `TypeError` as corruption.
2. A cache-pointer `writeJson` failure was injected after directory publication. The store rejected
   with `ArtifactStorageError` and no pointer, but `v1/artifacts/<shard>/<artifactId>/manifest.json`,
   `transcript.json`, and `transcript.pdf` remained. Root cause: after rename at
   `src/infrastructure/storage/file-artifact-store.ts:345`, catch cleanup at `:356` removes only the
   former temporary path, never the final target.

---

## Code Quality

| Principle | Status | Evidence |
| --- | --- | --- |
| Minimum/surgical scope | PASS | Diff stays inside durable jobs/cache/runtime/IaC/docs and tests. |
| Existing patterns/style | PASS | Biome, strict TypeScript, build, and all tests pass. |
| No scope creep | PASS | No RAG/LanceDB implementation, database, bucket, deploy, or remote mutation. |
| Spec-anchored outcomes | FAIL | Three persistence/cache outcomes fail under precise corruption/publication faults. |
| Per-layer coverage | FAIL | Malformed manifest validators and post-rename pointer failure have no assertions. |
| Atomic task protocol | HISTORICAL DEVIATION | T9 received formatting commit `59a9d14` after its task commit; documented, not repeated in fixes. |
| Project guidance | PASS | README Quality, package scripts, Vitest, Biome, and CI conventions were followed. |

---

## Ranked Gaps and Fix Tasks

1. **Blocker: classify every manifest corruption before operational I/O mapping.** Normalize
   `TypeError` from strict manifest UUID/SHA validators, plus missing child files under an existing
   artifact directory, into the internal corruption class. Remove the owned pointer first,
   quarantine the artifact under an opaque name, and return a miss from cache lookup; keep true EIO
   as sanitized 503 without quarantine. Add real-filesystem tests for invalid manifest `cacheKey`,
   `artifactId`, `producerJobId`, checksum, and partial child content through both `find` and
   `readForJob`. Covers STORE-03 and CACHE-04.
2. **Major: roll back the final bundle when cache-pointer publication fails.** Track whether the
   target directory was published. If pointer publication fails, delete only that new target under
   the same key lock, preserving any prior pointer/bundle. Add an injected pointer-write failure
   test that asserts no orphan manifest/JSON/PDF survives, a later request is a clean miss, and an
   unrelated/prior bundle remains intact. Covers CACHE-07 and T9's no-bundle-on-failure criterion.

After these fixes, dispatch a third fresh verifier and re-run the expanded sensor. The verifier did
not mutate `.specs/lessons.json` because the assigned real-tree write scope permits only this report;
the orchestrator must distill the two grounded persistence lessons through `lessons.py`.

---

## Requirement Traceability

| Status | Requirements |
| --- | --- |
| Verified (43) | JOB-01..JOB-07; WORK-01..WORK-07; STORE-01, STORE-02, STORE-04..STORE-08; CACHE-01..CACHE-03, CACHE-05, CACHE-06, CACHE-08; OPS-01..OPS-08; EDGE-01..EDGE-08 |
| Needs fix (3) | STORE-03, CACHE-04, CACHE-07 |

## Summary

**Overall**: NOT READY

- **Spec-anchored check**: 43/46 matched; no spec-precision gaps.
- **Gate**: 421 passed, 0 failed, 0 skipped.
- **Sensor**: 14/14 killed; 0 survived; isolation preserved.
- **Remote state**: unchanged; Railway apply still requires separate exact-plan approval.
- **Next step**: implement the two ranked fix tasks, then run independent Round 3 verification.
