# Hybrid YouTube Transcript PDF API Validation

## Validation: youtube-transcript-pdf - PASS ✅

**Date**: 2026-08-25
**Spec**: `.specs/features/youtube-transcript-pdf/spec.md`
**Diff range**: repository root `b3c115d` through `eaafcdb` inclusive
**Correction range re-verified**: `0d43170..eaafcdb`
**Verified HEAD**: `eaafcdbf914333134e2956dd7b37ffe646f18ba4`
**Verifier**: fresh independent sub-agent `/root/verifier2`
**Author separation**: implementation and correction commits are authored by Matheus Tadeu; this
Verifier did not author code or tests, so author != verifier

All 32 requirements match the specified outcome. The two previous PDF gaps are closed: exact
paragraph reconstruction is bounded at 1,500 characters, every renderer payload is asserted, and
both targeted regressions are killed by the current PDF tests. The only environment limitation is
that Docker is not installed; YTOPS-05 therefore has structural Dockerfile evidence without a
fabricated image-build result.

---

## Task Completion

| Task | Status | Evidence and notes |
| ---- | ------ | ------------------ |
| T1 | ✅ Done | Pinned runtime and development dependencies are declared at `package.json:6` and `package.json:21`; strict TypeScript is enabled at `tsconfig.json:7`; the build gate passes. |
| T2 | ✅ Done | The five accepted URL forms and eight rejected forms assert exact outcomes at `test/unit/youtube-url.test.ts:10` and `test/unit/youtube-url.test.ts:20`. |
| T3 | ✅ Done | Caption mapping, default languages, unavailable outcomes, empty content, and typed upstream failures are asserted at `test/unit/youtube-caption-provider.test.ts:41`, `test/unit/youtube-caption-provider.test.ts:61`, and `test/unit/youtube-caption-provider.test.ts:69`. |
| T4 | ✅ Done | Safe process arguments, bounded chunks, sequential OpenAI calls, normalized hints, failures, and cleanup are asserted at `test/unit/process-runner.test.ts:34`, `test/unit/audio-media-pipeline.test.ts:26`, and `test/unit/openai-audio-fallback.test.ts:22`. |
| T5 | ✅ Done | Caption-first selection, typed fallback, provider isolation, chronological text, and empty fallback rejection are asserted at `test/unit/hybrid-transcript-service.test.ts:47` through `test/unit/hybrid-transcript-service.test.ts:107`. |
| T6 | ✅ Done | Metadata, timestamps, ordered paragraph content, Unicode, real PDF signature/page count, payload delivery, and renderer failure mapping are asserted at `test/unit/transcript-pdf.test.ts:80` through `test/unit/transcript-pdf.test.ts:168`. |
| T7 | ✅ Done | Twenty-one route cases cover health, both transcript outcomes, PDF delivery, schemas, typed failures, and safe logs at `test/integration/http-app.test.ts:58` through `test/integration/http-app.test.ts:291`. |
| T8 | ✅ Done with environment limitation | `npm run build` and local HTTP smoke checks passed. Node, FFmpeg, pinned `yt-dlp`, compiled output, non-root runtime, health check, and entrypoint are structurally present at `Dockerfile:3`, `Dockerfile:12`, `Dockerfile:17`, `Dockerfile:18`, `Dockerfile:30`, `Dockerfile:32`, `Dockerfile:34`, and `Dockerfile:37`. Docker is unavailable, so no image build was claimed. |
| T9 | ✅ Done | A 1,501-character token reconstructs exactly as 1,500 plus 1 characters at `test/unit/transcript-pdf.test.ts:114`; the general exact-stream and bound assertion is at `test/unit/transcript-pdf.test.ts:99`. Mutation M2 independently confirms discrimination. |
| T10 | ✅ Done | Every metadata and multi-page transcript payload passed to PDFKit is asserted in exact order at `test/unit/transcript-pdf.test.ts:150`; mutation M1 independently confirms discrimination. |

All ten tasks are checked in `tasks.md`. The checkboxes were reconciled with implementation, test,
gate, and mutation evidence rather than treated as proof.

---

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | `file:line` + assertion | Result |
| ----------- | -------------------- | ----------------------- | ------ |
| YTTR-01 | Caption success returns HTTP 200 with the canonical unified caption contract and every ordered segment. | `test/unit/youtube-caption-provider.test.ts:44` - `resolves.toEqual(...)`; `test/integration/http-app.test.ts:78` - exact status; `test/integration/http-app.test.ts:79` - `expect(response.json()).toEqual(captionTranscript)` | ✅ PASS |
| YTTR-02 | Disabled or unavailable requested captions invoke audio fallback and `gpt-transcribe`. | `test/unit/youtube-caption-provider.test.ts:69` - both unavailable exception cases; `test/unit/hybrid-transcript-service.test.ts:74` - exact fallback input; `test/unit/openai-audio-fallback.test.ts:39` - exact model | ✅ PASS |
| YTTR-03 | Successful fallback returns HTTP 200 with the same fields, OpenAI source, generated flag, and chunk precision. | `test/integration/http-app.test.ts:108` - exact status; `test/integration/http-app.test.ts:109` - exact fallback contract | ✅ PASS |
| YTTR-04 | Unified text contains every non-empty segment in chronological order without truncation. | `test/unit/hybrid-transcript-service.test.ts:53` - exact ordered text; `test/unit/hybrid-transcript-service.test.ts:54` - exact start order; `test/unit/openai-audio-fallback.test.ts:116` - exact multi-chunk text | ✅ PASS |
| YTTR-05 | Omitted languages try `pt-BR`, `pt`, then `en`. | `test/unit/youtube-caption-provider.test.ts:66` - exact provider language array; `test/unit/hybrid-transcript-service.test.ts:55` - exact service input | ✅ PASS |
| YTTR-06 | Malformed, unsupported-host, or invalid-ID URLs return HTTP 400 `INVALID_YOUTUBE_URL` before providers. | `test/unit/youtube-url.test.ts:20` - exact rejected matrix; `test/integration/http-app.test.ts:175` - exact status; `test/integration/http-app.test.ts:176` - exact code; `test/integration/http-app.test.ts:177` - dependency not called | ✅ PASS |
| YTTR-07 | Unavailable, private, and age-restricted videos return HTTP 404 `VIDEO_NOT_AVAILABLE`. | `test/unit/youtube-caption-provider.test.ts:96` - unavailable/private and age-restricted exception matrix; `test/unit/youtube-caption-provider.test.ts:102` - exact code/status; `src/infrastructure/youtube/youtube-caption-provider.ts:79` - all unavailable classes mapped | ✅ PASS |
| YTTR-08 | Required fallback without `OPENAI_API_KEY` returns HTTP 503 `AUDIO_FALLBACK_NOT_CONFIGURED` before media work. | `test/unit/openai-audio-fallback.test.ts:88` - exact code/status; `test/unit/openai-audio-fallback.test.ts:92` - `withChunks` not called | ✅ PASS |
| YTTR-09 | Missing `yt-dlp` or FFmpeg returns HTTP 503 `AUDIO_TOOL_UNAVAILABLE`. | `test/unit/process-runner.test.ts:53` - generic runner rejects missing executable with exact code/status; `test/integration/http-app.test.ts:182` - route error matrix | ✅ PASS |
| YTTR-10 | Started audio-tool failure returns HTTP 502 `AUDIO_EXTRACTION_FAILED`. | `test/unit/process-runner.test.ts:62` - exact code/status on non-zero exit; `test/integration/http-app.test.ts:199` - exact route status | ✅ PASS |
| YTTR-11 | OpenAI rejection or failure returns HTTP 502 `OPENAI_TRANSCRIPTION_FAILED`. | `test/unit/openai-audio-fallback.test.ts:60` - exact code/status; `test/integration/http-app.test.ts:199` - exact route status | ✅ PASS |
| YTTR-12 | Unexpected caption failure returns HTTP 502 `YOUTUBE_UPSTREAM_ERROR` without audio fallback. | `test/unit/youtube-caption-provider.test.ts:111` - exact code/status; `test/unit/hybrid-transcript-service.test.ts:95` - exact propagated error; `test/unit/hybrid-transcript-service.test.ts:96` - audio not called | ✅ PASS |
| YTTR-13 | All five supported YouTube URL forms extract the same exact 11-character ID. | `test/unit/youtube-url.test.ts:10` - five-form table; `test/unit/youtube-url.test.ts:17` - exact `{ videoId, canonicalUrl }` | ✅ PASS |
| YTTR-14 | Empty or whitespace-only provider content is unavailable rather than a successful response. | `test/unit/youtube-caption-provider.test.ts:84` - whitespace provider fixture; `test/unit/youtube-caption-provider.test.ts:90` - exact unavailable error; `test/unit/hybrid-transcript-service.test.ts:85` - empty provider result falls back | ✅ PASS |
| YTAUD-01 | Audio fallback invokes `yt-dlp` with canonical URL, `--no-playlist`, and a request-local template. | `test/unit/audio-media-pipeline.test.ts:35` - exact first command and argument array | ✅ PASS |
| YTAUD-02 | FFmpeg runs without a shell and emits mono 16 kHz MP3 chunks of at most 20 minutes. | `test/unit/audio-media-pipeline.test.ts:45` - exact FFmpeg array including mono, 16 kHz, MP3, and 1,200 seconds; `test/unit/process-runner.test.ts:40` - exact `shell: false` spawn | ✅ PASS |
| YTAUD-03 | Any chunk over 24 MB stops before OpenAI with HTTP 502 `AUDIO_CHUNK_TOO_LARGE`. | `test/unit/audio-media-pipeline.test.ts:83` - exact code/status; `test/unit/audio-media-pipeline.test.ts:87` - consumer not called | ✅ PASS |
| YTAUD-04 | Multiple chunks are transcribed sequentially and concatenated in chunk order. | `test/unit/openai-audio-fallback.test.ts:30` - exact ordered segment results; `test/unit/openai-audio-fallback.test.ts:36` - exact ordered requests; `test/unit/openai-audio-fallback.test.ts:108` - exact unified transcript | ✅ PASS |
| YTAUD-05 | Only the request-specific temporary directory is removed after success or error. | `test/unit/audio-media-pipeline.test.ts:100` - exact successful removal target/options; `test/unit/audio-media-pipeline.test.ts:119` - exact error-path removal target/options | ✅ PASS |
| YTAUD-06 | `gpt-transcribe` receives Brazilian automotive context and normalized language hints. | `test/unit/openai-audio-fallback.test.ts:36` - exact model, normalized languages, and keywords; `test/unit/openai-audio-fallback.test.ts:49` - Portuguese automotive prompt assertion; `src/infrastructure/audio/openai-audio-fallback.ts:71` - request construction | ✅ PASS |
| YTAUD-07 | Concurrent fallbacks use different request directories. | `test/unit/audio-media-pipeline.test.ts:133` - concurrent calls; `test/unit/audio-media-pipeline.test.ts:138` - exact distinct path array | ✅ PASS |
| YTPDF-01 | PDF success returns HTTP 200, `application/pdf`, and a video-ID attachment filename. | `test/integration/http-app.test.ts:122` - exact status; `test/integration/http-app.test.ts:123` - exact content type; `test/integration/http-app.test.ts:124` - exact filename; `test/integration/http-app.test.ts:127` - signature | ✅ PASS |
| YTPDF-02 | Final PDF rendering receives all provenance metadata and complete chronological transcript text. | `test/unit/transcript-pdf.test.ts:81` - exact seven metadata values; `test/unit/transcript-pdf.test.ts:157` - exact complete ordered PDFKit text payload list; mutation M1 replaces `paragraph.text` and is killed | ✅ PASS |
| YTPDF-03 | Timestamped paragraphs are at most 1,500 characters and preserve every segment exactly in order. | `test/unit/transcript-pdf.test.ts:108` - universal bound; `test/unit/transcript-pdf.test.ts:109` - exact reconstruction; `test/unit/transcript-pdf.test.ts:123` - exact `[1500, 1]`; `test/unit/transcript-pdf.test.ts:124` - exact long-token reconstruction; mutation M2 is killed | ✅ PASS |
| YTPDF-04 | PDF transcript-retrieval failures keep the JSON endpoint status and typed error code. | `test/integration/http-app.test.ts:182` - all specified typed failures; `test/integration/http-app.test.ts:192` - both endpoint loop; `test/integration/http-app.test.ts:199` - exact status; `test/integration/http-app.test.ts:200` - exact code | ✅ PASS |
| YTPDF-05 | Long transcript rendering creates additional PDF pages without dropping transcript content. | `test/unit/transcript-pdf.test.ts:146` - PDF signature; `test/unit/transcript-pdf.test.ts:147` - more than one real PDF page; `test/unit/transcript-pdf.test.ts:157` - every long-model paragraph payload asserted in order; mutation M1 is killed | ✅ PASS |
| YTPDF-06 | Brazilian Portuguese diacritics are preserved in the PDF model. | `test/unit/transcript-pdf.test.ts:127` - diacritic fixture; `test/unit/transcript-pdf.test.ts:130` - exact `.toBe(text)` assertion | ✅ PASS |
| YTOPS-01 | `GET /health` returns exactly HTTP 200 and `{ "status": "ok" }` without dependencies. | `test/integration/http-app.test.ts:63` - exact status; `test/integration/http-app.test.ts:64` - exact body; `test/integration/http-app.test.ts:65` and `test/integration/http-app.test.ts:66` - no dependency calls | ✅ PASS |
| YTOPS-02 | Fastify JSON Schema rejects unknown properties and invalid request bodies. | `test/integration/http-app.test.ts:138` - five invalid-body cases including unknown property; `test/integration/http-app.test.ts:156` - exact status; `test/integration/http-app.test.ts:157` - exact error body | ✅ PASS |
| YTOPS-03 | Structured logs exclude transcript text, media/PDF content, credentials, and provider causes. | `test/integration/http-app.test.ts:285` - permitted structured metadata present; `test/integration/http-app.test.ts:288` through `test/integration/http-app.test.ts:291` - all injected secrets absent; `src/http/app.ts:80` - structured response fields | ✅ PASS |
| YTOPS-04 | The project check executes unit and route integration tests without real network, OpenAI, `yt-dlp`, or FFmpeg. | `package.json:19` - lint, typecheck, tests, and build gate; `test/integration/http-app.test.ts:48` - injected application fakes; `test/unit/audio-media-pipeline.test.ts:27` - fake process runner; executed gate passed 68 tests with zero skips | ✅ PASS |
| YTOPS-05 | The Docker definition includes Node.js, `yt-dlp`, FFmpeg, and the compiled API. | Structural evidence: `Dockerfile:3` and `Dockerfile:12` - Node.js 22 stages; `Dockerfile:17` - FFmpeg; `Dockerfile:18` - pinned `yt-dlp`; `Dockerfile:30` - compiled API; `Dockerfile:37` - compiled entrypoint | ✅ PASS (structural; Docker unavailable) |

**Status**: 32/32 requirements match the spec-defined outcome. Zero spec-precision gaps and zero
uncovered acceptance criteria were found.

---

## Discrimination Sensor

The sensor ran at `eaafcdb` in detached temporary worktree
`/tmp/ytpdf-verifier2.ycpTJF/worktree`. The real workspace porcelain was clean immediately before
the sensor and byte-for-byte identical after forced worktree removal. `git worktree list` then
contained only the main workspace.

| Mutation | File:line | Description | Relevant command and outcome | Killed? |
| -------- | --------- | ----------- | ---------------------------- | ------- |
| M1 | `src/infrastructure/pdf/transcript-pdf.ts:161` | Replaced rendered `paragraph.text` with constant `[CONTENT REMOVED]`. | `npx vitest run test/unit/transcript-pdf.test.ts` exited 1: 1 failed, 7 passed. The exact payload assertion at `test/unit/transcript-pdf.test.ts:157` detected the replacement. | ✅ Killed |
| M2 | `src/infrastructure/pdf/transcript-pdf.ts:6` | Changed the paragraph bound from 1,500 to 1,501 characters. | `npx vitest run test/unit/transcript-pdf.test.ts --reporter=dot` exited 1: 2 failed, 6 passed. The general bound at `test/unit/transcript-pdf.test.ts:108` and long-token split at `test/unit/transcript-pdf.test.ts:123` detected it. | ✅ Killed |

**Sensor depth**: lightweight, two targeted high-risk PDF mutations
**Result**: 2/2 killed - PASS ✅

---

## Edge Cases

- [x] YTTR-13: all five supported URL forms canonicalize to the same video ID.
- [x] YTTR-14: empty and whitespace-only provider results cannot return success.
- [x] YTAUD-07: concurrent fallbacks use distinct request directories.
- [x] YTPDF-05: a real PDF spans multiple pages, and every long transcript payload is handed to the renderer in order.
- [x] YTPDF-06: Brazilian Portuguese diacritics remain unchanged in the document model.

---

## Gate Check

- **Gate command**: `npm run check`
- **Outcome**: exit 0; Biome checked 26 files with no fixes; strict typecheck passed; all tests passed; production build passed
- **Unit tests**: 47 passed, 0 failed, 0 skipped across 7 files
- **Integration tests**: 21 passed, 0 failed, 0 skipped across 1 file
- **Total**: 68 passed, 0 failed, 0 skipped across 8 files
- **Pre-feature test count**: unavailable because `b3c115d` is the repository root; that T1 foundation commit contains zero tracked test files
- **Baseline used for delta**: 0 tests at the root foundation before T2 added tests
- **Current test count**: 68
- **Delta**: +68 tests
- **Integrity**: the correction diff preserves the existing PDF signature/page assertion at `test/unit/transcript-pdf.test.ts:146`, strengthens exact reconstruction at `test/unit/transcript-pdf.test.ts:109`, and adds the long-token and renderer-payload assertions at `test/unit/transcript-pdf.test.ts:114` and `test/unit/transcript-pdf.test.ts:150`; no assertion was weakened
- **Artifact validators**: `validate_spec.py` returned 0 errors and 0 warnings; `validate_tasks.py` returned 0 errors and two expected build-gate-only warnings for T1/T8
- **Runtime smoke**: compiled `dist/server.js` returned HTTP 200 `{ "status": "ok" }` and HTTP 400 `INVALID_YOUTUBE_URL`, then shut down cleanly on SIGINT
- **Docker**: `docker --version` exited 127 (`command not found`); no Docker build or container smoke result is claimed

---

## OpenAI Contract Check

The installed OpenAI SDK declares `gpt-transcribe`, `keywords`, and multiple ISO-639-1
`languages` at `node_modules/openai/resources/audio/transcriptions.d.ts:539`,
`node_modules/openai/resources/audio/transcriptions.d.ts:564`, and
`node_modules/openai/resources/audio/transcriptions.d.ts:589`. The current
[official GPT-Transcribe model documentation](https://developers.openai.com/api/docs/models/gpt-transcribe)
also states that the model supports unstructured context, keyword hints, and multiple language
hints. The YTAUD-06 request shape is compatible with that contract.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ Components remain single-purpose and directly trace to the approved architecture. |
| Surgical changes | ✅ The corrections touch only the PDF model, its tests, and task bookkeeping. |
| No scope creep | ✅ No persistence, authentication, batching, retries, or other out-of-scope behavior was added. |
| Matches patterns | ✅ Strict TypeScript, ESM, injected adapters, typed errors, Vitest, and Fastify injection remain consistent. |
| Spec-anchored outcome check | ✅ All 32 criteria assert the specified value/state; there are no precision gaps. |
| Per-layer coverage expectation | ✅ Domain/adapters have branch-focused unit tests; each route has happy, validation, and typed-error coverage; PDF content now has final-renderer payload evidence. |
| Every test is claimed | ✅ Tests map to an acceptance criterion, listed edge case, design error strategy, or task Done When. |
| Payload/conjunction rule | ✅ JSON contracts and PDFKit metadata/timestamp/transcript payloads are asserted by value and order. |
| Documented guidelines | ✅ `.specs/features/youtube-transcript-pdf/tasks.md:16` through `.specs/features/youtube-transcript-pdf/tasks.md:36`; no separate project guideline exists, so strong defaults apply. |
| Senior review | ✅ No blocking correctness, test-integrity, security, or maintainability gap was found. |

---

## Interactive UAT

Not performed. This is a backend-only service. Automated route checks and local HTTP smoke tests
cover the user-observable API behavior. Docker remains the explicit environment limitation above.

---

## Fix Plans

None. No failed criterion, surviving mutant, or spec-precision gap remains.

---

## Requirement Traceability Assessment

The Verifier did not edit `spec.md`, as required. The persisted traceability table remains in its
implementation-era state; this report provides the verification state.

| Requirement group | Previous spec status | Validation status |
| ----------------- | -------------------- | ----------------- |
| YTTR-01 through YTTR-14 | Implementing | ✅ Verified |
| YTAUD-01 through YTAUD-07 | Implementing | ✅ Verified |
| YTPDF-01 through YTPDF-06 | Implementing | ✅ Verified |
| YTOPS-01 through YTOPS-04 | Implementing | ✅ Verified |
| YTOPS-05 | Implementing | ✅ Structurally verified; Docker execution unavailable |

---

## Lessons Distillation

This re-verification is a clean PASS: no surviving mutant, spec-precision gap, failed AC, or
`SPEC_DEVIATION` was found. No lesson was recorded, and `.specs/lessons.json` and
`.specs/LESSONS.md` were not created or modified.

---

## Summary

**Overall**: PASS ✅
**Spec-anchored check**: 32/32 requirements matched; 0 spec-precision gaps
**Gate**: 68/68 tests passed, 0 skipped; lint, typecheck, and build passed
**Sensor**: 2 mutations injected, 2 killed, 0 survived
**Docker**: structurally verified; executable unavailable in this environment
