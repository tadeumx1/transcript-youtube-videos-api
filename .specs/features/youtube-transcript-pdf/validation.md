# Hybrid YouTube Transcript PDF API Validation

## Validation: youtube-transcript-pdf - FAIL

**Date**: 2026-08-25  
**Spec**: `.specs/features/youtube-transcript-pdf/spec.md`  
**Diff range**: repository root `b3c115d` through `f85cbcb` inclusive  
**Verified HEAD**: `f85cbcb58cf440b5c700c4a38f22f9c2f1a1eb37`  
**Verifier**: independent sub-agent; implementation commits are authored by Matheus Tadeu, so author != verifier

The implementation is not ready to close. The build gate passes, but YTPDF-03 loses a
character-for-character preservation guarantee for an unbroken token longer than 1,500 characters.
The discrimination sensor also proved that the tests do not detect removal of all rendered PDF
transcript text.

---

## Task Completion

| Task | Status | Evidence and notes |
| ---- | ------ | ------------------ |
| T1 | ✅ Done | Pinned manifest and strict configuration are present at `package.json:6`, `package.json:21`, and `tsconfig.json:7`; the build gate passes. |
| T2 | ✅ Done | The supported and rejected URL matrices assert exact results at `test/unit/youtube-url.test.ts:17` and `test/unit/youtube-url.test.ts:30`. |
| T3 | ✅ Done | Eight caption-adapter cases pass; exact transcript mapping is asserted at `test/unit/youtube-caption-provider.test.ts:44`. |
| T4 | ✅ Done | Thirteen process, media, and OpenAI cases pass; command construction is asserted at `test/unit/audio-media-pipeline.test.ts:35` and request payloads at `test/unit/openai-audio-fallback.test.ts:36`. |
| T5 | ✅ Done | Five orchestration cases pass; source selection and provider isolation are asserted at `test/unit/hybrid-transcript-service.test.ts:52` and `test/unit/hybrid-transcript-service.test.ts:60`. |
| T6 | ❌ Needs fix | The existing bound/order assertion at `test/unit/transcript-pdf.test.ts:56` misses a real long-token content change, and a renderer-content mutant at `src/infrastructure/pdf/transcript-pdf.ts:140` survived all six PDF tests. |
| T7 | ✅ Done | Twenty-one route integration cases pass; exact response contracts and error mappings are asserted at `test/integration/http-app.test.ts:78` and `test/integration/http-app.test.ts:199`. |
| T8 | ⚠️ Limited | `npm run build` and local health/invalid-URL smoke requests pass. Docker is unavailable in the verifier environment, so only structural Dockerfile evidence was checked at `Dockerfile:3`, `Dockerfile:17`, `Dockerfile:18`, `Dockerfile:30`, and `Dockerfile:37`. |

All eight tasks are checked in `tasks.md`, but those checkboxes were not used as validation evidence.

---

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | `file:line` + assertion | Result |
| ----------- | -------------------- | ----------------------- | ------ |
| YTTR-01 | Caption success returns HTTP 200 and the full unified caption contract. | `test/unit/youtube-caption-provider.test.ts:44` - `resolves.toEqual(...)`; `test/integration/http-app.test.ts:79` - `expect(response.json()).toEqual(captionTranscript)` | ✅ PASS |
| YTTR-02 | Known caption unavailability invokes the audio path and `gpt-transcribe`. | `test/unit/hybrid-transcript-service.test.ts:74` - `expect(transcribe).toHaveBeenCalledWith(...)`; `test/unit/openai-audio-fallback.test.ts:39` - `model: 'gpt-transcribe'` | ✅ PASS |
| YTTR-03 | Successful fallback returns HTTP 200, the same fields, OpenAI source, generated flag, and chunk precision. | `test/integration/http-app.test.ts:109` - `expect(response.json()).toEqual(fallbackTranscript)` | ✅ PASS |
| YTTR-04 | `text` contains every non-empty segment in chronological order without truncation. | `test/unit/hybrid-transcript-service.test.ts:53` - exact ordered text; `test/unit/openai-audio-fallback.test.ts:116` - exact multi-chunk text | ✅ PASS |
| YTTR-05 | Omitted languages use `pt-BR`, `pt`, then `en`. | `test/unit/youtube-caption-provider.test.ts:66` - exact language array; `test/unit/hybrid-transcript-service.test.ts:55` - exact provider input | ✅ PASS |
| YTTR-06 | Invalid URL returns HTTP 400 `INVALID_YOUTUBE_URL` before either provider. | `test/integration/http-app.test.ts:175` - exact status; `test/integration/http-app.test.ts:176` - exact code; `test/integration/http-app.test.ts:177` - provider not called | ✅ PASS |
| YTTR-07 | Unavailable, private, and age-restricted outcomes return HTTP 404 `VIDEO_NOT_AVAILABLE`. | `test/unit/youtube-caption-provider.test.ts:102` - exact code/status over `VideoUnavailable` and `AgeRestricted`; `test/integration/http-app.test.ts:199` - route status mapping | ✅ PASS |
| YTTR-08 | Missing API key on required fallback returns HTTP 503 `AUDIO_FALLBACK_NOT_CONFIGURED` before media work. | `test/unit/openai-audio-fallback.test.ts:88` - exact code/status; `test/unit/openai-audio-fallback.test.ts:92` - media not called | ✅ PASS |
| YTTR-09 | Missing media executable returns HTTP 503 `AUDIO_TOOL_UNAVAILABLE`. | `test/unit/process-runner.test.ts:53` - exact code/status; `test/integration/http-app.test.ts:199` - route status mapping | ✅ PASS |
| YTTR-10 | Started media command failure returns HTTP 502 `AUDIO_EXTRACTION_FAILED`. | `test/unit/process-runner.test.ts:62` - exact code/status; `test/integration/http-app.test.ts:199` - route status mapping | ✅ PASS |
| YTTR-11 | OpenAI rejection/failure returns HTTP 502 `OPENAI_TRANSCRIPTION_FAILED`. | `test/unit/openai-audio-fallback.test.ts:60` - exact code/status; `test/integration/http-app.test.ts:199` - route status mapping | ✅ PASS |
| YTTR-12 | Unexpected caption failure returns HTTP 502 `YOUTUBE_UPSTREAM_ERROR` and never invokes audio. | `test/unit/youtube-caption-provider.test.ts:111` - exact code/status; `test/unit/hybrid-transcript-service.test.ts:95` - same error; `test/unit/hybrid-transcript-service.test.ts:96` - audio not called | ✅ PASS |
| YTTR-13 | All five supported URL shapes produce the same 11-character ID. | `test/unit/youtube-url.test.ts:17` - exact `{ videoId, canonicalUrl }` for the five-row table | ✅ PASS |
| YTTR-14 | Empty/whitespace provider results are unavailable, not successful. | `test/unit/youtube-caption-provider.test.ts:90` - exact unavailable error; `test/unit/hybrid-transcript-service.test.ts:85` - empty caption result falls back | ✅ PASS |
| YTAUD-01 | `yt-dlp` receives the canonical URL, `--no-playlist`, and a request-local output template. | `test/unit/audio-media-pipeline.test.ts:35` - exact first command and argument array | ✅ PASS |
| YTAUD-02 | FFmpeg runs without a shell and creates mono 16 kHz, 48 kbps, 1,200-second MP3 chunks. | `test/unit/audio-media-pipeline.test.ts:45` - exact FFmpeg array; `test/unit/process-runner.test.ts:40` - `shell: false` | ✅ PASS |
| YTAUD-03 | A chunk over 24 MB stops before OpenAI and returns HTTP 502 `AUDIO_CHUNK_TOO_LARGE`. | `test/unit/audio-media-pipeline.test.ts:83` - exact code/status rejection; `test/unit/audio-media-pipeline.test.ts:87` - consumer not called | ✅ PASS |
| YTAUD-04 | Multiple chunks are transcribed sequentially and concatenated in order. | `test/unit/openai-audio-fallback.test.ts:30` - exact ordered segment result; `test/unit/openai-audio-fallback.test.ts:36` - exact ordered requests | ✅ PASS |
| YTAUD-05 | Only the request directory is removed on success and failure. | `test/unit/audio-media-pipeline.test.ts:100` and `test/unit/audio-media-pipeline.test.ts:119` - exact recursive removal target/options | ✅ PASS |
| YTAUD-06 | OpenAI receives automotive Brazilian Portuguese context and normalized language hints. | `test/unit/openai-audio-fallback.test.ts:36` - exact model/languages/keywords; `test/unit/openai-audio-fallback.test.ts:49` - prompt content | ✅ PASS |
| YTAUD-07 | Concurrent fallbacks use different temporary paths. | `test/unit/audio-media-pipeline.test.ts:138` - exact distinct path array | ✅ PASS |
| YTPDF-01 | PDF success returns HTTP 200, PDF content type, and a video-ID attachment filename. | `test/integration/http-app.test.ts:122` through `test/integration/http-app.test.ts:127` - exact status, headers, and signature | ✅ PASS |
| YTPDF-02 | The generated PDF contains all provenance metadata and complete chronological transcript text. | `test/unit/transcript-pdf.test.ts:29` asserts the model only. No assertion reads the final PDF text; mutation M2 at `src/infrastructure/pdf/transcript-pdf.ts:140` removed all rendered transcript content and survived. | ❌ GAP |
| YTPDF-03 | Timestamped paragraphs stay at or below 1,500 characters and preserve every segment's text. | `test/unit/transcript-pdf.test.ts:56` checks the bound and `test/unit/transcript-pdf.test.ts:57` checks ordinary spaced text. A direct probe of `src/infrastructure/pdf/transcript-pdf.ts:42` with one 1,501-character token produced lengths 1,500 and 1 and reconstructed length 1,502 from original length 1,501. | ❌ FAIL |
| YTPDF-04 | PDF transcript-retrieval failures preserve the JSON endpoint status and typed error. | `test/integration/http-app.test.ts:192` - both endpoint loop; `test/integration/http-app.test.ts:199` and `test/integration/http-app.test.ts:200` - exact status/code | ✅ PASS |
| YTPDF-05 | Multi-page output adds pages without dropping content. | `test/unit/transcript-pdf.test.ts:89` asserts only more than one page. Mutation M2 removed every rendered paragraph payload and the test still passed. | ❌ GAP |
| YTPDF-06 | Brazilian Portuguese diacritics remain unchanged in the PDF document model. | `test/unit/transcript-pdf.test.ts:65` - exact `.toBe(text)` assertion | ✅ PASS |
| YTOPS-01 | `GET /health` returns exactly HTTP 200 and `{ "status": "ok" }` without dependencies. | `test/integration/http-app.test.ts:63` through `test/integration/http-app.test.ts:66` - exact status/body and no dependency calls | ✅ PASS |
| YTOPS-02 | Fastify JSON Schema rejects unknown properties and invalid bodies. | `test/integration/http-app.test.ts:147` - invalid-body table; `test/integration/http-app.test.ts:156` and `test/integration/http-app.test.ts:157` - exact status/body | ✅ PASS |
| YTOPS-03 | Logs are structured and exclude transcript, media/PDF content, credentials, and provider causes. | `test/integration/http-app.test.ts:285` through `test/integration/http-app.test.ts:291` - allowed metadata present and sensitive payload/cause values absent | ✅ PASS |
| YTOPS-04 | The project test command runs unit and route tests without real external providers or media tools. | `package.json:13` - isolated Vitest command; gate execution produced 45 unit and 21 integration passes with zero skips | ✅ PASS |
| YTOPS-05 | The documented image contains Node.js, `yt-dlp`, FFmpeg, and the compiled API. | Structural evidence: `Dockerfile:3`, `Dockerfile:12`, `Dockerfile:17`, `Dockerfile:18`, `Dockerfile:30`, and `Dockerfile:37`; Docker executable unavailable, so no image-build claim is made | ⚠️ LIMITED STRUCTURAL PASS |

**Status**: 29/32 requirements match the specified outcome; three PDF requirements have failed or
unproven content guarantees. There are zero spec-precision gaps.

---

## Discrimination Sensor

The sensor ran in detached temporary worktree
`/tmp/youtube-transcript-verifier.8R2yUk/worktree` at `f85cbcb`. The main-tree
`git status --porcelain` was empty before the sensor and empty after worktree removal.

| Mutation | File:line | Description | Relevant command and outcome | Killed? |
| -------- | --------- | ----------- | ---------------------------- | ------- |
| M1 | `src/infrastructure/audio/audio-media-pipeline.ts:8` | Changed the upload guard from 24 MB to 25 MB. | Unit suite: 44 passed, 1 failed at `test/unit/audio-media-pipeline.test.ts:83` because the promise resolved instead of rejecting. | ✅ Killed |
| M2 | `src/infrastructure/pdf/transcript-pdf.ts:140` | Replaced every rendered transcript paragraph with `[CONTENT REMOVED]`. | `vitest run test/unit/transcript-pdf.test.ts`: 6 passed, 0 failed. | ❌ Survived |

**Sensor depth**: lightweight, two targeted behavior mutations  
**Result**: 1/2 killed - FAIL

---

## Edge Cases

- [x] YTTR-13: all supported URL forms canonicalize to the same ID.
- [x] YTTR-14: empty and whitespace-only provider content cannot return success.
- [x] YTAUD-07: concurrent fallbacks receive distinct request directories.
- [ ] YTPDF-05: page count is asserted, but retained rendered content is not.
- [x] YTPDF-06: Portuguese diacritics are preserved in the document model.

---

## Gate Check

- **Gate command**: `npm run check`
- **Result**: exit 0; lint, strict typecheck, tests, and production build passed
- **Unit tests**: 45 passed, 0 failed, 0 skipped across 7 files
- **Integration tests**: 21 passed, 0 failed, 0 skipped across 1 file
- **Total**: 66 passed, 0 failed, 0 skipped across 8 files
- **Test count before feature**: no pre-feature parent commit exists; the root T1 commit contains zero tracked test files
- **Test count after feature**: 66
- **Delta from the root foundation before T2 tests**: +66
- **Integrity**: `git log --numstat -- test` shows only additions; no test file was deleted or weakened in later commits
- **Docker**: unavailable (`docker: command not found`); Dockerfile inspected structurally only
- **Runtime smoke**: compiled server returned HTTP 200 `{ "status": "ok" }` and HTTP 400 `INVALID_YOUTUBE_URL`

The deterministic artifact checks also passed:

- `validate_spec.py`: 0 errors, 0 warnings
- `validate_tasks.py`: 0 errors, 2 expected warnings for T1/T8 build-gate-only tasks

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ No unnecessary application abstraction found |
| Surgical changes | ✅ Commit surfaces follow the eight task boundaries |
| No scope creep | ✅ Implementation stays within the approved API, media, PDF, and operations scope |
| Matches project patterns | ✅ Strict TypeScript, ESM, injected adapters, Fastify injection, and typed errors are consistent |
| Spec-anchored outcome check | ❌ Final rendered PDF text is not asserted, and YTPDF-03 fails for a valid long-token input |
| Per-layer coverage expectation | ❌ PDF renderer content lacks a discriminating outcome assertion |
| Every scoped test maps to an AC, edge case, design error, or Done When | ✅ No unclaimed test found |
| Payload/conjunction rule | ❌ PDFKit `.text()` payload values can regress while the suite remains green |
| Documented guidelines | ✅ `.specs/features/youtube-transcript-pdf/tasks.md:11` plus strong defaults |

---

## Fix Plans

### Fix 1: Preserve long unbroken segment text across bounded PDF paragraphs

- **Root cause**: `splitWords()` slices a token into 1,500-character pieces, then the paragraph
  accumulator inserts a space between pieces at `src/infrastructure/pdf/transcript-pdf.ts:64` and
  `src/infrastructure/pdf/transcript-pdf.ts:72`.
- **Fix task**: represent split-token continuations without adding a separator, and render continued
  fragments without adding content that was absent from the segment.
- **Verify**: add a spec-derived test with a 1,501+ character unbroken token. Assert every paragraph
  is at most 1,500 characters and exact reconstruction contains neither inserted nor dropped text.
- **Done when**: YTPDF-03 passes for normal text, repeated whitespace policy, and an unbroken token.
- **Priority**: Major

### Fix 2: Make generated-PDF content tests discriminating

- **Root cause**: model tests assert metadata and paragraph values, while renderer tests assert only
  PDF signature and page count. The final PDF payload is never inspected.
- **Fix task**: add a renderer-level assertion that extracts searchable PDF text or captures every
  PDFKit text payload. Assert all required metadata and every transcript paragraph value in order.
- **Verify**: repeat M2; replacing `paragraph.text` with a constant must fail the relevant PDF test.
- **Done when**: YTPDF-02 and YTPDF-05 have final-artifact assertions and the renderer mutant is killed.
- **Priority**: Major

### Verification follow-up: Build the Docker image where Docker is available

- **Reason**: this environment has no Docker executable.
- **Verify**: run `docker build`, start the image, check `/health`, and verify `node`, `yt-dlp`, and
  `ffmpeg` inside the runtime image.
- **Priority**: Operational verification

---

## Interactive UAT

Not performed. This is a backend-only service, and the automated plus local HTTP smoke checks cover
the user-observable routes. Docker remains the documented environment limitation above.

---

## Requirement Traceability Assessment

The verifier did not modify `spec.md`, per the requester's read-only restriction. These are the
status changes required after fixes and re-verification.

| Requirement | Previous status | Validation status |
| ----------- | --------------- | ----------------- |
| YTTR-01 through YTTR-14 | Implementing | ✅ Verified |
| YTAUD-01 through YTAUD-07 | Implementing | ✅ Verified |
| YTPDF-01 | Implementing | ✅ Verified |
| YTPDF-02 | Implementing | ❌ Needs fix: final PDF content evidence |
| YTPDF-03 | Implementing | ❌ Needs fix: long-token preservation |
| YTPDF-04 | Implementing | ✅ Verified |
| YTPDF-05 | Implementing | ❌ Needs fix: retained multi-page content evidence |
| YTPDF-06 | Implementing | ✅ Verified |
| YTOPS-01 through YTOPS-04 | Implementing | ✅ Verified |
| YTOPS-05 | Implementing | ⚠️ Structurally verified; Docker build not executed |

---

## Lessons Distillation

This validation produced `ac_gap` and `surviving_mutant` signals. The requester explicitly allowed
only `validation.md` to change in the main workspace, so `.specs/lessons.json` and
`.specs/LESSONS.md` were not created or modified.

---

## Summary

**Overall**: ❌ Not ready  
**Spec-anchored check**: 29/32 requirements matched; 0 spec-precision gaps  
**Sensor**: 1/2 mutations killed; one PDF-content mutant survived  
**Gate**: 66/66 tests passed, zero skipped; lint, typecheck, and build passed  
**Next step**: implement the two PDF fix tasks, then dispatch a fresh independent Verifier
