# Project State

## Decisions

### AD-001: Use replaceable external adapters

- **Status:** active
- **Decision:** Caption retrieval, media extraction, and OpenAI transcription are accessed through application-owned interfaces.
- **Reason:** YouTube's unofficial transcript surface and media tools can change independently of the API contract.

### AD-002: Keep request processing stateless

- **Status:** active
- **Decision:** Transcript results and PDFs are returned synchronously; temporary audio exists only in request-specific directories and is always removed.
- **Reason:** The MVP needs no database and must not retain downloaded media.

### AD-003: Separate free and billable paths

- **Status:** active
- **Decision:** OpenAI is called only after a known captions-unavailable result, never after an unexpected caption-provider failure.
- **Reason:** This prevents accidental charges and makes failures observable.

## Handoff

- **Feature:** youtube-transcript-pdf
- **Phase:** Validate complete
- **Completed:** Hybrid captions/OpenAI transcript API, PDF output, runtime packaging, 68-test gate, and independent 32/32 PASS verification
- **In progress:** None
- **Next step:** Configure API Platform billing and `OPENAI_API_KEY`; optionally build and smoke-test the image on a host with Docker
- **Blockers:** None for source delivery; Docker was unavailable for an image-build verification
- **Uncommitted files:** Validation and final traceability bookkeeping pending commit
- **Branch:** `main`
