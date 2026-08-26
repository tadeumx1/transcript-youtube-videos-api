# Muse Audio Fallback Specification

## Problem Statement

The API already converts YouTube captions or OpenAI audio transcriptions into a shared transcript
and PDF contract. The paid OpenAI fallback must be replaced with Muse Spark 1.2 Contributor through
the user's OpenCode Go subscription while preserving the captions-first flow and local PDF rendering.

## Goals

- [x] Transcribe captionless public YouTube videos with Muse Spark 1.2 Contributor.
- [x] Preserve the unified JSON and searchable PDF behavior.
- [x] Remove the OpenAI SDK and `OPENAI_API_KEY` runtime dependency.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Vector database and RAG ingestion | This feature produces the source JSON and PDF only. |
| Asynchronous jobs and persistence | The existing synchronous, stateless MVP remains unchanged. |
| Private or restricted YouTube access | The existing public-video boundary remains unchanged. |
| Automatic provider failover | The user selected Muse as the only audio transcription fallback. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Contributor data policy | Use `muse-spark-1.2-contributor` after workspace training opt-in | The user explicitly enabled and accepted the Contributor data policy. | yes |
| Provider credential | Read `OPENCODE_API_KEY` only from server environment configuration | Keeps the credential out of HTTP payloads, responses, and logs. | yes |
| Muse reasoning effort | Send `reasoning.effort: "minimal"` | The live six-sample benchmark reached 0% WER and used about half the tokens of the default effort. | yes |
| Audio chunk shape | MP3 mono at 16 kHz and 48 kbps in 10-minute chunks | A shorter chunk keeps Base64 JSON payloads conservative while retaining useful batching. | no, safe default |
| Automatic retries | Send each chunk once with no automatic retry | Avoids duplicate quota use and preserves the existing failure semantics. | yes |
| Environment file | Development and production start scripts load a root `.env` when it exists | The user placed `OPENCODE_API_KEY` in the repository root `.env`; deployed environment variables still remain supported. | yes |
| Remaining implicit-requirement dimensions | Existing stateless lifecycle, concurrency isolation, logging, and HTTP auth scope remain unchanged | This feature only replaces the audio transcription provider. | no, bounded default |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Transcribe captionless videos with Muse ⭐ MVP

**User Story**: As the API owner, I want captionless YouTube audio transcribed through OpenCode Go
so that I can use my existing subscription instead of paying for OpenAI API transcription.

**Why P1**: Captionless videos otherwise cannot produce complete RAG source material.

**Acceptance Criteria**:

1. **MUSE-01** IF usable YouTube captions are unavailable and `OPENCODE_API_KEY` is configured THEN the system SHALL send each MP3 chunk sequentially to `https://opencode.ai/zen/go/v1/responses` using model `muse-spark-1.2-contributor` and `reasoning.effort: "minimal"`.
2. **MUSE-02** WHEN the system submits a Muse request THEN the system SHALL send raw Base64 in `input_audio.data`, `mp3` in `input_audio.format`, an automotive Brazilian Portuguese transcription instruction, and normalized language hints.
3. **MUSE-03** WHEN Muse returns output text for every chunk THEN the system SHALL return HTTP 200 with `source: "muse_transcription"`, `isGenerated: true`, `timestampPrecision: "chunk"`, and ordered chunk offsets in 600-second increments.
4. **MUSE-04** IF fallback is required and `OPENCODE_API_KEY` is absent THEN the system SHALL return HTTP 503 with error code `AUDIO_FALLBACK_NOT_CONFIGURED` before creating temporary media.
5. **MUSE-05** IF Muse returns a non-success response, malformed response, network failure, timeout, or empty transcription THEN the system SHALL return HTTP 502 with error code `MUSE_TRANSCRIPTION_FAILED`.
6. **MUSE-06** IF YouTube captions succeed or caption retrieval fails unexpectedly THEN the system SHALL make zero Muse transcription requests.
7. **MUSE-07** WHILE audio fallback processing runs, the system SHALL remove request-specific temporary media after success or failure and SHALL not log the API key, audio, transcript text, or provider response body.
8. **MUSE-08** WHEN a Muse transcript is returned as JSON or rendered as PDF THEN the system SHALL preserve every non-empty chunk once and in chronological order through the existing provider-neutral contract.
9. **MUSE-09** WHEN a captionless video's audio is prepared THEN the system SHALL create ordered MP3 chunks of at most 600 seconds and reject any chunk larger than 8 MiB before a Muse request.
10. **MUSE-10** IF a Muse request fails THEN the system SHALL not retry that chunk automatically.

**Independent Test**: Use fake file, fetch, caption, and media adapters to verify exact request
payloads, sequential ordering, offsets, typed failures, cleanup, and provider-neutral JSON/PDF output
without network or media tool access.

---

## Edge Cases

- IF Muse returns only whitespace THEN the system SHALL return `MUSE_TRANSCRIPTION_FAILED`.
- IF the Responses API has reasoning items but no `output_text` item THEN the system SHALL return `MUSE_TRANSCRIPTION_FAILED`.
- WHEN requested languages contain locales or duplicates THEN the system SHALL send unique primary language codes in input order.
- IF a chunk exceeds 8 MiB THEN the system SHALL stop before calling Muse and return `AUDIO_CHUNK_TOO_LARGE`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| MUSE-01 | P1: Transcribe captionless videos with Muse | Execute 1 | Verified |
| MUSE-02 | P1: Transcribe captionless videos with Muse | Execute 1 | Verified |
| MUSE-03 | P1: Transcribe captionless videos with Muse | Execute 1 | Verified |
| MUSE-04 | P1: Transcribe captionless videos with Muse | Execute 1 | Verified |
| MUSE-05 | P1: Transcribe captionless videos with Muse | Execute 1 | Verified |
| MUSE-06 | P1: Transcribe captionless videos with Muse | Execute 2 | Verified |
| MUSE-07 | P1: Transcribe captionless videos with Muse | Execute 2 | Verified |
| MUSE-08 | P1: Transcribe captionless videos with Muse | Execute 2 | Verified |
| MUSE-09 | P1: Transcribe captionless videos with Muse | Execute 2 | Verified |
| MUSE-10 | P1: Transcribe captionless videos with Muse | Execute 1 | Verified |

**Coverage:** 10 total, 10 mapped to execution steps, 0 unmapped.

---

## Success Criteria

- [x] All Muse request, failure, orchestration, HTTP, media, and PDF tests pass without network.
- [x] `npm run check` passes with no OpenAI dependency or `OPENAI_API_KEY` reference in runtime code.
- [x] A live smoke test with the configured OpenCode Go key transcribes a public Portuguese sample.
