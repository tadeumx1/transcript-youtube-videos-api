# Production Runtime Hardening Validation — PASS

**Date**: 2026-08-26
**Spec**: `.specs/features/production-runtime-hardening/spec.md`
**Diff range**: `c082d99..50bf84f`
**Verifier**: independent verifier, iteration 2 (author != verifier)
**Result**: PASS

All 46 requirements match precise spec outcomes. The clean build gate passes 215/215 tests. The
expanded discrimination sensor killed all six mutants, including the three regression classes that
survived iteration 1.

## Task Completion

| Task | Status | Commit | Independent check |
| --- | --- | --- | --- |
| T1 | Done | `6f55556` | Config defaults, bounds, sanitization, docs, and tests pass. |
| T2 | Done | `91f584b` | Five isolated fixed-label metric families and tests pass. |
| T3 | Done | `e871ef2` | Capacity, idempotent permits, readiness, and shutdown tests pass. |
| T4 | Done | `c21db53` | Timeout, kill fallback, races, cleanup, and stderr bounds pass. |
| T5 | Done | `15b8495` | Process policies, cancellation, typed errors, and directory cleanup pass. |
| T6 | Done | `f6d48eb` | Muse classification, Retry-After, no retry, timeout, and redaction pass. |
| T7 | Done | `bf1b429` | Cancellation and closed-label telemetry propagation pass. |
| T8 | Done | `05b22d7` | HTTP admission, lifecycle, metrics auth, release, and redaction pass. |
| T9 | Done | `b8be57d` | OpenAPI validation, parity, schemas, security, and redaction pass. |
| T10 | Done | `2187f6c` | Source and non-publishing container CI contracts pass. |
| T11 | Done | `94fa5d0` | Ordered, bounded, non-bypass runbook contract passes. |
| T12 | Done | `ed7c6fd` | Success/failure AbortSignal listener cleanup is discriminated. |
| T13 | Done | `ba18c09` | Job/step fail-closed semantics are discriminated. |
| T14 | Done | `50bf84f` | Every transcript diagnostic body sink is discriminated. |

No task is blocked or partial in `tasks.md`.

## Spec-Anchored Acceptance Criteria

Evidence is accepted only when the cited assertion checks the exact spec outcome. Conjunctive
requirements cite every material conjunct.

| Requirement | Spec-defined outcome | Exact test evidence (`file:line` + assertion expression) | Result |
| --- | --- | --- | --- |
| HARD-01 | Authenticated JSON/PDF work below the shared cap reserves one shared slot before provider work. | `test/unit/execution-controller.test.ts:20` — `expect(jsonPermit).toBeDefined()`; `:21` — PDF permit defined; `:23` — active count equals 2; `test/integration/http-app.test.ts:304` — exactly two admitted provider calls at cap 2. | PASS |
| HARD-02 | Overflow returns 429, `TRANSCRIPT_CAPACITY_EXCEEDED`, `Retry-After: 30`, and starts no new dependency work. | `test/integration/http-app.test.ts:253` — status 429; `:254` — header `30`; `:255` — exact error code; `:261` — provider remains one call; `:262` — PDF renderer not called. | PASS |
| HARD-03 | Every terminal path releases its permit exactly once. | `test/unit/execution-controller.test.ts:48` — active count 0 after repeated release; `:49` — gauge calls exactly `[[1], [0]]`; `test/integration/http-app.test.ts:273`, `:374`, and `:505` — a new request succeeds after success, application/PDF failures, and client cancellation. | PASS |
| HARD-04 | Health, ready, OpenAPI, and authenticated metrics bypass admission during saturation. | `test/integration/http-app.test.ts:390` — health OK; `:391` — ready 200; `:393` — metrics 200; `:396` — OpenAPI 200; `:397` — held provider call remains exactly one. | PASS |
| HARD-05 | Missing capacity defaults to 1; only integer values 1-32 pass; invalid values fail with sanitized validation. | `test/unit/config.test.ts:36` — default object contains capacity 1; `:64` — exact boundary values including 1 and 32; `:100` — invalid matrix throws a variable-name-only bounded-integer message. | PASS |
| HARD-06 | Unauthorized/schema-invalid saturated requests preserve auth/validation order and consume no slot. | `test/integration/http-app.test.ts:336` — unauthorized 401; `:337` — invalid schema 400; `:338` — provider remains one call; `:339` — renderer not called. | PASS |
| PROC-01 | yt-dlp/FFmpeg use 300000/900000 ms; timeout sends SIGTERM and returns sanitized 504 `AUDIO_PROCESS_TIMEOUT`. | `test/unit/audio-media-pipeline.test.ts:44` and `:59` — exact default runner options; `test/unit/process-runner.test.ts:124` — exact 504/code; `:130` — exactly one SIGTERM; `:214`-`:215` — public message is sanitized. | PASS |
| PROC-02 | Shutdown/request cancellation sends SIGTERM and returns stable `AUDIO_PROCESS_ABORTED`. | `test/unit/process-runner.test.ts:164` — exact 503/code; `:170` — exactly one SIGTERM; `test/integration/http-app.test.ts:446` and `:497` — shutdown and client-close signals become aborted. | PASS |
| PROC-03 | A still-open child receives SIGKILL exactly once after the 5000 ms grace. | `test/unit/process-runner.test.ts:146` — timers advance past grace; `:149` — exact `SIGTERM`, `SIGKILL` sequence; `:151` — exactly two total kills. | PASS |
| PROC-04 | Races settle once and clear timers, process/stderr listeners, and the exact AbortSignal listener. | `test/unit/process-runner.test.ts:193`-`:200` — one rejection, zero fulfillment, zero process/stderr listeners and timers; `:253`-`:256` — success removes the exact registered abort listener once; `:273`-`:276` — failure does the same. Sensor M1 killed removal of cleanup. | PASS |
| PROC-05 | Internal stderr is capped at 16384 characters and absent from public errors/logs. | `test/unit/process-runner.test.ts:213` — exact length 16384; `:214`-`:215` — fixed public message excludes sensitive stderr; `:104` — diagnostic field is not public enumerable output. | PASS |
| PROC-06 | Timeout/abort preserves typed errors and removes the request directory. | `test/unit/audio-media-pipeline.test.ts:157` — exact typed object for timeout/abort cases; `:162` — exact recursive forced cleanup; `:180`-`:185` — post-conversion abort code/status and cleanup. | PASS |
| PROC-07 | A pre-aborted signal rejects without spawning. | `test/unit/process-runner.test.ts:113` — exact 503/code; `:116` — spawn not called. | PASS |
| PROV-01 | Muse 401/403 returns 503 `MUSE_AUTHENTICATION_FAILED` with no retry. | `test/unit/muse-audio-transcriber.test.ts:183` — exact status/code; `:188` — fetch called once. | PASS |
| PROV-02 | Muse 429 returns 429 `MUSE_QUOTA_EXCEEDED`, copies only valid bounded Retry-After, and does not retry. | `test/unit/muse-audio-transcriber.test.ts:204`-`:208` — exact code/status/120 seconds; `:209`-`:212` — only owned metadata and one fetch; `:245`-`:247` — invalid/unbounded headers are discarded with one fetch. | PASS |
| PROV-03 | Muse timeout returns 504 `MUSE_TIMEOUT` with no retry. | `test/unit/muse-audio-transcriber.test.ts:292`-`:295` — exact status/code; `:300` — one fetch; `:301` — zero timers. | PASS |
| PROV-04 | Muse 5xx/network failures return 502 `MUSE_UPSTREAM_UNAVAILABLE` with no retry. | `test/unit/muse-audio-transcriber.test.ts:255`-`:260` — exact 5xx outcome and one fetch; `:271`-`:277` — exact network outcome, redaction, and one fetch. | PASS |
| PROV-05 | Malformed JSON/shape or empty output returns 502 `MUSE_INVALID_RESPONSE` with no retry. | `test/unit/muse-audio-transcriber.test.ts:131`-`:137` — exact outcome for empty/unsupported shapes and one call; `:342`-`:348` — malformed JSON exact outcome, redaction, and one fetch. | PASS |
| PROV-06 | Muse failures exclude credentials, provider bodies, Base64, transcript, and nested causes. | `test/unit/muse-audio-transcriber.test.ts:185`-`:188` — auth error excludes key/body/Base64/transcript and calls once; `:276` — network error excludes key/auth/body; `test/integration/http-app.test.ts:623`-`:624` — public responses exclude provider detail and nested cause. | PASS |
| PROV-07 | Non-Muse caption failures retain YouTube classification and never enter fallback. | `test/unit/hybrid-transcript-service.test.ts:103` — same YouTube error object rejected; `:104` — transcriber not called. | PASS |
| OBS-01 | Ready lifecycle returns 200 `{status:'ready'}` without external work. | `test/integration/http-app.test.ts:391`-`:392` — exact status/body; `:397` — operational probes do not increase the held provider call. | PASS |
| OBS-02 | Shutdown readiness returns 503 `{status:'not_ready'}`. | `test/integration/http-app.test.ts:462`-`:464` — exact status/body and no provider call. | PASS |
| OBS-03 | Authenticated metrics expose active jobs, capacity rejections, source, stage duration, and stage failure. | `test/unit/runtime-metrics.test.ts:10` — exact five metric family names; `test/integration/http-app.test.ts:393`-`:395` — status, Prometheus content type, and active gauge. | PASS |
| OBS-04 | Metrics without valid configured Bearer auth return existing 401 or fail-closed 503 envelopes. | `test/integration/http-app.test.ts:410`-`:415` — exact 401/503 envelopes; `:421` — no transcript call. | PASS |
| OBS-05 | Metric labels use only fixed route/stage/source/outcome/reason values and contain no sensitive dynamic values. | `test/unit/runtime-metrics.test.ts:84`-`:90` — every unknown dynamic dimension maps to `unknown`; `:92` — rendered output excludes video/language/URL/error/secret fixtures. | PASS |
| OBS-06 | Request/stage logs exclude auth, bodies, transcript/PDF/audio/provider content, and secrets. | `test/integration/http-app.test.ts:717`-`:725` — logs exclude video ID, transcript, PDF bytes, provider message/cause, configured key, and supplied credential; `test/unit/runtime-metrics.test.ts:92` — labels exclude sensitive fixtures. | PASS |
| OBS-07 | Unrecognized metric values map to `unknown`. | `test/unit/runtime-metrics.test.ts:84`-`:90` — exact rendered `unknown` labels for every dynamic dimension. | PASS |
| API-01 | Public OpenAPI is valid 3.1 with API version 1.0.0. | `test/integration/openapi.test.ts:81` — 200; `:88`-`:89` — exact OpenAPI/API versions; `:96` — parser resolves valid. Sensor M6 killed version `3.0.0`. | PASS |
| API-02 | Five operations describe actual methods, bodies, media types, and statuses. | `test/integration/openapi.test.ts:109`-`:110` — route parity and exact operation list; `:189`-`:211` — required JSON body, success/PDF/metrics media, and exact statuses. | PASS |
| API-03 | Protected operations use HTTP Bearer; health/readiness/OpenAPI are public. | `test/integration/openapi.test.ts:122`-`:134` — exact Bearer scheme and per-operation security; `:138` — public OpenAPI 200. | PASS |
| API-04 | Schemas contain all transcript/segment fields, variants, and stable public codes. | `test/integration/openapi.test.ts:149`-`:170` — exact required fields and enums; `:219` — stable complete schema snapshot. | PASS |
| API-05 | OpenAPI contains no environment values, credentials, production host, content, or provider diagnostics. | `test/integration/openapi.test.ts:228`-`:233` — six exact negative assertions. | PASS |
| API-06 | Registered route/schema changes break contract parity. | `test/integration/openapi.test.ts:109`-`:110` — documented operations equal registered operations and the exact five-operation list. | PASS |
| API-07 | OpenAPI generation is deterministic without production variables. | Gate process had both credential variables absent; `test/integration/openapi.test.ts:219` — stable snapshot; `:228`-`:229` — environment and credential values excluded. | PASS |
| CI-01 | Main pushes and pull requests run `npm ci`, then `npm run check`, on Node 22. | `test/unit/ci-contract.test.ts:47`-`:58` — exact triggers, Node/cache settings, and ordered commands. | PASS |
| CI-02 | A dependent source-success job builds the checked-in Dockerfile without publishing. | `test/unit/ci-contract.test.ts:66`-`:76` — exact name/dependency/actions and `{ context: '.', file: 'Dockerfile', push: false }`. | PASS |
| CI-03 | Deterministic gates run without provider credentials or provider calls. | Gate passed with both credential variables absent; `test/unit/ci-contract.test.ts:94`-`:97` — workflow excludes secrets, credential names, and environment injection. | PASS |
| CI-04 | CI uses lockfile-backed npm cache and read-only contents permission. | `test/unit/ci-contract.test.ts:49` — exact read-only permission; `:51`-`:55` — exact Node 22/npm/lockfile cache configuration. | PASS |
| CI-05 | Any source/container failure fails CI; branch check names are documented. | `test/unit/ci-contract.test.ts:83`-`:87` — every job and step forbids `continue-on-error: true`; `:111`-`:113` — both check names and branch protection documented. Sensors M2 and M3 killed source and Docker `continue-on-error`. | PASS |
| CI-06 | Workflow YAML parses and referenced scripts/lockfile/Dockerfile exist. | `test/unit/ci-contract.test.ts:34`-`:36` — YAML parse; `:106`-`:110` — lockfile, Dockerfile, and exact check script. | PASS |
| CI-07 | Without local Docker, source gates still pass and CI remains the authoritative container gate. | `command -v docker` returned unavailable while `npm run check` passed; `test/unit/ci-contract.test.ts:62`-`:77` validates the dependent, checked-in, non-publishing container job. | PASS |
| OPS-01 | Runbook orders platform/readiness/auth, captions, yt-dlp, FFmpeg, and Muse diagnosis. | `test/unit/youtube-blocking-runbook-contract.test.ts:22`-`:23` — every stage exists and positions equal sorted order. | PASS |
| OPS-02 | Diagnostic commands bound runtime/output, use placeholders, and never print transcript/audio/secret/provider content. | `test/unit/youtube-blocking-runbook-contract.test.ts:24`-`:33` — command count, time bounds, placeholders, output cap, and no real video ID; `:41`-`:48` — every transcript/PDF command exists and has an explicit `/dev/null` body sink. Sensor M4 killed sink removal. | PASS |
| OPS-03 | Runbook distinguishes platform, YouTube, media, timeout, and Muse failures with sanitized codes. | `test/unit/youtube-blocking-runbook-contract.test.ts:53`-`:72` — every exact code, platform status, and provider distinction is required. | PASS |
| OPS-04 | Only public videos without account state are supported; bypass guidance is forbidden. | `test/unit/youtube-blocking-runbook-contract.test.ts:78`-`:86` — exact support policy, incompatible techniques, and prohibited guidance assertions. | PASS |
| OPS-05 | Healthy API versus blocked YouTube remains distinct; Bearer, timeouts, and capacity stay enforced. | `test/unit/youtube-blocking-runbook-contract.test.ts:71`-`:72` — platform/provider distinction; `:87`-`:89` — exact preservation rules; `:95`-`:100` — README preserves auth and limit controls. | PASS |

**Traceability result**: 46/46 requirements have complete spec-anchored evidence. There are zero
test-evidence gaps and zero spec-precision gaps.

| Area | Matched | Total | Gaps |
| --- | ---: | ---: | --- |
| HARD | 6 | 6 | None |
| PROC | 7 | 7 | None |
| PROV | 7 | 7 | None |
| OBS | 7 | 7 | None |
| API | 7 | 7 | None |
| CI | 7 | 7 | None |
| OPS | 5 | 5 | None |
| **Total** | **46** | **46** | **None** |

## Edge Cases

All six listed edge cases are included in the 46-row table: HARD-06, PROC-07, PROV-07, OBS-07,
API-07, and CI-07. Each assertion targets the exact expected outcome.

## Gate Check

- **Structural gates**: `validate_spec.py` and strict `validate_tasks.py` both reported 0 errors and
  0 warnings.
- **Baseline**: detached `c082d99` worktree, 10 files and 83/83 tests passed, 0 failed, 0 skipped.
- **Current command**: `npm run check` at `50bf84f` in the real tree.
- **Current result**: Biome checked 37 files; typecheck passed; 15 files and 215/215 tests passed;
  build passed; 0 failed and 0 skipped.
- **Delta**: +132 tests. No test file was deleted. The pre-feature video-ID log assertion was
  strengthened to assert absence.
- **Credentials**: `OPENCODE_API_KEY` and `API_ACCESS_KEY` were absent from the gate process.
- **Skip audit**: Vitest reported none; static search found no `.skip`, `.todo`, disabled test, or
  `SPEC_DEVIATION` marker in scope.
- **Docker**: unavailable locally. CI-07 deliberately keeps source checks executable and the
  checked-in CI container build authoritative.

## Discrimination Sensor

The expanded sensor used a detached worktree at `50bf84f` under a unique `/tmp` directory. Each
mutated file was restored from HEAD before the next mutation. The scratch worktree and temporary
directory were removed. The real-tree porcelain matched its empty pre-sensor baseline after cleanup,
and `git worktree list --porcelain` contained only the real worktree.

| ID | Mutation | Relevant test result | Killed? |
| --- | --- | --- | --- |
| M1 | Removed `options.signal?.removeEventListener('abort', onAbort)` from `src/infrastructure/audio/process-runner.ts:119`. | `process-runner.test.ts` failed at `:256` and `:276`; removal was observed in both success and failure. | Killed |
| M2 | Added `continue-on-error: true` to the `npm run check` step in `.github/workflows/ci.yml:29`. | `ci-contract.test.ts` failed at `:86`. | Killed |
| M3 | Added `continue-on-error: true` to the Docker build step in `.github/workflows/ci.yml:42`. | `ci-contract.test.ts` failed at `:86`. | Killed |
| M4 | Removed `--output /dev/null` from the `/v1/transcripts` diagnostic in `docs/runbooks/youtube-datacenter-blocking.md:22`. | `youtube-blocking-runbook-contract.test.ts` failed at `:47` and printed the unsafe command in the assertion diff. | Killed |
| M5 | Changed the capacity comparison from `>=` to `>` in `src/application/execution-controller.ts:34`. | `execution-controller.test.ts` failed at `:22`; overflow returned a permit. | Killed |
| M6 | Changed OpenAPI from `3.1.0` to `3.0.0` in `src/http/openapi.ts:211`. | `openapi.test.ts` had three failures, including exact version mismatch at `:256`. | Killed |

**Sensor depth**: expanded manual high-risk sensor.
**Result**: 6 mutations injected, 6 killed, 0 survived — PASS.

## Code Quality and Test Necessity/Sufficiency

| Check | Result | Evidence |
| --- | --- | --- |
| Minimum code / no speculative abstraction | PASS | Runtime primitives are small, application-owned components. |
| Surgical scope / no unrelated cleanup | PASS | Changed files map to T1-T14, dependency locks, documentation, tests, or TLC evidence. |
| Existing patterns and style | PASS | Biome, TypeScript, Vitest, Fastify injection, adapters, and dependency injection remain consistent. |
| No test weakening/deletion | PASS | Test count rose from 83 to 215; no test file was deleted; the changed log assertion is stricter. |
| Test necessity | PASS | Feature tests map to an AC, listed edge case, or approved Done-when regression contract. |
| Per-layer coverage | PASS | Domain/process, provider, HTTP, OpenAPI, CI, and runbook outcomes are directly asserted. |
| Spec-anchored asserted values | PASS | 46/46 precise outcomes match; no conjunct or payload field is assertion-free. |
| Redaction and low-cardinality design | PASS | Fixed mappers and exact negative assertions cover content, identifiers, diagnostics, and secrets. |
| Documented guidelines | PASS | `README.md`, `package.json`, `vitest.config.ts`, and `biome.json` conventions are followed. |
| Diff hygiene | PASS | No skip/deviation/TODO marker in scope; the new report removes prior Markdown trailing whitespace. |

Interactive UAT is not applicable. This feature changes backend runtime, CI, OpenAPI, and an
operator runbook; automated contract checks cover the observable outcomes.

## Requirement Traceability Update

| Requirement set | Previous status | New status |
| --- | --- | --- |
| HARD-01..06 | Implemented | Verified |
| PROC-01..07 | Implemented / revalidation pending | Verified |
| PROV-01..07 | Implemented | Verified |
| OBS-01..07 | Implemented | Verified |
| API-01..07 | Implemented | Verified |
| CI-01..07 | Implemented / revalidation pending | Verified |
| OPS-01..05 | Implemented / revalidation pending | Verified |

## Summary

**Overall**: PASS — ready for feature completion.
**Spec-anchored check**: 46/46 matched, 0 spec-precision gaps, 0 evidence gaps.
**Sensor**: 6/6 mutations killed.
**Gate**: 215 passed, 0 failed, 0 skipped; lint, typecheck, and build passed.
**Lessons**: no new lesson recorded because iteration 2 produced no grounded failure signal.
