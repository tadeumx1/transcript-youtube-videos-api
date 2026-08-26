# Railway Production Deploy Validation

**Verdict:** PASS ✅
**Date:** 2026-08-25 (America/Sao_Paulo)
**Spec:** `.specs/features/railway-production-deploy/spec.md`
**Diff range:** `5750279..ce8240f`
**Verifier:** independent TLC Verifier (author ≠ verifier)

The implementation matches all 17 acceptance and edge requirements. The build gate passes, the
test count increased from 74 to 83, all five critical-path authentication mutants were killed, and
the real working tree remained unchanged by the sensor.

## Task Completion

| Task | Status | Evidence |
| ---- | ------ | -------- |
| T1 | ✅ Done | `src/config.ts:23-34`; `test/unit/config.test.ts:7-26` |
| T2 | ✅ Done | `src/http/app.ts:81-115,166-208`; `test/integration/http-app.test.ts:63-179,206-229,347-400` |
| T3 | ✅ Done | `Dockerfile:3-35`; `src/server.ts:24-26` |
| T4 | ✅ Done, superseded | Final live manifest retains `ON_FAILURE` with 10 retries; T6 removed legacy dual ownership. |
| T5 | ✅ Done | `README.md:66-79,124-170,189-263` |
| T6 | ✅ Done | `.railway/railway.ts:1-24`; fresh `railway config plan --json` returned `No changes.` and zero diagnostics. |
| T7 | ✅ Done | Scoped deployment and public-smoke evidence below. |

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | Evidence and assertion | Result |
| ----------- | -------------------- | ---------------------- | ------ |
| RYSEC-01 | Unauthenticated health is HTTP 200 with `{ "status": "ok" }`; no transcript/PDF work. | `test/integration/http-app.test.ts:63-71` — `toBe(200)`, `toEqual({ status: 'ok' })`, and both dependency spies `not.toHaveBeenCalled()`; fresh public smoke also returned the exact body and 200. | ✅ PASS |
| RYSEC-02 | Missing, malformed, or incorrect Bearer credentials on either transcript route return HTTP 401/`UNAUTHORIZED` before work. | `test/integration/http-app.test.ts:97-140` — both-route parameterization asserts 401, exact error code/envelope, and no dependency calls; malformed/wrong variants are enumerated at lines 118-122. | ✅ PASS |
| RYSEC-03 | The exact configured token reaches existing JSON/PDF validation and success behavior. | `test/integration/http-app.test.ts:143-179,206-229` — exact credential produces 200, the complete transcript contract, dependency calls, `application/pdf`, and `%PDF`. | ✅ PASS |
| RYSEC-04 | Missing `API_ACCESS_KEY` yields HTTP 503/`API_AUTH_NOT_CONFIGURED` on both routes before provider/media/PDF work. | `test/integration/http-app.test.ts:74-94` — both routes assert exact 503 envelope and zero transcript/PDF calls. | ✅ PASS |
| RYSEC-05 | Auth success/failure never serializes credentials, headers, transcript/audio/PDF content, or provider secrets into logs or error responses. | `src/http/app.ts:120-133,136-163` logs only allowlisted metadata; `test/integration/http-app.test.ts:278-300,329-345,347-400` asserts sanitized responses and absence of transcript text, PDF bytes, provider details, configured token, and wrong authorization material in logs. Audio bytes never enter the HTTP/log boundary. | ✅ PASS |
| RYSEC-06 | `API_ACCESS_KEY` is trimmed, blank becomes absent, and server-only configuration is wired to the HTTP boundary rather than the body. | `test/unit/config.test.ts:7-19,22-32` — asserts trimmed `apiAccessKey` and absence for blank input; `src/config.ts:23-34` loads only the environment; `src/server.ts:4-5` and `src/app.ts:32-40` carry it into `buildApp`; the closed request schema at `src/http/app.ts:41-58` accepts only `url`/`languages`. | ✅ PASS |
| RYSEC-07 | A differently cased Bearer scheme with the exact token is accepted. | `test/integration/http-app.test.ts:143-157` — `bEaReR` returns 200 on both routes and reaches both dependencies. | ✅ PASS |
| RYSEC-08 | Empty credentials or extra whitespace/token material return `UNAUTHORIZED`. | `test/integration/http-app.test.ts:118-140` — `Bearer ` and `Bearer <key> extra` both assert HTTP 401 and the exact error code on both routes. | ✅ PASS |
| RYDEP-01 | Railway uses the checked-in Node 22/FFmpeg/pinned-yt-dlp Dockerfile and compiled API. | `Dockerfile:3-18,30-37` defines the required image contents and compiled entrypoint; `.railway/railway.ts:7-10` selects `DOCKERFILE`/`Dockerfile`; the live deployment manifest independently reported the same builder/path. | ✅ PASS |
| RYDEP-02 | Fastify and the container health probe use Railway's runtime `PORT`. | `src/config.ts:15-20,27-30` parses `PORT`; `src/server.ts:24-26` listens on it; `Dockerfile:34-35` probes `process.env.PORT` with only a local 3000 fallback. | ✅ PASS |
| RYDEP-03 | Railway probes `/health`, waits up to 300 seconds, and uses bounded on-failure restart. | `.railway/railway.ts:11-14` declares `/health`/300; fresh scoped status reported `/health`, 300, `ON_FAILURE`, and 10 retries for the active manifest. | ✅ PASS |
| RYDEP-04 | Both production credentials are non-empty before smoke tests and values never enter committed/captured evidence. | `.railway/railway.ts:15-18` preserves both variables without values; the T7 boolean-only projection recorded both as non-empty; diff inspection found only placeholders/test fixtures and no production credential. | ✅ PASS |
| RYDEP-05 | The scoped service/environment reaches terminal `SUCCESS` before success is claimed. | Fresh scoped `railway status --json` reported deployment `b30f931e-3f97-4f1b-a635-f46db5512d86` as `SUCCESS` with its instance `RUNNING`; scope is recorded below. | ✅ PASS |
| RYDEP-06 | The Railway domain proves public health, unauthenticated rejection, and authenticated caption JSON success. | Fresh smoke returned exact health 200/body and unauthenticated 401/`UNAUTHORIZED`; preserved T7 evidence records authenticated caption JSON HTTP 200, `youtube_captions`, `pt-BR`, caption precision, 60 segments, and non-empty complete text without retaining text. | ✅ PASS |
| RYDEP-07 | Authenticated PDF smoke for the same video returns 200, `application/pdf`, and `%PDF`. | Preserved T7 evidence records HTTP 200, `application/pdf`, a video-ID attachment name, 3,068 bytes, and `%PDF`; payload was not retained. Local contract assertions at `test/integration/http-app.test.ts:206-229` independently verify the same status/type/signature. | ✅ PASS |
| RYDEP-08 | A failed/non-terminal deployment is investigated with bounded logs and never reported successful. | The condition did not occur. The execution contract at `.specs/features/railway-production-deploy/tasks.md:231-239` requires terminal success before the smoke/success claim, and the observed deployment was terminal `SUCCESS`; no failed/non-terminal state was mislabeled. | ✅ PASS (condition not triggered) |
| RYDEP-09 | YouTube blocking is reported separately from platform health/authentication. | The condition did not occur for the captioned smoke video. `README.md:258-263` explicitly separates provider blocking from `/health`; preserved smoke evidence records platform and provider outcomes separately. | ✅ PASS (condition not triggered) |

**Status:** 17/17 requirements match their spec-defined outcomes. There are no spec-precision gaps.

## Railway Deployment and Smoke Evidence

| Scope or contract | Verified evidence |
| ----------------- | ----------------- |
| Project / environment / service | `transcript-youtube-videos-api` / `production` / `transcript-youtube-videos-api` |
| Deployment | `b30f931e-3f97-4f1b-a635-f46db5512d86`: terminal `SUCCESS`; active instance `RUNNING` |
| Domain | `https://transcript-youtube-videos-api-production.up.railway.app` active on the scoped service |
| IaC drift | Fresh `railway config plan --json`: `No changes.`, zero diagnostics; both secrets represented only as `preserve` |
| Manifest | `DOCKERFILE`, `Dockerfile`, `/health`, 300 seconds, `ON_FAILURE`, 10 retries |
| Fresh unauthenticated smoke | `GET /health`: 200 and exact `{"status":"ok"}`; transcript POST without Authorization: 401 and `UNAUTHORIZED` |
| Preserved authenticated smoke | Caption JSON: 200 with expected unified metadata; PDF: 200, `application/pdf`, `%PDF`; sensitive payloads not captured |

No secret values were printed or added to this report. The authenticated evidence is incorporated
from the scoped T7 execution record because its high-entropy access key was deliberately removed
from local disk after smoke testing.

## Build Gate and Test Integrity

- **Command:** `npm run check`
- **Result:** PASS: Biome checked 29 files, strict TypeScript passed, Vitest passed, and the
  production build completed.
- **Current tests:** 83 passed in 10 files; 0 failed; 0 skipped.
- **Baseline:** checkout `5750279` was executed in a disposable worktree: 74 passed in 10 files;
  0 failed; 0 skipped.
- **Delta:** +9 tests. No tests were deleted or skipped, and the feature assertions target exact
  statuses, envelopes, dependency short-circuits, output contracts, and redaction values.
- **Diff hygiene:** `git diff --check 5750279..ce8240f` passed.

## Discrimination Sensor

The P0/auth sensor ran against `ce8240f` in `/tmp/railway-production-deploy-sensor`. Each mutation
was restored before the next run. Only `test/integration/http-app.test.ts` was executed against the
mutant. The disposable worktree was then removed.

| # | Mutation | Spec behavior tested | Result |
| - | -------- | -------------------- | ------ |
| 1 | `src/http/app.ts:96`: changed missing-config response 503 → 401 | Exact fail-closed 503 on both protected routes | ✅ Killed: 2 tests failed at `test/integration/http-app.test.ts:85` |
| 2 | `src/http/app.ts:85-91`: forced credential comparison to accept every token | Incorrect token must return 401 | ✅ Killed: wrong-token test failed at `test/integration/http-app.test.ts:134` |
| 3 | `src/http/app.ts:166`: changed health payload `ok` → `degraded` | Public exact health contract | ✅ Killed: health assertion failed at `test/integration/http-app.test.ts:69` |
| 4 | `src/http/app.ts:82`: removed case-insensitive regex flag | Lower/mixed-case Bearer scheme acceptance | ✅ Killed: scheme-casing assertion failed at `test/integration/http-app.test.ts:154` |
| 5 | `src/http/app.ts:106`: inverted the exact-token auth decision | Exact token must reach protected route behavior | ✅ Killed: 22 tests failed, including `test/integration/http-app.test.ts:154,170,216` |

**Sensor depth:** P0-full manual fault injection (5 material auth-branch mutations).
**Result:** 5/5 killed, 0 survived. Real-tree `git status --porcelain=v1` was empty before and after
cleanup; `git worktree list --porcelain` contains only the real worktree.

## Edge Cases

- [x] Case-insensitive authentication scheme is accepted with the exact token.
- [x] Empty and extra-material credentials are rejected before dependencies.
- [x] Missing server configuration fails closed on both routes.
- [x] Runtime and container share Railway's dynamic port.
- [x] Success is based on terminal deployment state; failure-log handling was not triggered.
- [x] Provider availability is reported separately; Railway datacenter blocking was not observed.

## Code Quality

| Principle | Status | Evidence |
| --------- | ------ | -------- |
| Minimum code; no speculative abstraction | ✅ | One normalization field, one route-scoped auth hook, one IaC resource. |
| Surgical scope; no unrelated cleanup | ✅ | All 17 changed files trace to security, Railway runtime/IaC, deployment evidence, docs, tests, or the requested hardening backlog. |
| No unnecessary flexibility | ✅ | Single server-managed token, exact Bearer grammar, fixed protected-route scope. |
| Existing style and patterns | ✅ | Reuses `optionalValue`, Fastify hooks/error envelopes, dependency injection, Vitest, and the existing Dockerfile. |
| Spec-anchored tests are non-shallow | ✅ | Both protected routes cover configured/unconfigured, valid/invalid, short-circuit, PDF/JSON, and secrecy outcomes. |
| Per-layer coverage expectation | ✅ | Runtime branches have unit assertions; HTTP happy/edge/error branches have integration assertions; infrastructure uses static plus scoped live evidence as defined at `tasks.md:24-29`. |
| Every in-scope test is claimed | ✅ | New/modified assertions map to RYSEC-01 through RYSEC-08 or preserve pre-existing authenticated route behavior. |
| Documented guidelines | ✅ | `README.md:265-273`, `package.json:9-19`, `vitest.config.ts`, and TLC coding principles were followed. |
| No secret exposure | ✅ | IaC uses `preserve()`; committed examples are blank/placeholders; validation evidence contains only names, statuses, and non-sensitive contracts. |

## Requirement Traceability Update

| Requirement | Previous | Verified result |
| ----------- | -------- | --------------- |
| RYSEC-01 through RYSEC-08 | Implemented | ✅ Verified |
| RYDEP-01 through RYDEP-09 | Implemented | ✅ Verified |

## Summary

**Overall:** PASS ✅

- **Spec-anchored check:** 17/17 outcomes matched; 0 precision gaps.
- **Gate:** 83 passed, 0 failed, 0 skipped; baseline 74, delta +9.
- **Sensor:** 5 mutations injected, 5 killed, 0 survived.
- **Ranked gaps:** none.
- **Lessons:** none recorded because this is a clean PASS.
