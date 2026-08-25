# Hybrid YouTube Transcript PDF API Specification

## Problem Statement

Brazilian automotive knowledge from YouTube videos needs to become a reliable source for a RAG pipeline. The API must first reuse YouTube captions when available, fall back to OpenAI transcription when captions are absent, and expose the same structured transcript and searchable PDF regardless of the source.

## Goals

- [ ] Return a complete, ordered transcript for a supported YouTube URL using captions whenever possible.
- [ ] Extract and transcribe audio with OpenAI when captions are unavailable.
- [ ] Return a searchable PDF containing the same transcript and provenance metadata.
- [ ] Reject unsafe input, clean temporary media, and expose predictable API errors.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| RAG chunking, embeddings, and vector database ingestion | This API produces the source document; indexing belongs to the consuming agent pipeline. |
| Persistent storage of transcripts, audio, or PDFs | The API returns results synchronously and removes temporary media after each request. |
| Authentication, quotas, and per-client rate limiting | The first version is intended for trusted/local use. |
| Batch or playlist processing | The MVP processes one video per request. |
| Browser automation for age-restricted, private, or authenticated videos | The MVP handles public videos accessible without a YouTube login. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Videos without usable captions | Extract audio and transcribe it with OpenAI `gpt-transcribe` | The user explicitly selected the hybrid architecture. | yes |
| OpenAI billing | Require an API Platform key in `OPENAI_API_KEY`; a ChatGPT subscription is not used | ChatGPT subscriptions and API Platform project billing are separate. | yes |
| Caption language selection | Accept an ordered `languages` array and default to `pt-BR`, `pt`, then `en` | Favors Brazilian Portuguese while retaining a practical fallback. | yes |
| OpenAI language hints | Normalize requested languages to primary codes such as `pt` and `en` | `gpt-transcribe` accepts language hints and the fallback must not send unsupported locale shapes. | yes |
| API shape | Separate JSON and PDF endpoints under `/v1` | Keeps response contracts explicit. | yes |
| PDF lifecycle | Stream the generated PDF and do not save it | The caller controls persistence in the RAG system. | yes |
| Audio lifecycle | Create one isolated temporary directory per request and remove it in a `finally` path | Prevents media retention after success or failure. | yes |
| Audio tooling | Invoke `yt-dlp` and FFmpeg as argument arrays without a shell | Provides robust media extraction while avoiding command injection. | yes |
| OpenAI upload size | Encode mono 16 kHz MP3 chunks of 20 minutes and reject any chunk above 24 MB | Keeps each upload below the documented 25 MB API limit with safety margin. | yes |
| Transcript timestamps | Preserve caption timestamps; use 20-minute chunk offsets for OpenAI fallback and identify their precision as `chunk` | `gpt-transcribe` optimizes text quality but does not provide word timestamps. | yes |
| Request retries | Do not retry automatically | Prevents duplicate OpenAI charges and avoids amplifying YouTube rate limiting. | yes |
| Transcript size | Do not truncate transcript content | The core requirement is the complete transcript. | yes |
| Concurrent requests | Use independent temporary directories and no shared mutable state | Requests must not read or delete each other's media. | yes |
| Observability | Log request ID, video ID, selected source, duration, status, and error code, but never transcript text, audio, API keys, or PDF bytes | Provides diagnostics without leaking content or credentials. | yes |
| Remaining implicit-requirement dimensions | State transitions and persistent data expiry are not applicable | The API is stateless and retains no result data. | yes |

**Open questions:** none - all unresolved choices are captured above.

---

## User Stories

### P1: Retrieve a complete hybrid transcript as JSON ⭐ MVP

**User Story**: As a RAG pipeline developer, I want one transcript contract regardless of its source so that I can index automotive content without provider-specific handling.

**Why P1**: This is the source-data capability on which PDF generation depends.

**Acceptance Criteria**:

1. **YTTR-01** WHEN a client submits `POST /v1/transcripts` with a supported YouTube URL whose requested captions are available THEN the system SHALL respond with HTTP 200 containing `videoId`, canonical `sourceUrl`, `source: "youtube_captions"`, `language`, `isGenerated`, `timestampPrecision: "caption"`, `text`, and every ordered caption segment.
2. **YTTR-02** IF captions are disabled or none of the requested caption languages is available THEN the system SHALL extract audio and request an OpenAI `gpt-transcribe` transcription.
3. **YTTR-03** WHEN the OpenAI fallback succeeds THEN the system SHALL respond with HTTP 200 using the same transcript fields, `source: "openai_transcription"`, `isGenerated: true`, and `timestampPrecision: "chunk"`.
4. **YTTR-04** The system SHALL build `text` from every returned segment in chronological order without truncation.
5. **YTTR-05** WHEN the client omits `languages` THEN the system SHALL try caption languages in the order `pt-BR`, `pt`, `en`.
6. **YTTR-06** IF the request URL is malformed, uses a non-YouTube host, or contains no valid 11-character video ID THEN the system SHALL respond with HTTP 400 and error code `INVALID_YOUTUBE_URL` without calling either provider.
7. **YTTR-07** IF the video is unavailable, private, or age-restricted THEN the system SHALL respond with HTTP 404 and error code `VIDEO_NOT_AVAILABLE`.
8. **YTTR-08** IF fallback is required and `OPENAI_API_KEY` is absent THEN the system SHALL respond with HTTP 503 and error code `AUDIO_FALLBACK_NOT_CONFIGURED`.
9. **YTTR-09** IF `yt-dlp` or FFmpeg cannot run THEN the system SHALL respond with HTTP 503 and error code `AUDIO_TOOL_UNAVAILABLE`.
10. **YTTR-10** IF audio extraction fails after its tools start THEN the system SHALL respond with HTTP 502 and error code `AUDIO_EXTRACTION_FAILED`.
11. **YTTR-11** IF OpenAI rejects or fails a transcription request THEN the system SHALL respond with HTTP 502 and error code `OPENAI_TRANSCRIPTION_FAILED`.
12. **YTTR-12** IF caption retrieval fails for an unexpected upstream reason THEN the system SHALL respond with HTTP 502 and error code `YOUTUBE_UPSTREAM_ERROR` without incurring an OpenAI transcription request.

**Independent Test**: Inject deterministic caption, media, and transcription adapters; verify caption success, audio fallback success, stable output fields, and each typed failure without external network or subprocess access.

---

### P1: Extract and transcribe audio safely ⭐ MVP

**User Story**: As an operator, I want bounded and temporary audio processing so that captionless videos can be transcribed without retaining media or exhausting uploads.

**Why P1**: The OpenAI fallback depends on safe external-process and temporary-file handling.

**Acceptance Criteria**:

1. **YTAUD-01** WHEN audio fallback starts THEN the system SHALL invoke `yt-dlp` with a canonical YouTube URL, playlist processing disabled, and an output template inside a newly created request-specific temporary directory.
2. **YTAUD-02** WHEN audio download succeeds THEN the system SHALL invoke FFmpeg without a shell to create mono 16 kHz MP3 chunks of at most 20 minutes each.
3. **YTAUD-03** IF any generated audio chunk exceeds 24 MB THEN the system SHALL stop before calling OpenAI and return HTTP 502 with error code `AUDIO_CHUNK_TOO_LARGE`.
4. **YTAUD-04** WHEN multiple audio chunks exist THEN the system SHALL transcribe them sequentially and concatenate every result in chunk order.
5. **YTAUD-05** WHEN a fallback request ends successfully or with an error THEN the system SHALL remove only that request's temporary directory and its contents.
6. **YTAUD-06** The system SHALL pass automotive Brazilian Portuguese context and normalized language hints to `gpt-transcribe`.

**Independent Test**: Use temporary fixture files and fake subprocess/OpenAI adapters; verify safe argument arrays, chunk ordering, size rejection, and cleanup on both success and failure.

---

### P1: Download a searchable transcript PDF ⭐ MVP

**User Story**: As a RAG pipeline developer, I want a PDF version of either transcript source so that I can upload it to a document-based knowledge source.

**Why P1**: PDF is the required handoff format for the user's agent workflow.

**Acceptance Criteria**:

1. **YTPDF-01** WHEN a client submits `POST /v1/transcripts/pdf` for a successful transcript THEN the system SHALL respond with HTTP 200, `Content-Type: application/pdf`, and an attachment filename containing the video ID.
2. **YTPDF-02** The generated PDF SHALL contain the canonical source URL, video ID, transcript source, language, generation flag, timestamp precision, extraction timestamp, and complete transcript text in chronological order.
3. **YTPDF-03** The generated PDF SHALL group segments into timestamped paragraphs no longer than 1,500 characters while preserving every segment's text.
4. **YTPDF-04** IF transcript retrieval fails for the PDF endpoint THEN the system SHALL return the same status and typed error code defined for the JSON endpoint.

**Independent Test**: Generate a PDF from deterministic caption and OpenAI transcripts, verify its signature and headers, and verify the document model preserves every source segment exactly once and in order.

---

### P1: Operate and verify the service ⭐ MVP

**User Story**: As an operator, I want health checks, structured logs, configuration documentation, and automated checks so that I can run the API reliably.

**Why P1**: The service coordinates three external systems and must fail predictably.

**Acceptance Criteria**:

1. **YTOPS-01** WHEN a client calls `GET /health` THEN the system SHALL respond with HTTP 200 and `{ "status": "ok" }` without calling an external dependency.
2. **YTOPS-02** The system SHALL validate request bodies with Fastify JSON Schema and reject unknown properties.
3. **YTOPS-03** The system SHALL emit structured request logs without transcript text, media content, PDF bytes, or credentials.
4. **YTOPS-04** WHEN the project runs its test command THEN the system SHALL execute unit and route integration tests without external network, OpenAI, `yt-dlp`, or FFmpeg access.
5. **YTOPS-05** WHEN the documented Docker image is built THEN the system SHALL include Node.js, `yt-dlp`, FFmpeg, and the compiled API.

**Independent Test**: Run build, lint, type checking, and network-isolated tests; inspect the Docker definition for required runtime tools.

---

## Edge Cases

- **YTTR-13** WHEN a supported `youtube.com/watch`, `youtu.be`, `youtube.com/shorts`, `youtube.com/embed`, or `youtube.com/live` URL contains a valid video ID THEN the system SHALL extract the same 11-character ID.
- **YTTR-14** IF a provider returns empty or whitespace-only segments THEN the system SHALL treat that provider result as unavailable rather than returning an empty success.
- **YTAUD-07** WHEN two fallback requests run concurrently THEN the system SHALL use different temporary directory paths.
- **YTPDF-05** WHEN transcript text spans multiple pages THEN the system SHALL create additional PDF pages without dropping content.
- **YTPDF-06** WHEN transcript text contains Brazilian Portuguese diacritics THEN the system SHALL preserve those characters in the PDF document model.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| YTTR-01 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-02 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-03 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-04 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-05 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-06 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-07 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-08 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-09 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-10 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-11 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-12 | P1: Hybrid JSON | Execute | Implementing |
| YTTR-13 | Edge case | Execute | Implementing |
| YTTR-14 | Edge case | Execute | Implementing |
| YTAUD-01 | P1: Safe audio | Execute | Implementing |
| YTAUD-02 | P1: Safe audio | Execute | Implementing |
| YTAUD-03 | P1: Safe audio | Execute | Implementing |
| YTAUD-04 | P1: Safe audio | Execute | Implementing |
| YTAUD-05 | P1: Safe audio | Execute | Implementing |
| YTAUD-06 | P1: Safe audio | Execute | Implementing |
| YTAUD-07 | Edge case | Execute | Implementing |
| YTPDF-01 | P1: PDF | Execute | Implementing |
| YTPDF-02 | P1: PDF | Execute | Implementing |
| YTPDF-03 | P1: PDF | Execute | Implementing |
| YTPDF-04 | P1: PDF | Execute | Implementing |
| YTPDF-05 | Edge case | Execute | Implementing |
| YTPDF-06 | Edge case | Execute | Implementing |
| YTOPS-01 | P1: Operations | Execute | Implementing |
| YTOPS-02 | P1: Operations | Execute | Implementing |
| YTOPS-03 | P1: Operations | Execute | Implementing |
| YTOPS-04 | P1: Operations | Execute | Implementing |
| YTOPS-05 | P1: Operations | Design | Pending |

**Coverage:** 32 total, 0 mapped to tasks, 32 pending design.

---

## Success Criteria

- [ ] A captioned public video returns all requested-language caption segments without calling OpenAI.
- [ ] A captionless public video returns a complete `gpt-transcribe` transcript when API billing is configured.
- [ ] JSON and PDF expose the same provenance and transcript content contract for both sources.
- [ ] Temporary media is removed after every fallback outcome.
- [ ] All validation and dependency failures return stable HTTP status codes and machine-readable error codes.
- [ ] Build, lint, type-check, and network-isolated automated tests pass.
