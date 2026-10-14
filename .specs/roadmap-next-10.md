# Next ten feature proposals

Prepared on 2026-10-06 and updated on 2026-10-09 using the repository-pinned `tlc-spec-lean`
workflow. Hosting context updated on 2026-10-13 after the owner removed the Railway deployment.

The owner requested ten next tasks, each submitted for approval. Each task is an independently
reviewable user outcome, not an implementation breakdown. The proposed priority is library
usability first, then larger imports and operations, then semantic retrieval. This ordering is
an unconfirmed recommendation based on the current repository; no usage metrics were supplied.

The owner approved the scopes and delegated plan choices for all ten proposals on 2026-10-09. All
ten tasks have detailed plans and pass the strict plan validator. This approves planning scope, not
implementation. Do not write checks, edit application code, commit, or publish on that basis.

| Order | Task | Current evidence | Proposed user outcome and boundary | Review state |
| --- | --- | --- | --- | --- |
| 1 | [Search saved library content](features/library-content-search/plan.md) | `Store.videos` searches only the title; originals, enrichment and notes already exist locally. | Find literal text in titles, originals, corrected text, summaries, key points and personal notes; preserve title-only API requests and existing filters. Semantic ranking is separate. | Plan approved by owner on 2026-10-07; implementation is not authorized. |
| 2 | [Protect unsaved reading notes during navigation](features/protect-unsaved-reading-notes/plan.md) | `ReadingTools` warns on browser unload; internal navigation clears selected detail without a dirty-note guard. | Offer save, discard or stay before leaving a reader with edits; preserve edits when save fails. Keep explicit lock within the guard and clear on an expired/unauthorized session. | Plan approved by owner on 2026-10-08; implementation is not authorized. |
| 3 | [Resolve metadata for individually added videos](features/individual-video-metadata/plan.md) | `Store.addIndividualVideo` uses `YouTube video <id>`, unknown publication date and no thumbnail until channel discovery attaches metadata. | With explicit metadata lookup configuration and the existing YouTube API key, fill a video's title, publication date and thumbnail; unavailable metadata never blocks transcript processing. Preserve unattached channel state. | Scope and detailed plan approved under blanket approval on 2026-10-09; implementation is not authorized. |
| 4 | [Organize videos with owner tags](features/library-tags/plan.md) | `VideoFilters` offers channel, status, title, favorite and read state; it has no owner-defined grouping. | Create and assign tags, combine a tag filter with existing filters, and remove a tag without removing videos. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |
| 5 | [Resume reading from a saved position](features/reading-position/plan.md) | Reading state contains favorite, read, notes and updatedAt; opening a video always selects Summary. | Save a position per video and original-transcript tab; offer resume after reopening without claiming corrected prose has original timestamps. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |
| 6 | [Import a bounded batch of video URLs](features/batch-video-import/plan.md) | `POST /api/v1/videos` admits exactly one URL with global video-ID deduplication. | Preview up to 20 pasted URLs, explicitly submit supported unique entries and report per-item outcomes. Reuse the worker; playlist crawling and parallel provider execution are excluded. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |
| 7 | [Inspect processing progress and retry timing](features/video-processing-queue/plan.md) | Worker state already stores stages, attempts and nextAttemptAt; the UI offers status filters and individual retry but no consolidated queue view. | See queued, active, delayed and failed work with next retry time and sanitized failure reason; reuse current retry rules. Cancellation and scheduling priorities are separate capabilities. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |
| 8 | [Export a selected set of readings](features/selected-reading-export/plan.md) | The authenticated Markdown export handles one video at a time. | Download up to 20 selected readings in one bounded Markdown file, with originals, editorial attribution and personal notes. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |
| 9 | [Create and validate restorable local backups](features/local-container-backup/plan.md) | Host and Docker guides require manual stopped-writer copies; the two stores have separate lifecycles. | Add a local backup/restore command with manifests, integrity validation and explicit overwrite safeguards. Cloud backup and deployment are excluded. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |
| 10 | [Search library transcripts by meaning](features/library-semantic-search/plan.md) | The transcript service exposes RAG HTTP endpoints; its ingestion accepts a source job ID and completed RAG documents survive source-job expiry. | Submit each new original to the existing authenticated RAG ingestion route as soon as it is saved, then search and open attributable passages in the reader. No generated answers/chat. | Scope approved under blanket approval on 2026-10-09; detailed plan ready; implementation is not authorized. |

## Approval protocol

The owner approved all ten scopes and delegated approval of detailed plan choices on 2026-10-09.
This does not authorize implementation. A scope change requires updating this roadmap and the affected plan.

Default verification profile: `light`, inherited from the skill because the repository does
not declare another profile. Browser behavior still needs browser proofs during implementation;
the profile does not remove acceptance criteria. Checks and independent verification belong to
a later, explicitly requested implementation phase.

## Repository baseline

Existing reading/import/Docker work is present in the working tree, with completion reports in
its feature directories. The branch is `main` at `c102d25`; the working tree contains substantial
pre-existing modifications. These proposals use that current tree as evidence and do not assume
all delivered behavior has been committed. Existing changes and historical specs are preserved.

Active decisions in [Project State](STATE.md), through AD-020, constrain future plans. AD-020
supersedes AD-007 and the Railway hosting assumptions in AD-010/AD-011: the owner removed the
Railway deployment due to costs. Use the existing local workflows as the operational baseline;
no replacement hosting provider has been selected. Historical Railway evidence does not imply
an available hosted service.

In particular, keep the library independent,
use authenticated HTTP across services, preserve immutable originals and single-writer storage,
keep source content out of telemetry, and write technical artifacts in English.

## Sources

- Owner request on 2026-10-06: plan the next ten tasks with `tlc-spec-lean`, submitting each for approval.
- [Project decisions](STATE.md) and the [pinned skill](../.agents/skills/tlc-spec-lean/SKILL.md).
- Current library application, [library guide](../services/channel-library/README.md),
  [Docker backup guide](../docs/docker.md), and [existing RAG routes](../src/http/rag-routes.ts).
