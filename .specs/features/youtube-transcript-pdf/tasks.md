# Hybrid YouTube Transcript PDF API Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** The skill is the source of truth for the per-task cycle, gates, atomic commits, and independent Verifier.

**If the skill cannot be activated, STOP and tell the user.**

---

**Design**: `.specs/features/youtube-transcript-pdf/design.md`
**Status**: Approved and ready for execution

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: none; the repository has no code or quality configuration, so strong defaults apply.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain and application services | unit | All branches; 1:1 to applicable spec ACs; every listed domain edge case | `test/unit/**/*.test.ts` | `npm run test:unit` |
| External adapters | unit | Safe command/request construction, success mapping, all typed dependency failures, cleanup paths | `test/unit/**/*.test.ts` | `npm run test:unit` |
| PDF model and renderer | unit | Complete ordered content, metadata, paragraph bound, Unicode model, PDF signature | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Fastify routes | integration | Every route: happy paths, schema rejection, and every documented application error mapping | `test/integration/**/*.test.ts` | `npm run test:integration` |
| Entity, config, build, and container files | none | Build gate only | - | `npm run check` |

## Gate Check Commands

> Generated for the new TypeScript project and confirmed by the user's instruction to implement the complete feature.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm run test:unit` |
| Full | After tasks with integration tests | `npm test` |
| Build | After phase completion or config/container tasks | `npm run check` |

---

## Execution Plan

Phases are ordered and run sequentially. The feature has eight tasks, so it fits one inline batch and does not require batch workers.

### Phase 1: Foundation

```text
T1 → T2
```

### Phase 2: Providers and orchestration

```text
T2 → T3 → T4 → T5
```

### Phase 3: Delivery

```text
T5 → T6 → T7 → T8
```

---

## Task Breakdown

### T1: Initialize the typed API foundation ✅

**What**: Create the Node.js/TypeScript project configuration, dependency manifest, strict domain transcript contracts, and stable application error type.
**Where**: `.`
**Depends on**: None
**Reuses**: Approved spec, context, design, and project decisions
**Requirement**: YTOPS-03, YTOPS-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Node.js 22+, TypeScript ESM, Fastify, OpenAI, caption, PDF, Vitest, and Biome dependencies are pinned in `package.json` and lockfile.
- [x] Strict compiler, formatter/linter, test project, `.gitignore`, and `.env.example` are defined.
- [x] Provider-neutral transcript types and `AppError` are exported.
- [x] `npm run check` exits zero with no tests silently skipped.

**Tests**: none - config and domain contracts use the build gate per matrix
**Gate**: build
**Commit**: `build(api): initialize typed service foundation`

### T2: Validate and canonicalize YouTube URLs ✅

**What**: Implement the pure URL parser for supported YouTube URL shapes and exact video IDs.
**Where**: `src/domain/youtube-url.ts`
**Depends on**: T1
**Reuses**: `src/domain/errors.ts`
**Requirement**: YTTR-06, YTTR-13

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `watch`, short, `shorts`, `embed`, and `live` URLs return the same exact video ID and canonical HTTPS URL.
- [x] Non-HTTPS, deceptive subdomain, unsupported host, malformed URL, missing ID, and invalid ID inputs throw `INVALID_YOUTUBE_URL`.
- [x] Thirteen spec-derived unit tests pass.
- [x] `npm run check` exits zero because this closes Phase 1.

**Tests**: unit
**Gate**: build
**Commit**: `feat(api): validate youtube video urls`

### T3: Adapt YouTube captions to the domain contract ✅

**What**: Implement the caption provider and translate the caption library's outcomes into stable domain results or errors.
**Where**: `src/infrastructure/youtube/`
**Depends on**: T2
**Reuses**: Domain transcript contracts, canonical video IDs, `@hallelx/youtube-transcript`
**Requirement**: YTTR-01, YTTR-04, YTTR-05, YTTR-07, YTTR-12, YTTR-14

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Successful captions preserve language, generation flag, chronological segment text, start time, and duration.
- [x] Omitted languages use `pt-BR`, `pt`, then `en`.
- [x] Disabled, missing-language, and empty captions produce the typed captions-unavailable outcome.
- [x] Private, unavailable, and age-restricted videos produce `VIDEO_NOT_AVAILABLE`.
- [x] Unexpected provider failures produce `YOUTUBE_UPSTREAM_ERROR`.
- [x] Eight spec-derived caption-provider tests pass; 21 unit tests pass in total.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(captions): add youtube caption provider`

### T4: Extract and transcribe fallback audio ✅

**What**: Implement the no-shell process runner, temporary media pipeline, OpenAI chunk transcriber, and composed audio fallback.
**Where**: `src/infrastructure/audio/`
**Depends on**: T3
**Reuses**: Domain contracts, canonical URL, official OpenAI Node SDK
**Requirement**: YTTR-08, YTTR-09, YTTR-10, YTTR-11, YTAUD-01, YTAUD-02, YTAUD-03, YTAUD-04, YTAUD-05, YTAUD-06, YTAUD-07

**Tools**:

- MCP: Official OpenAI documentation
- Skill: `openai-docs`, `tlc-spec-driven`

**Done when**:

- [x] Missing API configuration stops before temporary media or subprocess work.
- [x] `yt-dlp` receives a canonical URL, `--no-playlist`, audio-only format, and a request-local output template through an argument array.
- [x] FFmpeg receives mono, 16 kHz, 48 kbps MP3, and 1,200-second segment arguments through an argument array.
- [x] Ordered chunks no larger than 24 MB are sent sequentially to `gpt-transcribe` with automotive context and normalized language hints.
- [x] Missing tools, command failure, oversized chunks, and OpenAI failure map to their specified error codes.
- [x] Unique request directories are removed after both success and failure.
- [x] Thirteen spec-derived fallback tests pass; 34 unit tests pass in total.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(transcription): add openai audio fallback`

### T5: Select captions before the billable fallback ✅

**What**: Implement the hybrid application service that returns captions first and invokes audio only for known caption unavailability.
**Where**: `src/application/hybrid-transcript-service.ts`
**Depends on**: T4
**Reuses**: Caption provider, audio fallback, domain errors and transcript types
**Requirement**: YTTR-01, YTTR-02, YTTR-03, YTTR-04, YTTR-12, YTTR-14

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Caption success returns `youtube_captions` and never calls audio fallback.
- [x] Typed caption unavailability returns `openai_transcription` from the audio fallback.
- [x] Unexpected caption failures propagate and never incur an audio fallback call.
- [x] Empty fallback content becomes `OPENAI_TRANSCRIPTION_FAILED` rather than an empty success.
- [x] Unified `text` contains every non-empty segment once and in chronological order.
- [x] Five spec-derived service tests pass; 39 unit tests pass in total.
- [x] `npm run check` exits zero because this closes Phase 2.

**Tests**: unit
**Gate**: build
**Commit**: `feat(transcription): orchestrate hybrid transcript sources`

### T6: Build and render provider-neutral PDFs ✅

**What**: Implement the PDF document model, bounded paragraph grouping, and PDFKit buffer renderer.
**Where**: `src/infrastructure/pdf/`
**Depends on**: T5
**Reuses**: Unified transcript model
**Requirement**: YTPDF-01, YTPDF-02, YTPDF-03, YTPDF-05, YTPDF-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Metadata includes source URL, video ID, source, language, generation flag, timestamp precision, and extraction time.
- [x] Timestamped paragraphs preserve each segment exactly once and remain at or below 1,500 characters.
- [x] Brazilian Portuguese diacritics remain unchanged in the document model.
- [x] Multi-page content renders into a buffer beginning with the PDF signature.
- [x] Renderer failures become `PDF_GENERATION_FAILED`.
- [x] Six spec-derived PDF tests pass; 45 unit tests pass in total.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(pdf): render transcript documents`

### T7: Expose health, transcript, and PDF routes

**What**: Build the Fastify application, JSON Schema validation, safe error handler, dependency wiring, and three HTTP routes.
**Where**: `src/http/`
**Depends on**: T6
**Reuses**: Hybrid transcript service, PDF renderer, domain errors
**Requirement**: YTTR-01, YTTR-03, YTTR-06, YTTR-07, YTTR-08, YTTR-09, YTTR-10, YTTR-11, YTTR-12, YTPDF-01, YTPDF-04, YTOPS-01, YTOPS-02, YTOPS-03, YTOPS-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `GET /health` returns exactly HTTP 200 and `{ "status": "ok" }` without external calls.
- [ ] `POST /v1/transcripts` validates a closed body schema and returns the unified JSON contract.
- [ ] `POST /v1/transcripts/pdf` returns `application/pdf` with a video-ID attachment filename.
- [ ] Every specified `AppError` status and code is preserved by both transcript endpoints.
- [ ] Validation errors return HTTP 400 without external calls.
- [ ] Logs never serialize transcript text, media, PDF bytes, API keys, or provider error causes.
- [ ] At least fourteen network-isolated integration tests pass.

**Tests**: integration
**Gate**: full
**Commit**: `feat(api): expose transcript and pdf routes`

### T8: Package and document the runnable service

**What**: Add the production entrypoint, Docker image with media tools, environment documentation, local examples, and operational limitations.
**Where**: `.`
**Depends on**: T7
**Reuses**: Built Fastify application and approved configuration
**Requirement**: YTOPS-04, YTOPS-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `npm run build` produces a runnable `dist/server.js`.
- [ ] Docker installs `yt-dlp` and FFmpeg in the runtime stage and starts the compiled API as a non-root user.
- [ ] README documents API Platform billing separation, `OPENAI_API_KEY`, routes, curl examples, temporary-file behavior, and YouTube blocking limitations.
- [ ] `.env.example` contains placeholders only and no credentials.
- [ ] `npm run check` passes with the final expected test count and zero skipped tests.

**Tests**: none - runtime and documentation use the build gate per matrix
**Gate**: build
**Commit**: `docs(api): package and document hybrid service`

---

## Phase Execution Map

```text
Phase 1 → Phase 2 → Phase 3

Phase 1: T1 → T2
Phase 2: T3 → T4 → T5
Phase 3: T6 → T7 → T8
```

Execution is strictly sequential. Cross-phase dependencies are carried by the first task of each later phase.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | One project foundation | ✅ Granular |
| T2 | One pure parser | ✅ Granular |
| T3 | One caption adapter | ✅ Granular |
| T4 | One cohesive audio fallback adapter boundary | ✅ Granular |
| T5 | One application orchestrator | ✅ Granular |
| T6 | One PDF adapter boundary | ✅ Granular |
| T7 | One HTTP delivery boundary | ✅ Granular |
| T8 | One runtime packaging deliverable | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | Phase 1 start | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | Phase 1 → Phase 2, T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | Phase 2 → Phase 3, T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Config and domain contracts | none | none | ✅ OK |
| T2 | Domain parser | unit | unit | ✅ OK |
| T3 | External caption adapter | unit | unit | ✅ OK |
| T4 | External process/OpenAI adapters | unit | unit | ✅ OK |
| T5 | Application service | unit | unit | ✅ OK |
| T6 | PDF model and renderer | unit | unit | ✅ OK |
| T7 | Fastify routes | integration | integration | ✅ OK |
| T8 | Runtime and container files | none | none | ✅ OK |
