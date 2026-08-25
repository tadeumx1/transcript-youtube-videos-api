# Hybrid YouTube Transcript PDF API Context

**Gathered:** 2026-08-25
**Spec:** `.specs/features/youtube-transcript-pdf/spec.md`
**Status:** Ready for design

---

## Feature Boundary

The API processes one public YouTube URL, prefers existing captions, falls back to OpenAI transcription of temporary audio, and returns the same JSON or searchable PDF contract without retaining media.

---

## Implementation Decisions

### Transcript source

- Use `@hallelx/youtube-transcript` first.
- Fall back to OpenAI only when captions are disabled or unavailable in the requested languages.
- Do not hide unexpected caption-provider failures behind a potentially billable OpenAI request.

### OpenAI usage

- Use `gpt-transcribe` through an API Platform project key.
- Keep caption-only requests operational when `OPENAI_API_KEY` is absent.
- Return a configuration error only when a request actually needs the fallback.
- Supply Brazilian automotive context and normalized language hints.

### Media processing and lifecycle

- Use `yt-dlp` for audio retrieval and FFmpeg for mono 16 kHz MP3 chunking.
- Run subprocesses with argument arrays and never through a shell.
- Use request-isolated temporary directories and remove them after every outcome.
- Include the tools in the Docker image rather than downloading executables at request time.

### Response and PDF

- Expose transcript provenance and timestamp precision.
- Preserve caption timestamps exactly.
- Represent fallback timestamps at chunk precision.
- Stream PDFs without server-side persistence.

### Agent's Discretion

- Internal module boundaries, error class layout, PDF typography, and test fixture wording.

### Declined / Undiscussed Gray Areas → Assumptions

- Authentication and public multi-tenant abuse controls are deferred because the first version is for trusted/local use.
- Playlist and batch processing are separate features.

---

## Specific References

- The user explicitly selected the four-step hybrid flow: captions, audio extraction, `gpt-transcribe`, and a shared JSON/PDF result.
- The knowledge domain is Brazilian vehicles and cars.

---

## Deferred Ideas

- RAG chunking and embedding ingestion.
- Authentication, quotas, and rate limiting before public exposure.
- Residential proxy support for YouTube datacenter IP blocking.
