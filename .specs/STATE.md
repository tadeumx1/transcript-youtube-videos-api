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
- **Phase:** Design
- **Completed:** Hybrid scope confirmed and specified
- **In progress:** Architecture and task breakdown
- **Next step:** Implement the approved hybrid design
- **Blockers:** None
- **Uncommitted files:** `.specs/`
- **Branch:** no Git repository initialized yet
