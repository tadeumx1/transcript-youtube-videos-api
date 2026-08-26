# Muse Audio Fallback Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/muse-audio-fallback/spec.md`
**Diff range**: `658678b..7f412a7`
**Verifier**: independent sub-agent (author != verifier)
**Verdict**: PASS

---

## Task Completion

This medium feature has no `tasks.md`; its four implementation commits are complete and the source of
truth already marks MUSE-01 through MUSE-10 Verified. Verification was re-derived from the spec rather
than from those statuses.

| Commit | Status | Scope |
| --- | --- | --- |
| `20b1bc4` | PASS | Muse request adapter and transcriber |
| `191c867` | PASS | Muse fallback wiring and provider-neutral contract |
| `7a4a87d` | PASS | Obsolete OpenAI adapter, SDK, and tests removed |
| `7f412a7` | PASS | Root `.env` loading and runtime configuration |

## Spec-Anchored Acceptance Criteria

| Criterion | Spec-defined outcome | `file:line` + assertion expression | Result |
| --- | --- | --- | --- |
| MUSE-01 | Typed caption unavailability with `OPENCODE_API_KEY` uses sequential MP3 requests to `https://opencode.ai/zen/go/v1/responses`, model `muse-spark-1.2-contributor`, and minimal reasoning. | `test/unit/hybrid-transcript-service.test.ts:63` - typed unavailability enters the fallback and `test/unit/hybrid-transcript-service.test.ts:74` asserts its exact input; `test/unit/muse-audio-transcriber.test.ts:35` asserts ordered two-chunk results, `test/unit/muse-audio-transcriber.test.ts:42` asserts ordered reads, and `test/unit/muse-audio-transcriber.test.ts:43` asserts two requests; `test/unit/muse-audio-transcriber.test.ts:44` asserts exact model/reasoning request fields; `test/unit/muse-audio-transcriber.test.ts:129`-`test/unit/muse-audio-transcriber.test.ts:135` assert one POST to the exact endpoint with the exact request body. | PASS |
| MUSE-02 | Every request contains raw Base64 audio in `input_audio.data`, `mp3` format, an automotive Brazilian Portuguese instruction, and unique normalized primary-language hints in input order. | `test/unit/muse-audio-transcriber.test.ts:44`-`test/unit/muse-audio-transcriber.test.ts:66` assert the automotive instruction, `pt, en` hints, exact raw Base64, and `mp3`; `test/unit/muse-audio-transcriber.test.ts:67` asserts the payload has no data-URL prefix. | PASS |
| MUSE-03 | Successful chunks produce HTTP 200, `source: "muse_transcription"`, `isGenerated: true`, chunk timestamp precision, and offsets `0, 600, ...` in order. | `test/unit/muse-audio-transcriber.test.ts:37`-`test/unit/muse-audio-transcriber.test.ts:40` assert exact segments at 0 and 600 seconds; `test/unit/muse-audio-fallback.test.ts:40`-`test/unit/muse-audio-fallback.test.ts:50` assert the complete unified transcript fields and ordered segments; `test/integration/http-app.test.ts:108` asserts HTTP 200 and `test/integration/http-app.test.ts:109` asserts the exact Muse JSON contract. | PASS |
| MUSE-04 | Missing fallback credential returns HTTP 503 `AUDIO_FALLBACK_NOT_CONFIGURED` before temporary media is created. | `test/unit/muse-audio-fallback.test.ts:18`-`test/unit/muse-audio-fallback.test.ts:21` assert the exact code/status and `test/unit/muse-audio-fallback.test.ts:22` asserts `withChunks` was never called; `test/integration/http-app.test.ts:182`-`test/integration/http-app.test.ts:200` assert exact route status/code on both endpoints. | PASS |
| MUSE-05 | Non-success, malformed, network, timeout, or empty Muse results map to HTTP 502 `MUSE_TRANSCRIPTION_FAILED`. | `test/unit/muse-audio-transcriber.test.ts:76`-`test/unit/muse-audio-transcriber.test.ts:81` assert a rejected provider call maps to the exact code/status; `test/unit/muse-audio-transcriber.test.ts:85`-`test/unit/muse-audio-transcriber.test.ts:100` assert whitespace, reasoning-only, and malformed responses map identically; `test/unit/muse-audio-transcriber.test.ts:136` asserts an abort signal is attached; `test/unit/muse-audio-transcriber.test.ts:139`-`test/unit/muse-audio-transcriber.test.ts:150` assert non-success handling without response-body disclosure; `test/integration/http-app.test.ts:199`-`test/integration/http-app.test.ts:200` assert HTTP 502 and the public error code. Network and timeout rejections use the same asserted rejected-provider path. | PASS |
| MUSE-06 | Successful captions and unexpected caption-provider failures make zero Muse transcription requests. | `test/unit/hybrid-transcript-service.test.ts:47`-`test/unit/hybrid-transcript-service.test.ts:60` assert the exact caption result and `transcribe` not called; `test/unit/hybrid-transcript-service.test.ts:91`-`test/unit/hybrid-transcript-service.test.ts:96` assert the unexpected error is propagated and `transcribe` not called. | PASS |
| MUSE-07 | Request-specific media is removed after success and failure, and secrets/audio/transcript/provider bodies are not logged. | `test/unit/audio-media-pipeline.test.ts:90`-`test/unit/audio-media-pipeline.test.ts:103` assert exact recursive cleanup after success; `test/unit/audio-media-pipeline.test.ts:106`-`test/unit/audio-media-pipeline.test.ts:122` assert it after failure; `test/integration/http-app.test.ts:285`-`test/integration/http-app.test.ts:291` assert logs omit transcript, PDF, provider message, and provider cause content; `test/unit/muse-audio-transcriber.test.ts:145`-`test/unit/muse-audio-transcriber.test.ts:150` assert a provider response body is not propagated. The logging implementation is an explicit metadata allowlist at `src/http/app.ts:80`-`src/http/app.ts:89`, `src/http/app.ts:103`-`src/http/app.ts:104`, and `src/http/app.ts:133`-`src/http/app.ts:135`; neither the API key nor audio is available to it. | PASS |
| MUSE-08 | JSON and PDF preserve each non-empty chunk once in chronological order through the provider-neutral contract. | `test/unit/muse-audio-fallback.test.ts:40`-`test/unit/muse-audio-fallback.test.ts:50` assert the exact two-chunk JSON-domain contract; `test/integration/http-app.test.ts:108`-`test/integration/http-app.test.ts:110` assert the exact HTTP JSON; `test/unit/transcript-pdf.test.ts:99`-`test/unit/transcript-pdf.test.ts:111` assert every segment is preserved once and in order; `test/unit/transcript-pdf.test.ts:150`-`test/unit/transcript-pdf.test.ts:157` assert exact renderer payload order. | PASS |
| MUSE-09 | Media preparation emits ordered mono 16 kHz/48 kbps MP3 chunks no longer than 600 seconds and rejects any chunk over 8 MiB before Muse. | `test/unit/audio-media-pipeline.test.ts:32`-`test/unit/audio-media-pipeline.test.ts:70` assert ordered paths and the exact FFmpeg arguments `-ac 1`, `-ar 16000`, `-b:a 48k`, `-segment_time 600`, and `.mp3`; `test/unit/audio-media-pipeline.test.ts:73`-`test/unit/audio-media-pipeline.test.ts:87` assert an 8 MiB + 1 byte chunk returns exact `AUDIO_CHUNK_TOO_LARGE`/502 and never invokes the consumer. | PASS |
| MUSE-10 | A failed Muse chunk is sent once with no automatic retry. | `test/unit/muse-audio-transcriber.test.ts:70`-`test/unit/muse-audio-transcriber.test.ts:82` assert the exact failure and `expect(create).toHaveBeenCalledTimes(1)`. | PASS |

**Status**: 10/10 ACs match the spec-defined outcomes. No spec-precision gaps.

## Edge Cases

| Edge case | Evidence | Result |
| --- | --- | --- |
| Whitespace-only Muse output returns `MUSE_TRANSCRIPTION_FAILED`. | `test/unit/muse-audio-transcriber.test.ts:85`-`test/unit/muse-audio-transcriber.test.ts:100` - table case and exact code/status assertion. | PASS |
| Reasoning items without `output_text` return `MUSE_TRANSCRIPTION_FAILED`. | `test/unit/muse-audio-transcriber.test.ts:87` and `test/unit/muse-audio-transcriber.test.ts:95`-`test/unit/muse-audio-transcriber.test.ts:100` - exact response and exact code/status. | PASS |
| Locales and duplicates become unique primary language codes in input order. | `test/unit/muse-audio-transcriber.test.ts:11` supplies `pt-BR`, duplicate `pt`, and `en-US`; `test/unit/muse-audio-transcriber.test.ts:54` asserts `pt, en`. | PASS |
| A chunk over 8 MiB stops before Muse and returns `AUDIO_CHUNK_TOO_LARGE`. | `test/unit/audio-media-pipeline.test.ts:75` sets 8 MiB + 1; `test/unit/audio-media-pipeline.test.ts:83`-`test/unit/audio-media-pipeline.test.ts:87` assert exact failure and no consumer call. | PASS |

## Gate Check

- **Gate command**: `npm run check`
- **Result**: PASS - Biome checked 29 files; typecheck passed; 10 test files and 74 tests passed; build passed.
- **Failures**: none.
- **Skipped tests**: none.
- **Scoped confirmation**: all seven named test files passed, 50/50 tests.
- **Test count before feature (`658678b`)**: 68 tests in 8 files, measured by running `npm test` in an isolated baseline worktree.
- **Test count after feature (`7f412a7`)**: 74 tests in 10 files.
- **Delta**: +6 tests and +2 test files.

### Test Integrity and OpenAI Test Removal

The removed `test/unit/openai-audio-fallback.test.ts` contained five provider-specific cases for the
deleted OpenAI SDK adapter: sequential OpenAI requests, OpenAI failure, whitespace output, missing
OpenAI configuration, and the OpenAI-specific transcript contract. Retaining those tests would require
the deliberately removed SDK and obsolete `openai_transcription`/`OPENAI_TRANSCRIPTION_FAILED`
behavior. The replacement suite adds eleven executed cases: seven Muse request/response cases, two Muse
fallback cases, and two runtime configuration cases. These preserve the five provider-neutral behaviors
while adding exact OpenCode endpoint/auth/payload checks, reasoning-only and malformed response cases,
no-retry proof, response-body secrecy, and `OPENCODE_API_KEY` normalization. The +6 net count and exact
assertions demonstrate justified replacement rather than weakened deletion.

## Discrimination Sensor

The sensor ran in `/tmp/muse-sensor-XeM7go`, a detached temporary worktree at `7f412a7`. Dependencies
were installed inside that worktree. No mutation touched the real tree, and no stash was used.

| Mutation | File:line | Description | Targeted result | Killed? |
| --- | --- | --- | --- | --- |
| 1 | `src/infrastructure/audio/muse-audio-transcriber.ts:6` | Changed chunk offset constant from 600 to 601 seconds. | `test/unit/muse-audio-transcriber.test.ts:37` failed with received second offset 601 instead of 600. | PASS - killed |
| 2 | `src/infrastructure/audio/audio-media-pipeline.ts:8` | Raised the maximum chunk size from 8 MiB to 9 MiB. | `test/unit/audio-media-pipeline.test.ts:83` failed because the 8 MiB + 1 chunk resolved instead of rejecting. | PASS - killed |
| 3 | `src/infrastructure/audio/muse-audio-fallback.ts:41` | Changed `isGenerated` from `true` to `false`. | `test/unit/muse-audio-fallback.test.ts:40` failed on the exact unified transcript assertion. | PASS - killed |

- **Sensor depth**: lightweight, three high-risk behavior-level mutations.
- **Result**: 3/3 killed, 0 survived - PASS.
- **Isolation evidence**: real-tree `git status --porcelain=v1` was empty before the sensor and empty after forced temporary-worktree removal.

## Code Quality

| Principle | Status | Evidence |
| --- | --- | --- |
| Minimum code / no scope creep | PASS | The change replaces one external provider, its configuration, error/source names, and related tests; no unrelated product behavior was added. |
| Surgical changes | PASS | `git diff --check 658678b..7f412a7` passed. Media changes are limited to the specified 600-second and 8 MiB limits. |
| Matches project patterns | PASS | The existing `AudioFallback`, `AudioChunkSource`, typed `AppError`, dependency injection, and provider-neutral transcript/PDF contracts are retained. |
| No unnecessary flexibility | PASS | Endpoint/model/reasoning and limits are fixed to the confirmed spec; injectable fetch/read/process adapters exist only at external test boundaries. |
| Spec-anchored outcomes | PASS | 10/10 ACs have precise value assertions above; no vague or existence-only substitute was used for a spec-defined value. |
| Per-layer coverage | PASS | Request adapter, media boundary, fallback/domain composition, application orchestration, HTTP routes, JSON contract, and PDF model/renderer all have behavior tests. |
| Every scoped test is claimed | PASS | Muse transcriber/fallback/config map MUSE-01 through MUSE-05/MUSE-10; pipeline maps MUSE-07/MUSE-09 and request isolation; hybrid maps MUSE-06/MUSE-08; PDF and HTTP regression cases protect the provider-neutral JSON/PDF goal and MUSE-03/MUSE-04/MUSE-05/MUSE-07/MUSE-08. |
| Project guidelines | PASS | `README.md:8`-`README.md:19` documents the required captions-first sequence, 10-minute chunks, sequential Muse calls, cleanup, and zero-call paths; no separate contributor/testing guide exists, so strong project defaults were applied. |
| Senior review | PASS | Error translation is typed and public-safe, secrets remain at the infrastructure boundary, cleanup is `finally`-backed, and the suite discriminates the highest-risk exact values. |

## Active OpenAI Residue Audit

- `src/`, `test/`, `package.json`, `package-lock.json`, `.env.example`, and `README.md` contain zero
  `openai`, `OPENAI_API_KEY`, `openai_transcription`, or `gpt-transcribe` matches.
- `package.json:14`-`package.json:17` contains only the caption, HTTP, and PDF runtime dependencies;
  the OpenAI SDK and its lockfile entries are absent.
- Repository-wide matches are limited to the replacement feature's problem/history text, superseded
  decisions and handoff history in `.specs/STATE.md`, and the prior feature's immutable specification,
  design, tasks, and validation artifacts. They are historical traceability, not active runtime code,
  configuration, tests, dependency metadata, or current README guidance.

**Result**: no active OpenAI runtime residue.

## Requirement Traceability

| Requirement | Spec status | Verified status |
| --- | --- | --- |
| MUSE-01 through MUSE-10 | Verified | PASS - independently verified |

No traceability edit was required; the spec already records all ten requirements as Verified.

## Lessons

This is a clean PASS: the gate passed, every AC has evidence, there are no spec-precision gaps,
surviving mutants, or `SPEC_DEVIATION` markers. Per the TLC lessons protocol, no lesson was recorded.

## Summary

**Overall**: PASS - Ready

- **Spec-anchored check**: 10/10 ACs matched exact spec outcomes; 0 precision gaps.
- **Edge cases**: 4/4 passed.
- **Sensor**: 3/3 mutations killed; real-tree isolation preserved.
- **Gate**: 74/74 passed, 0 failed, 0 skipped; lint, typecheck, and build passed.
- **Test integrity**: 68 before, 74 after, +6; obsolete OpenAI tests were behaviorally replaced.
- **Issues found**: none.
