# Individual video import verification

**Verdict**: PASS
**Profile**: light
**Diff range**: d2fb07ab523f6d776a0e3f4aa50b5e7040edf398..5ad75bcece9d40a21cd648edb1138f1edc9055e1
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

All C1–C13 have passing named proofs and located assertions at the reviewed HEAD. No implementation defect was found in the full feature diff. This verdict is limited to the approved light profile and controlled local fixtures.

## Proof runs

Run independently in `/tmp/individual-video-import-vkgydmwx/worktree`, with HEAD confirmed as `5ad75bcece9d40a21cd648edb1138f1edc9055e1`:

- **API**: `npm --prefix services/channel-library test -- test/individual-video.test.ts test/individual-migration.test.ts --reporter=verbose` — exit 0, 49 passed. Verbose output individually showed all 14 supported URL cases, all 20 invalid admission cases, both legacy schema cases, three failure/retry cases, and every named singleton proof below.
- **Build**: `npm --prefix services/channel-library run build` — exit 0; TypeScript compilation and Vite production build completed before browser execution.
- **Browser**: `npm --prefix services/channel-library run test:browser -- browser/individual-video.spec.ts` — exit 0, all four named Chromium tests individually reported as passed.

The commands batch every frozen proof by target. Test declarations and assertion bodies were located with `rg -n` in the three newly added proof files; none of these proofs relies solely on untouched tests. No author-reported run is substituted for an independent result.

## Checks

Paths below are relative to the repository root. API and Browser identify the exact successful commands above.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Supported URL families and hosts normalize to one ID | API: `accepts supported video URLs`, 14 cases | `services/channel-library/test/individual-video.test.ts:89` — `expect(response.statusCode).toBe(202)`; line 90 — `expect(response.json().video.id).toBe(id)`; the adjacent host/path matrix supplies the concrete ID `abcdefghijk`. | PASS |
| C2 | One pending unattached video, honest metadata, no channel or collection | API: `queues one unattached video` | `services/channel-library/test/individual-video.test.ts:97` — `expect(response.json()).toMatchObject({ created: true, video: { id, title: ... , channelId: null, channelTitle: 'Added individually', publishedAt: null, addedAt: date, status: 'pending' } })`; line 111 — collection count equals `{ n: 0 }`, with empty channels at line 109 and status 202 at line 96. | PASS |
| C3 | Concurrent/equivalent submissions preserve one identity and saved state | API: `deduplicates concurrent and repeated admissions` | `services/channel-library/test/individual-video.test.ts:118` — statuses equal `[200, 200, 200, 200, 200, 200, 200, 202]`; line 131 — `expect(duplicate.json()).toEqual({ created: false, video: before.video })`; line 132 compares complete detail with its pre-admission value. | PASS |
| C4 | Invalid bodies and URLs return 400/INVALID_REQUEST without persistence | API: `rejects invalid admission`, 20 cases | `services/channel-library/test/individual-video.test.ts:163` — `expect(response.statusCode).toBe(400)`; line 164 — error code equals `'INVALID_REQUEST'`; line 165 — video total equals `0`. | PASS |
| C5 | Existing guards and list/detail contracts remain enforced | API: `enforces admission guards`; `preserves extended list and detail contracts` | `services/channel-library/test/individual-video.test.ts:170` — unauthorized status equals `401`; lines 173/176/179/186 assert `503`/`413`/`429`/`503`; line 181 — Retry-After equals `60`; line 196 — returned video matches `{ id, channelId: null, publishedAt: null, addedAt: date }`; lines 202–207 assert invalid, missing and unavailable GET responses. | PASS |
| C6 | Existing processing, restart, failures and retries work for individual videos | API: `processes and resumes individual videos`; `preserves individual failure and retry behavior`, three cases | `services/channel-library/test/individual-video.test.ts:214` — status/job match `{ status: 'transcribing', jobId: ... }`; lines 218–221 assert `'ready'`, one submission, original text and summary after restart; line 241 — status equals each of `'failed'`, `'unavailable'`, `'retry_wait'`; lines 242/247/250 assert retained original, retry stage and eventual `'ready'`. | PASS |
| C7 | Discovery attaches real metadata without replacing saved state or processing | API: `attaches discovered metadata without reprocessing` | `services/channel-library/test/individual-video.test.ts:270` — `expect(after.video).toEqual({ ...before.video, title: 'Actual title', channelId: cid, channelTitle: 'Actual channel', publishedAt: '2026-10-01T00:00:00.000Z', thumbnail: null })`; lines 278–279 compare original/enrichment with their previous values; line 285 asserts one upstream submission. | PASS |
| C8 | Schema migration preserves related data and rolls back atomically | API: `migrates existing library data`, schemas 1 and 2; `rolls back a failed migration`; `creates schema three` | `services/channel-library/test/individual-migration.test.ts:84` — user version equals `3`; lines 85–90 assert valid references, enabled foreign keys, nullable membership and unchanged related rows; lines 91–102 compare video/reading/addition data and reopen; line 121 — failed migration retains version `2`, with all rows unchanged at line 123 and no temporary table at line 124. | PASS |
| C9 | Mixed ordering and reading/filter/export persistence | API: `retains reading tools and stable mixed ordering` | `services/channel-library/test/individual-video.test.ts:295` — result IDs equal `['aaaaaaaaaaa', 'zzzzzzzzzzz', id]`; line 310 — reading matches `{ favorite: true, read: true, notes: '<script>private note</script>' }` after reopen; line 319 — export contains `'&lt;script&gt;private note&lt;/script&gt;'`. | PASS |
| C10 | Visible admission, reader, honest metadata and duplicate reuse | Browser: `adds an individual video and opens its reader`; empty-state corroboration in C12 | `services/channel-library/browser/individual-video.spec.ts:25` — `expect(form && filters && form.y < filters.y).toBe(true)`; lines 29–36 assert placeholder title, `'Added individually'`, pending state and null metadata; lines 43–50 assert ready fixture content; lines 56–57 assert retained favorite and exactly 26 records after duplicate admission. | PASS |
| C11 | Loading, errors, unauthorized access and old-session isolation | Browser: `handles admission loading and errors`; `isolates admission across sessions` | `services/channel-library/browser/individual-video.spec.ts:72` — `getByRole('button', { name: 'Adding video…' })` is disabled; lines 74–75 assert API error and retained URL; lines 83–84 assert access screen and `'Access denied'`; lines 107–110 assert clean new-session form, enabled submit and zero access/error elements after late 401. | PASS |
| C12 | Empty form, channel navigation, keyboard use and mobile/desktop fit | Browser: `supports keyboard and responsive admission` | `services/channel-library/browser/individual-video.spec.ts:118` — empty-library message is visible; line 120 — channel URL control is visible; line 127 — Add video receives keyboard focus; line 128 — `document.documentElement.scrollWidth <= innerWidth` is true for 1280 and 360; lines 135–138 assert Enter opens the returned video. | PASS |
| C13 | Run guide explains admission, duplicates, configuration and upgrade | API: `documents individual admission and configuration`; guide inspected | `services/channel-library/test/individual-video.test.ts:338` — `expect(guide).toContain(text)` over the adjacent literal list including Add video, duplicate, schema 3, backup and credential names; `docs/running-all-services.md:347` describes admission, line 364 requires backup, and line 372 introduces the two runtime env files and credential table. | PASS |

## Sources and existing constraints

Read the repository AGENTS.md, pinned skill and verification procedure, feature plan/checks, active STATE decisions, the full feature diff, and relevant existing URL/authentication/worker sources. The plan supplies repository sources rather than a separate visual design. A comprehensive binding-source UI comparison is outside this light profile.

The `Swept` observability row resolves to existing behavior and was re-read against `services/channel-library/api/worker.ts:5`: `Log` accepts only `stage`, `outcome`, and `elapsedMs`. Its call sites at lines 138, 158, 253 and 273 emit those bounded fields and no video content or credentials. The new admission route adds no log payload. Existing authentication, mutation-rate and storage guards at `services/channel-library/api/app.ts:60` apply before the new route.

## Level and sampling limits

- C1–C5 and C9 execute through Fastify's request boundary with actual temporary SQLite storage. C6/C7 use controlled remote adapters; C8 opens real legacy SQLite fixtures. These levels reach the claimed API, worker and persistence boundaries.
- Browser tests use real local HTTP/UI/storage fixtures. Readable transcript/enrichment data is installed by the fixture; the browser result does not claim end-to-end success against YouTube or OpenCode. No live service, owner database or real environment file was accessed.
- Browser samples cover Chromium at 360px and 1280px. The populated form's above-filter geometry is asserted directly; the empty form's visibility and keyboard operation are exercised separately. The exact rendered addition-date copy, spacing, colors and type weights are not separately asserted by these browser proofs; the date-label implementation was inspected in the feature diff. Human owner acceptance remains a separate step.
- Guard tests sample an oversized 9000-character payload and rate-limit exhaustion, rather than every byte around the 8192-byte bound. The Fastify configuration retains the literal `bodyLimit: 8192`. Concurrent admissions are eight requests to the supported single-writer process, not multiple writer replicas.
- Migration fixtures cover schema 1, schema 2, empty initialization, reopen and an invalid reference. They do not simulate process termination or disk failure during SQLite commit.
- Coverage tables were read, not independently recomputed; no faults were injected, as specified by profile light. The checks contain no separate Test policy rows. This review does not claim mutation resistance or exhaustive set coverage.
- Existing broader suite results reported by the author were not rerun or used as substitute evidence. This independent run covers all frozen C1–C13 proof selectors: 49 API/migration/documentation cases and four browser cases.

## Gate

`python3 .agents/skills/tlc-spec-lean/scripts/validate_verification.py individual-video-import` — exit 0, 0 errors and 0 warnings.

No grounded failure was found, so no lesson entry was added. No implementation file was changed by the Verifier; the verification report is the only authored file.
