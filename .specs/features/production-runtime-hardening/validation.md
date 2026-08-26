# Production Runtime Hardening Validation — FAIL

**Date**: 2026-08-26  
**Spec**: `.specs/features/production-runtime-hardening/spec.md`  
**Diff range**: `c082d99..94fa5d0`  
**Verifier**: independent verifier (author != verifier)  
**Result**: FAIL

The current implementation passes every deterministic gate, but the feature is not verified. Three
spec conjuncts are not discriminated by the in-scope tests: process abort-listener cleanup
(PROC-04), fail-closed CI steps (CI-05), and suppression of transcript output in runbook commands
(OPS-02). The expanded sensor proved each gap with a surviving behavior-level mutant.

## Task Completion

| Task | Status | Commit | Independent check |
| --- | --- | --- | --- |
| T1 | Done | `6f55556` | Config defaults, bounds, sanitization, docs, and unit tests are present. |
| T2 | Done | `91f584b` | Five isolated fixed-label metric families and unit tests are present. |
| T3 | Done | `e871ef2` | Synchronous capacity, idempotent permits, readiness, and shutdown tests are present. |
| T4 | Done with verification gap | `c21db53` | Timeout/kill/race behavior is covered; AbortSignal listener removal is not discriminated. |
| T5 | Done | `15b8495` | Process policies, signal propagation, typed errors, and directory cleanup are covered. |
| T6 | Done | `f6d48eb` | Muse classification, bounded Retry-After, no retry, timeout, and redaction are covered. |
| T7 | Done | `bf1b429` | Cancellation and closed-label telemetry propagation are covered. |
| T8 | Done | `05b22d7` | HTTP admission, lifecycle, metrics auth, release, Retry-After, and redaction are covered. |
| T9 | Done | `b8be57d` | OpenAPI validation, parity, schemas, security, and secret absence are covered. |
| T10 | Done with verification gap | `2187f6c` | CI structure is covered; `continue-on-error` is not forbidden by the contract test. |
| T11 | Done with verification gap | `94fa5d0` | Runbook order, bounds, codes, and policy are covered; response-body suppression is not. |

T1-T11 are checked in `tasks.md`. The range contains exactly 11 ordered Conventional Commits,
one for each task. No task is marked blocked or partial in the execution artifact.

## Spec-Anchored Acceptance Criteria

Evidence is accepted only when the cited assertion checks the exact spec outcome. A row is a gap if
one conjunct lacks a discriminating assertion, even when the current implementation looks correct.

| Requirement | Spec-defined outcome | Exact test evidence (`file:line` + assertion expression) | Result |
| --- | --- | --- | --- |
| HARD-01 | Authenticated JSON/PDF work below the shared cap reserves exactly one slot before provider work. | `test/unit/execution-controller.test.ts:20` — `expect(jsonPermit).toBeDefined()`; `:21` — `expect(pdfPermit).toBeDefined()`; `:23` — `expect(controller.activeCount).toBe(2)`; `test/integration/http-app.test.ts:304` — `expect(getTranscript).toHaveBeenCalledTimes(2)`. | PASS |
| HARD-02 | Overflow returns 429, code `TRANSCRIPT_CAPACITY_EXCEEDED`, `Retry-After: 30`, and calls no new transcript/PDF dependency. | `test/integration/http-app.test.ts:253` — `expect(overflow.statusCode).toBe(429)`; `:254` — `expect(overflow.headers['retry-after']).toBe('30')`; `:255` — `expect(overflow.json()).toEqual({ error: { code: 'TRANSCRIPT_CAPACITY_EXCEEDED', ... } })`; `:261` — `expect(getTranscript).toHaveBeenCalledOnce()`; `:262` — `expect(render).not.toHaveBeenCalled()`. | PASS |
| HARD-03 | Success, failure, abort, or reply close releases one permit exactly once. | `test/unit/execution-controller.test.ts:48` — `expect(controller.activeCount).toBe(0)`; `:49` — `expect(metrics.setActiveJobs.mock.calls).toEqual([[1], [0]])`; `test/integration/http-app.test.ts:273` — `expect(afterRelease.statusCode).toBe(200)`; `:374` — `expect(afterFailures.statusCode).toBe(200)`; `:497` — `expect(operationSignal?.aborted).toBe(true)`; `:505` — `expect(next.statusCode).toBe(200)`. Sensor M13 also killed removal of the reply-close listener at `src/http/app.ts:238`. | PASS |
| HARD-04 | Health, ready, OpenAPI, and authenticated metrics bypass transcript admission while saturated. | `test/integration/http-app.test.ts:390` — `expect(health.json()).toEqual({ status: 'ok' })`; `:391` — `expect(ready.statusCode).toBe(200)`; `:393` — `expect(metrics.statusCode).toBe(200)`; `:396` — `expect(openApiBeforeContractTask.statusCode).toBe(200)`; `:397` — `expect(getTranscript).toHaveBeenCalledOnce()`. | PASS |
| HARD-05 | Missing capacity defaults to 1; only integers 1-32 are accepted; invalid input fails with a sanitized variable-name error. | `test/unit/config.test.ts:36` — `expect(loadConfig({})).toMatchObject({ maxConcurrentTranscripts: 1, ... })`; `:64` — `expect(config[configName]).toBe(expected)` for boundaries including 1/32; `:100` — `expect(() => loadConfig(...)).toThrowError(/^ENV_NAME must be an integer between ...$/)`. | PASS |
| HARD-06 | Unauthorized and schema-invalid saturated requests preserve auth/validation order and consume no slot. | `test/integration/http-app.test.ts:336` — `expect(unauthorized.statusCode).toBe(401)`; `:337` — `expect(invalid.statusCode).toBe(400)`; `:338` — `expect(getTranscript).toHaveBeenCalledOnce()`; `:339` — `expect(render).not.toHaveBeenCalled()`. | PASS |
| PROC-01 | yt-dlp/FFmpeg use 300000/900000 ms; timeout sends SIGTERM and returns sanitized 504 `AUDIO_PROCESS_TIMEOUT`. | `test/unit/audio-media-pipeline.test.ts:44` — `expect(run).toHaveBeenNthCalledWith(..., { timeoutMs: 300_000 })`; `:59` — `expect(run).toHaveBeenNthCalledWith(..., { timeoutMs: 900_000 })`; `test/unit/process-runner.test.ts:124` — `expect(result).rejects.toMatchObject({ code: 'AUDIO_PROCESS_TIMEOUT', statusCode: 504 })`; `:130` — `expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')`; `:214` — `expect(error.message).toBe('Audio process failed')`. | PASS |
| PROC-02 | Shutdown/request cancellation sends SIGTERM and returns stable `AUDIO_PROCESS_ABORTED`. | `test/unit/process-runner.test.ts:164` — `expect(result).rejects.toMatchObject({ code: 'AUDIO_PROCESS_ABORTED', statusCode: 503 })`; `:170` — `expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')`; `test/integration/http-app.test.ts:446` — `expect(operationOptions?.signal?.aborted).toBe(true)`; `:497` — `expect(operationSignal?.aborted).toBe(true)`. | PASS |
| PROC-03 | A still-open child receives one SIGKILL after 5000 ms. | `test/unit/process-runner.test.ts:146` — `await vi.advanceTimersByTimeAsync(5_100)`; `:149` — `expect(process.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])`; `:151` — `expect(process.kill).toHaveBeenCalledTimes(2)`. | PASS |
| PROC-04 | Racing signals settle once and clear all timers, process listeners, stderr listeners, and abort listeners. | Covered conjuncts: `test/unit/process-runner.test.ts:193` — `expect(fulfilled).not.toHaveBeenCalled()`; `:194` — `expect(rejected).toHaveBeenCalledTimes(1)`; `:197` — `expect(process.listenerCount('error')).toBe(0)`; `:199` — `expect(process.stderr.listenerCount('data')).toBe(0)`; `:200` — `expect(vi.getTimerCount()).toBe(0)`. Missing conjunct: no assertion observes removal of the caller AbortSignal listener; sensor M10 removed `options.signal?.removeEventListener('abort', onAbort)` at `src/infrastructure/audio/process-runner.ts:119` and 11/11 tests still passed. | GAP |
| PROC-05 | Internal stderr is capped at 16384 characters and absent from public error/log output. | `test/unit/process-runner.test.ts:213` — `expect(error.diagnosticStderr).toHaveLength(16_384)`; `:214` — `expect(error.message).toBe('Audio process failed')`; `:215` — `expect(error.message).not.toContain('sensitive-provider-output')`; `:104` — `expect(Object.keys(error)).not.toContain('diagnosticStderr')`. | PASS |
| PROC-06 | Timeout/abort preserves the typed error and removes the request directory. | `test/unit/audio-media-pipeline.test.ts:157` — `expect(withChunks(...)).rejects.toBe(typedError)` for download timeout, conversion timeout, and abort; `:162` — `expect(fileSystem.rm).toHaveBeenCalledExactlyOnceWith(requestDir, { force: true, recursive: true })`; `:180` — `expect(...).rejects.toMatchObject({ code: 'AUDIO_PROCESS_ABORTED', statusCode: 503 })`; `:182` — exact cleanup assertion. | PASS |
| PROC-07 | A pre-aborted signal rejects without spawn. | `test/unit/process-runner.test.ts:113` — `expect(run(...)).rejects.toMatchObject({ code: 'AUDIO_PROCESS_ABORTED', statusCode: 503 })`; `:116` — `expect(spawn).not.toHaveBeenCalled()`. | PASS |
| PROV-01 | Muse 401/403 returns 503 `MUSE_AUTHENTICATION_FAILED` with one call/no retry. | `test/unit/muse-audio-transcriber.test.ts:183` — `expect(error).toMatchObject({ code: 'MUSE_AUTHENTICATION_FAILED', statusCode: 503 })`; `:188` — `expect(fetch).toHaveBeenCalledTimes(1)`. | PASS |
| PROV-02 | Muse 429 returns 429 `MUSE_QUOTA_EXCEEDED`, copies only valid bounded Retry-After, and does not retry. | `test/unit/muse-audio-transcriber.test.ts:204` — exact code/status/`retryAfterSeconds: 120`; `:209` — `expect(Object.keys(publicMetadata)).toEqual(['retryAfterSeconds'])`; `:212` — `expect(fetch).toHaveBeenCalledTimes(1)`; `:245` — exact code/status for invalid/unbounded values; `:246` — `expect(error).not.toHaveProperty('publicMetadata')`. | PASS |
| PROV-03 | Muse timeout returns 504 `MUSE_TIMEOUT` and does not retry. | `test/unit/muse-audio-transcriber.test.ts:292` — `expect(result).rejects.toMatchObject({ code: 'MUSE_TIMEOUT', statusCode: 504 })`; `:300` — `expect(fetch).toHaveBeenCalledTimes(1)`; `:301` — `expect(vi.getTimerCount()).toBe(0)`. | PASS |
| PROV-04 | Muse 5xx/network failure returns 502 `MUSE_UPSTREAM_UNAVAILABLE` and does not retry. | `test/unit/muse-audio-transcriber.test.ts:255` — exact 502/code/message for 500/503/599; `:260` — one fetch; `:271` — exact 502/code/message for network rejection; `:277` — one fetch. | PASS |
| PROV-05 | Malformed JSON/shape or empty output returns 502 `MUSE_INVALID_RESPONSE` with no retry. | `test/unit/muse-audio-transcriber.test.ts:131` — exact code/status for whitespace, unsupported shape, and missing output text; `:137` — one create call; `:342` — exact code/status/message for malformed JSON; `:348` — one fetch. | PASS |
| PROV-06 | Muse failures exclude API key, authorization, provider body, audio Base64, transcript text, and nested cause messages from public/operational output. | `test/unit/muse-audio-transcriber.test.ts:185` — `expect(JSON.stringify(error)).not.toMatch(/secret-api-key|secret provider body|YXVkaW8tc2VjcmV0bw|Somente a transcrição secreta/)`; `:276` — `expect(JSON.stringify(error)).not.toMatch(/secret-api-key|authorization|provider body/)`; `test/unit/muse-audio-fallback.test.ts:153` — metric labels exclude transcript/secret/authorization; `test/integration/http-app.test.ts:528` — response excludes provider detail; `:623` and `:624` — response excludes provider detail and nested cause. | PASS |
| PROV-07 | Non-Muse caption failure keeps YouTube classification and does not enter Muse fallback. | `test/unit/hybrid-transcript-service.test.ts:103` — `expect(service.getTranscript(...)).rejects.toBe(error)`; `:104` — `expect(transcribe).not.toHaveBeenCalled()`; `test/unit/youtube-caption-provider.test.ts:111` — exact `YOUTUBE_UPSTREAM_ERROR`/502. | PASS |
| OBS-01 | Ready lifecycle returns 200 `{status:'ready'}` without external calls. | `test/integration/http-app.test.ts:391` — `expect(ready.statusCode).toBe(200)`; `:392` — `expect(ready.json()).toEqual({ status: 'ready' })`; `:397` — held provider call count remains exactly one across operational probes. | PASS |
| OBS-02 | Shutdown readiness returns 503 `{status:'not_ready'}`. | `test/integration/http-app.test.ts:462` — `expect(response.statusCode).toBe(503)`; `:463` — `expect(response.json()).toEqual({ status: 'not_ready' })`; `:464` — no provider call. | PASS |
| OBS-03 | Authenticated metrics expose active jobs, capacity rejections, source, stage duration, and stage failures. | `test/unit/runtime-metrics.test.ts:10` — `expect(metricNames).toEqual([five exact families])`; `test/integration/http-app.test.ts:393` — status 200; `:394` — exact Prometheus content type; `:395` — active-job gauge value. | PASS |
| OBS-04 | Metrics without the configured Bearer token return existing 401 or fail-closed 503 envelopes. | `test/integration/http-app.test.ts:410` — 401; `:411` — exact `UNAUTHORIZED` envelope; `:414` — 503; `:415` — exact `API_AUTH_NOT_CONFIGURED` envelope; `:421` — no transcript call. | PASS |
| OBS-05 | Metrics use only fixed route/stage/source/outcome/reason values and contain no sensitive dynamic labels. | `test/unit/runtime-metrics.test.ts:84` — unknown route; `:85` — unknown source; `:86` — unknown stage/outcome; `:89` — unknown stage/reason; `:92` — output does not match video/language/URL/outcome/error/secret fixtures. | PASS |
| OBS-06 | Request/stage logs exclude auth, bodies, transcript/PDF/audio/provider content, and secrets. | `test/integration/http-app.test.ts:717` — no video ID; `:720` — no transcript; `:721` — no PDF bytes; `:722`/`:723` — no provider message/cause; `:724`/`:725` — no configured or supplied authorization secret; `test/unit/runtime-metrics.test.ts:92` — no sensitive dynamic label fixtures. | PASS |
| OBS-07 | Unknown metric values map to `unknown`. | `test/unit/runtime-metrics.test.ts:84` through `:90` — each route/source/stage/outcome/reason assertion expects `unknown`. | PASS |
| API-01 | Public OpenAPI is valid 3.1 with API version 1.0.0. | `test/integration/openapi.test.ts:81` — route status 200; `:88` — `expect(document.openapi).toBe('3.1.0')`; `:89` — `expect(document.info.version).toBe('1.0.0')`; `:96` — parser resolves `{ valid: true }`. | PASS |
| API-02 | Five in-scope operations describe actual methods, bodies, media types, and statuses. | `test/integration/openapi.test.ts:109` — documented operations equal registered operations; `:110` — exact five method/path list; `:189` — required request body; `:190` — JSON request schema; `:193` — JSON success schema; `:196` — PDF media schema; `:199` — exact status set; `:211` — metrics text schema. | PASS |
| API-03 | Protected operations use HTTP Bearer; health, readiness, and OpenAPI are public. | `test/integration/openapi.test.ts:122` — exact HTTP bearer scheme; `:126`/`:127` — empty health/readiness security; `:128`-`:134` — Bearer on metrics/JSON/PDF; `:138` — public OpenAPI returns 200. | PASS |
| API-04 | Schemas contain every required transcript/segment field, source/precision variant, and stable public code. | `test/integration/openapi.test.ts:149` — exact transcript required fields; `:160` — exact sources; `:164` — exact precisions; `:168` — exact segment fields; `:170` — introduced stable codes; `:219` — `expect(document.components.schemas).toMatchSnapshot()` with the complete code enum at `test/integration/__snapshots__/openapi.test.ts.snap:12`. | PASS |
| API-05 | OpenAPI contains no environment values, credentials, production hosts, content, or provider diagnostics. | `test/integration/openapi.test.ts:228`-`:233` — serialized document excludes secret environment value, access key, video ID, transcript content, provider response, and production Railway hostname. | PASS |
| API-06 | Route/response changes break parity until OpenAPI is updated. | `test/integration/openapi.test.ts:109` — `expect(documentedOperations).toEqual(getRegisteredOpenApiOperations(app))`; exact operation list at `:110`. | PASS |
| API-07 | OpenAPI generation remains deterministic without production environment variables. | Gate ran with `OPENCODE_API_KEY` and `API_ACCESS_KEY` absent. `test/integration/openapi.test.ts:228` — environment content is excluded; `:229` — credential content is excluded; `:219` — stable schema snapshot. Sensor M11's conditional omission of registration was killed by the no-auth application tests. | PASS |
| CI-01 | Main pushes and pull requests run `npm ci` then `npm run check` on Node 22. | `test/unit/ci-contract.test.ts:45` — main branch; `:46` — pull_request exists; `:49` — exact Node 22/npm cache config; `:54` — exact run sequence `['npm ci', 'npm run check']`. | PASS |
| CI-02 | A dependent source-success job builds the checked-in Dockerfile without publishing. | `test/unit/ci-contract.test.ts:64` — exact job name; `:65` — `expect(container.needs).toBe('source')`; `:66` — exact checkout/Buildx/build actions; `:71` — exact `{ context: '.', file: 'Dockerfile', push: false }`. | PASS |
| CI-03 | Source/container gates run without provider credentials or network/provider calls. | Local gate passed with both production credentials absent. `test/unit/ci-contract.test.ts:81`-`:84` — workflow contains no `secrets.`, provider/API key names, or `env:`. Deterministic tests use local fakes and made no provider call. | PASS |
| CI-04 | CI uses npm lockfile cache and read-only contents permission. | `test/unit/ci-contract.test.ts:47` — `expect(workflow.permissions).toEqual({ contents: 'read' })`; `:49` — exact Node/cache/lockfile config. | PASS |
| CI-05 | Any source/container failure fails the workflow; README names required checks. | Documented conjunct: `test/unit/ci-contract.test.ts:98`-`:100` requires `Source checks`, `Container build`, and branch protection. Missing conjunct: no assertion forbids `continue-on-error`. Sensor M12 added `continue-on-error: true` to `.github/workflows/ci.yml:29` and 4/4 CI contract tests still passed. | GAP |
| CI-06 | Workflow YAML parses and referenced scripts, lockfile, and Dockerfile exist. | `test/unit/ci-contract.test.ts:34` — `parse(source)` must succeed; `:93` — lockfile exists; `:94` — Dockerfile exists; `:95` — exact `check` script. | PASS |
| CI-07 | When Docker is unavailable, local source gates run and checked-in CI remains the authoritative container gate. | `command -v docker` exited 1; `npm run check` still passed 211/211. `test/unit/ci-contract.test.ts:64`-`:75` proves the checked-in dependent non-publishing container build contract. | PASS |
| OPS-01 | Runbook orders platform/liveness/readiness/auth, captions, yt-dlp, FFmpeg, and Muse diagnosis. | `test/unit/youtube-blocking-runbook-contract.test.ts:22` — every required stage exists; `:23` — positions equal their sorted order. | PASS |
| OPS-02 | Commands bound runtime/output, use placeholders, and never print transcript/audio/cookies/tokens/provider bodies. | Covered conjuncts: `test/unit/youtube-blocking-runbook-contract.test.ts:24` — at least 10 commands; `:25` — every command has a time bound; `:28`-`:32` — placeholders and output cap; `:33` — no real video fixture. Missing conjunct: response-body suppression is not asserted. Sensor M9 removed `--output /dev/null` from the transcript POST at `docs/runbooks/youtube-datacenter-blocking.md:22`; the command then prints the transcript response, but 4/4 contract tests still passed. | GAP |
| OPS-03 | Runbook distinguishes unavailable video, caption upstream, tool, extraction, timeout, and platform status with sanitized codes. | `test/unit/youtube-blocking-runbook-contract.test.ts:55` — every required application code is present; `:56` — platform `SUCCESS/RUNNING`; `:57` — YouTube/provider distinction. | PASS |
| OPS-04 | Only public videos without account state are supported; bypass guidance is forbidden. | `test/unit/youtube-blocking-runbook-contract.test.ts:63` — exact public-video policy; `:64` — exact incompatible bypass list; `:67`-`:71` — prohibited cookie/proxy/CAPTCHA/IP/bypass guidance is absent. | PASS |
| OPS-05 | Healthy API vs. blocked YouTube stays distinct and Bearer/timeouts/capacity are not weakened. | `test/unit/youtube-blocking-runbook-contract.test.ts:56`/`:57` — platform/provider distinction; `:72` — preserve Bearer; `:73` — preserve timeouts; `:74` — preserve concurrency limit; README preservation assertions at `:81`-`:85`. | PASS |

**Traceability result**: 43/46 requirements have complete spec-anchored evidence. There are 0
spec-precision gaps and 3 test-evidence gaps.

| Area | Matched | Total | Gaps |
| --- | ---: | ---: | --- |
| HARD | 6 | 6 | — |
| PROC | 6 | 7 | PROC-04 |
| PROV | 7 | 7 | — |
| OBS | 7 | 7 | — |
| API | 7 | 7 | — |
| CI | 6 | 7 | CI-05 |
| OPS | 4 | 5 | OPS-02 |
| **Total** | **43** | **46** | **3** |

## Edge Cases

All six edge cases are included in the 46-row evidence table: HARD-06, PROC-07, PROV-07,
OBS-07, API-07, and CI-07. Each passed its exact asserted outcome. No edge case is counted twice in
the traceability total.

## Gate Check

- **Baseline command**: `npm test` at `c082d99` in a detached temporary worktree.
- **Baseline result**: 10 files passed, 83/83 tests passed, 0 failed, 0 skipped.
- **Current command**: `npm run check` at `94fa5d0` in the real tree.
- **Current result**: Biome checked 37 files; typecheck passed; 15 files and 211/211 tests
  passed; build passed; 0 failed and 0 skipped.
- **Delta**: +128 tests. No test file was deleted. The one changed pre-feature log assertion was
  strengthened from containing a video ID to excluding it.
- **Skip audit**: Vitest reported no skipped tests, and static search found no `.skip`, `.todo`,
  `describe.skip`, `it.skip`, or `test.skip` in scope.
- **Docker**: unavailable locally (`command -v docker` exit 1). Per CI-07, the authoritative
  container gate is `.github/workflows/ci.yml:31`, statically checked by
  `test/unit/ci-contract.test.ts:60`-`:75`.
- **Workflow static gate**: YAML parsed; main/pull_request triggers, Node 22, lockfile cache,
  read-only permission, exact source commands, source dependency, Dockerfile, Buildx, `push:false`,
  and absence of provider/API secrets all passed.
- **Deterministic completion gate**:
  `python3 /home/matheus/.codex/skills/tlc-spec-driven/scripts/validate_state.py production-runtime-hardening --root /home/matheus/transcript-youtube-videos-api`
  exited 1 because this report's verdict is FAIL. This is the expected fail-closed result; the
  feature is not done.

## Discrimination Sensor

The sensor used detached worktrees under
`/tmp/production-runtime-hardening-verify.d54wkx`. Each mutant changed only the scratch tree. After
the sensor, both worktrees and the temporary root were removed. Real-tree
`git status --porcelain=v1 -uall` was empty both before and after sensor cleanup, and
`git worktree list --porcelain` contained only the real `94fa5d0` worktree.

| ID | Mutation | Relevant test command/result | Killed? |
| --- | --- | --- | --- |
| M1 | `src/application/execution-controller.ts:34`: capacity `>=` to `>` (off-by-one admission). | `execution-controller.test.ts`: failed at `:22`, overflow permit was defined. | Killed |
| M2 | `src/infrastructure/audio/process-runner.ts:145`: SIGKILL fallback changed to SIGTERM. | `process-runner.test.ts`: failed at `:149`, signal sequence differed. | Killed |
| M3 | `src/infrastructure/audio/muse-audio-transcriber.ts:191`: quota code changed to upstream-unavailable. | `muse-audio-transcriber.test.ts`: 6 failures, first at `:204`. | Killed |
| M4 | `src/http/app.ts:203`: removed metrics Bearer hook. | `http-app.test.ts`: failed at `:410`, unauthenticated metrics returned 200. | Killed |
| M5 | `src/http/app.ts:194`: not-ready status changed 503 to 200. | `http-app.test.ts`: failed at `:462`. | Killed |
| M6 | `src/http/openapi.ts:211`: OpenAPI 3.1.0 changed to 3.0.0. | `openapi.test.ts`: 3 failures, exact version failure at `:88`. | Killed |
| M7 | `.github/workflows/ci.yml:46`: Docker `push:false` changed to `true`. | `ci-contract.test.ts`: failed at `:71`. | Killed |
| M8 | `src/http/app.ts:176`: public error message changed to raw `error.message`. | `http-app.test.ts`: 9 redaction/contract failures, first at `:528`. | Killed |
| M9 | `docs/runbooks/youtube-datacenter-blocking.md:22`: removed `--output /dev/null` from transcript POST. | `youtube-blocking-runbook-contract.test.ts`: 4/4 passed. | **Survived** |
| M10 | `src/infrastructure/audio/process-runner.ts:119`: removed caller AbortSignal listener cleanup. | `process-runner.test.ts`: 11/11 passed. | **Survived** |
| M11 | `src/http/app.ts:140`: registered OpenAPI schemas/routes only when auth config existed. | OpenAPI + HTTP tests: 4 failures from missing schemas in no-auth paths. | Killed |
| M12 | `.github/workflows/ci.yml:29`: added `continue-on-error: true` to `npm run check`. | `ci-contract.test.ts`: 4/4 passed. | **Survived** |
| M13 | `src/http/app.ts:238`: removed reply-close abort listener. | `http-app.test.ts`: failed at `:497`; cancellation did not abort the operation. | Killed |

**Sensor depth**: expanded manual high-risk sensor.  
**Result**: 13 mutations injected, 10 killed, 3 survived — FAIL.

## Code Quality and Test Necessity/Sufficiency

| Check | Result | Evidence |
| --- | --- | --- |
| Minimum code / no speculative abstraction | PASS | Runtime primitives are small owned classes/functions; no unused flexibility was found. |
| Surgical scope / no unrelated cleanup | PASS | All 36 changed files map to T1-T11, dependency locks, spec/task traceability, or generated snapshot. |
| Existing patterns and style | PASS | Biome, TypeScript, Vitest, Fastify injection, adapters, and dependency injection are preserved. |
| No test weakening/deletion | PASS | 83 to 211 tests; no deleted test file; prior log assertion was strengthened. |
| Test necessity | PASS | Feature-added tests claim an AC, listed edge case, or explicit Done-when regression contract. Existing tests in touched files preserve reused behavior. |
| Per-layer coverage | FAIL | Domain/route/static layers are broad, but PROC-04, CI-05, and OPS-02 lack discriminating assertions. |
| Spec-anchored asserted values | FAIL | 43/46 complete. The three gaps are conjunct omissions, not vague spec outcomes. |
| Redaction and low-cardinality design | PASS | Fixed mappers, sanitized envelopes/log fields, secret/content fixtures, and M8 discrimination pass. |
| Documented guidelines | PASS | `README.md`, `package.json`, `vitest.config.ts`, and `biome.json` conventions followed; no contributor-specific test guide exists. |
| Diff hygiene | PASS | `git diff --check c082d99..94fa5d0` passed; no TODO/FIXME/SPEC_DEVIATION marker exists in scope. |

Interactive UAT was not applicable: this is a backend/runtime/CI/runbook feature with no visual or
interactive user interface.

## Ranked Gaps

1. **OPS-02 — sensitive transcript output can regress undetected.** The runbook test verifies time
   bounds and placeholders but not that the transcript POST discards its response body. M9 turns
   the diagnostic into transcript-printing output while all four contract tests remain green.
2. **PROC-04 — AbortSignal listener cleanup can regress undetected.** The process tests verify
   process/stderr listeners and timers but do not observe the caller signal listener. M10 removes
   cleanup while all 11 tests remain green, allowing listener retention across completed work.
3. **CI-05 — source-gate failure can be ignored undetected.** The CI contract verifies commands and
   dependencies but not fail-closed step semantics. M12 adds `continue-on-error: true` and all four
   static tests remain green.

No implementation or test fix was applied. These gaps must become fix tasks and be independently
re-verified.

The required lessons distillation recorded six grounded candidates through the skill-owned script:
L-001/L-002 for PROC-04/M10, L-003/L-004 for CI-05/M12, and L-005/L-006 for OPS-02/M9.

## Summary

**Overall**: FAIL — not ready for completion.  
**Spec-anchored check**: 43/46 matched, 0 spec-precision gaps, 3 evidence gaps.  
**Gate**: 211 passed, 0 failed, 0 skipped; lint/typecheck/build passed; Docker unavailable locally.  
**Sensor**: 10/13 killed; 3 survived.  
**Real-tree isolation**: porcelain matched the empty pre-sensor baseline after scratch cleanup.
