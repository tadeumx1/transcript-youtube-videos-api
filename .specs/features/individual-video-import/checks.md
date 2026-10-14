# Individual video import checks

Profile: light
Plan: `.specs/features/individual-video-import/plan.md`
Approved: owner authorized implementation on 2026-10-04.
Feature base: `d2fb07ab523f6d776a0e3f4aa50b5e7040edf398` (isolated snapshot of the existing workspace).

## Checks

**C1** - The five supported HTTPS URL families normalize to one video ID; watch paths support the three full hosts and short links both short hosts (AC 1).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'accepts supported video URLs'`

**C2** - A new URL returns 202 with `created: true`, persists one pending unattached video with unknown publication date and a real addition date, and creates zero channels/collections (AC 2, 9).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'queues one unattached video'`

**C3** - Equivalent and concurrent submissions return one new video and reuse the existing identity/content/reading/progress with 200 and `created: false` (AC 3).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'deduplicates concurrent and repeated admissions'`

**C4** - Invalid bodies and URLs return 400/INVALID_REQUEST without writing records (AC 4).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'rejects invalid admission'`

**C5** - Admission enforces authentication, missing configuration, storage availability, 8192-byte body bound and the shared 30-mutations/minute limit with Retry-After; list/detail preserve their documented statuses (AC 5, Surface).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'enforces admission guards|preserves extended list and detail contracts'`

**C6** - Individual processing preserves the existing pending/transcribing/enriching/ready/retry_wait/failed/unavailable lifecycle, resumes saved job IDs after restart and retains original text when enrichment fails (AC 6).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'processes and resumes individual videos|preserves individual failure and retry behavior'`

**C7** - Actual channel discovery attaches metadata to an imported video without a second video or any change to saved reading/content/processing progress (AC 10).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'attaches discovered metadata without reprocessing'`

**C8** - Schema-1/2 migration preserves all seven related entity tables, adds nullable video-channel membership and addition dates, commits at schema 3 once, and rolls back on invalid references (AC 11, door 1).
Proof: `npm --prefix services/channel-library test -- test/individual-migration.test.ts -t 'migrates existing library data|rolls back a failed migration|creates schema three'`

**C9** - Manual and channel videos share deterministic date/ID ordering; manual reading edits, filters and escaped export survive restart (AC 12).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'retains reading tools and stable mixed ordering'`

**C10** - The real browser shows the URL input and Add video above filters in empty/populated libraries, admits one video, opens its status, displays honest metadata and fixture reading content, and reuses duplicates (AC 7–9).
Proof: `npm --prefix services/channel-library run test:browser -- browser/individual-video.spec.ts -g 'adds an individual video and opens its reader'`

**C11** - Browser submission shows Adding video…, disables resubmission, retains input on rejection, returns to access on 401, and ignores results from an old session (AC 8).
Proof: `npm --prefix services/channel-library run test:browser -- browser/individual-video.spec.ts -g 'handles admission loading and errors|isolates admission across sessions'`

**C12** - The new form is keyboard-operable and fits 360px and 1280px viewports without horizontal overflow; channel registration remains reachable (AC 7, 13).
Proof: `npm --prefix services/channel-library run test:browser -- browser/individual-video.spec.ts -g 'supports keyboard and responsive admission'`

**C13** - The guide explains Add video, duplicate behavior, two env files/required and optional credentials, and schema-3 backup/compatibility (AC 13).
Proof: `npm --prefix services/channel-library test -- test/individual-video.test.ts -t 'documents individual admission and configuration'`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| URL families (5) | watch C1 · short C1 · shorts C1 · live C1 · embed C1 | - |
| POST /api/v1/videos statuses (7) | 202 C2 · 200 C3 · 400 C4 · 401 C5 · 413 C5 · 429 C5 · 503 C5 | - |
| GET /api/v1/videos statuses (4) | 200 C5 · 400 C5 · 401 C5 · 503 C5 | - |
| GET /api/v1/videos/:videoId statuses (5) | 200 C5 · 400 C5 · 401 C5 · 404 C5 · 503 C5 | - |
| stored entities (7) | channels C8 · videos C8 · sources C8 · enrichments C8 · collections C8 · attempts C8 · chunks C8 | - |
| schema inputs (3) | empty C8 · version 1 C8 · version 2 C8 | - |
| processing states (7) | pending C2 · transcribing C6 · enriching C6 · retry_wait C6 · ready C6 · failed C6 · unavailable C6 | - |
| browser form states (6) | empty C10 · populated C10 · pending C11 · invalid C11 · unauthorized C11 · session changed C11 | - |
| reading capabilities (5) | favorites C9 · read C9 · notes C9 · filters C9 · export C9 | - |
| one-way doors (2) | schema C8 · admission/Video contract C2 C5 | - |

## Swept

- validation: C1, C4, C5 - accepted URL families, strict body and length bounds.
- failure modes: C6, C8, C11 - provider errors, atomic migration rollback and browser rejection.
- idempotency: C3, C7 - video primary key plus transaction, including discovery after direct import.
- authorization: C5, C11 - existing API hooks and session guard.
- concurrency: C3, C11 - concurrent admissions and late old-session responses.
- data lifecycle: C8, C9 - retained records/reading; no new TTL or source deletion.
- dependency failure: C6 - reuse provider retry policy, no external call during admission.
- state transitions: C2, C6 - existing worker stages and retry.
- observability: existing - bounded worker log fields; C10/C11 expose status and errors without keys.

## Handoff

- One builder: existing library source/tests total 200,033 bytes / 4 = about 50k tokens; allow
  another 40k for implementation, browser proof and review, about 90k under the 150k default.
- Work in an isolated snapshot/worktree to preserve pre-existing uncommitted edits and the running
  local session. Feature commits are relative to that snapshot on `codex/individual-video-import`.
  After proofs and independent verification, apply only the feature diff to the main workspace;
  stop its managed session and back up its library before the approved migration, then restart.

## Build evidence

- C1–C13 implemented and their proofs passed. The library check completed with lint, typecheck,
  139 API/unit tests, production build and 27 Chromium tests; the final browser assertion
  extension passed all four individual-admission tests again.
- Baseline: the 49 new API/migration/documentation cases failed before implementation.
- Boundary: feature implementation complete in the isolated worktree; independent verification
  and application to the running workspace remain. No live YouTube/provider success is claimed.
- Owner decisions: approved individual URL admission and documented schema migration; no additional
  metadata provider or automatic channel subscription. Abandoned approaches: none.
