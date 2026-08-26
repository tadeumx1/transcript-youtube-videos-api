# Muse Audio Fallback Context

**Gathered:** 2026-08-25
**Spec:** `.specs/features/muse-audio-fallback/spec.md`
**Status:** Ready for implementation

---

## Feature Boundary

Replace only the OpenAI audio transcription fallback with Muse through OpenCode Go. Keep YouTube
captions first, return the existing JSON/PDF shape, and render PDFs locally.

---

## Implementation Decisions

### Provider and authentication

- Use `muse-spark-1.2-contributor` through the OpenCode Go Responses endpoint.
- Read `OPENCODE_API_KEY` from server environment configuration.
- The user accepted and enabled the Contributor training opt-in.

### Transcription behavior

- Use native audio input instead of Whisper or another local speech-to-text model.
- Send raw Base64 MP3 audio with `reasoning.effort: "minimal"`.
- Preserve the automotive Brazilian Portuguese prompt and requested language hints.
- Process chunks sequentially and do not retry automatically.

### Output and data lifecycle

- Identify fallback output as `muse_transcription`.
- Generate the searchable PDF locally without another model call.
- Preserve request-scoped temporary-file cleanup and stateless processing.

### Agent's Discretion

- Exact TypeScript interfaces used to isolate fetch and filesystem access in tests.
- Internal parsing helpers for the Responses API payload.

### Declined / Undiscussed Gray Areas → Assumptions

- No new HTTP authentication, rate limit, queue, or persistence layer is added.
- Audio uses conservative 10-minute MP3 chunks with an 8 MiB preflight bound.

---

## Specific References

The live public-sample benchmark produced 0% WER with minimal reasoning on six isolated clips and
on a combined 22-second clip.

---

## Deferred Ideas

- Persist JSON/PDF artifacts and ingest them into a vector database.
- Add asynchronous jobs for videos longer than synchronous hosting timeouts.
