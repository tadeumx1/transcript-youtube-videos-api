# Channel Transcript Library verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: 8310d8cf7884e77cf79ead213d4706300d6c03d6..0eca12321a2a9fc8f853ce5f38cdf24c6a52fa6d
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier), `/root/verify_channel_library`

38 checks have sufficient located evidence; 18 have specific implementation or proof gaps. All named proofs ran and passed, but passing their present assertions does not settle all approved claims. Findings below distinguish missing evidence from observed defects.

## Proof execution

Verified at `0eca12321a2a9fc8f853ce5f38cdf24c6a52fa6d`, with initially clean Git status. The Verifier ran each target once, in parallel:

- **Backend**: `npm --prefix services/channel-library test -- --reporter=verbose` — exit 0, 54 tests in 2 files; all C1–C33, C37, C47–C56 named tests appeared individually, including additional C1, C10, C15, C16, C22, C23, C25, C30, C37 and C56 tests.
- **Browser**: `npm --prefix services/channel-library run test:browser` — exit 0, 12 Chromium tests, each C34–C36 and C38–C46 named test appeared individually.
- **Root**: `npm run check` — exit 0; lint, TypeScript checks, 740 tests in 59 files, production build.
- **Additional read-only probe**: compiled HttpRemote with fixture fetch returning HTTP 200 JSON `null` and `[]` — both rejected with `INVALID_PROVIDER_RESPONSE`, contrary to C30's `INVALID_LLM_RESPONSE`. No credentials or live providers were used.

Every proof file is new in the reviewed feature diff. `Backend` and `Browser` in the table mean the corresponding full target above, exit 0; a FAIL denotes inadequate claim evidence or an observed implementation defect, not a red test result. C55 also uses Root.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Canonical forms register with 201 | Backend | `services/channel-library/test/library.test.ts:117`; `services/channel-library/test/remote.test.ts:35` — `expect(res.statusCode).toBe(201)`; canonical ID and provider query asserted | PASS |
| C2 | Invalid URLs rejected before outbound work | Backend | `services/channel-library/test/library.test.ts:134` — `expect(res.json().error.code).toBe('INVALID_CHANNEL_URL')`; remote not called | PASS |
| C3 | Missing channel gives 404 CHANNEL_NOT_FOUND | Backend | `services/channel-library/test/library.test.ts:142` — `expect(...statusCode).toBe(404)`; exact error code never asserted | FAIL |
| C4 | Concurrent duplicate gives one record and CHANNEL_EXISTS | Backend | `services/channel-library/test/library.test.ts:153` — `expect(responses.map(...).sort()).toEqual([201, 409])`; exact conflict code absent | FAIL |
| C5 | Initial ten most recent, or every available video below ten | Backend | `services/channel-library/test/library.test.ts:168` — `expect(f.store.videos({}).total).toBe(10)`; identities/recency and fewer-than-ten case unproven by named proof | FAIL |
| C6 | Pause prevents automatic collections | Backend | `services/channel-library/test/library.test.ts:177` — `expect(f.store.activeRuns()).toHaveLength(0)` after due slot | PASS |
| C7 | Pause/resume preserves source and video | Backend | `services/channel-library/test/library.test.ts:186` — `expect(f.store.original(videoId)).toEqual(before)`; video remains | PASS |
| C8 | 06:00 Sao Paulo due slot, one collection | Backend | `services/channel-library/test/library.test.ts:194` — `expect(...).toHaveLength(0)` before due, `toHaveLength(1)` after repeated scheduling, slot 2026-10-02 | PASS |
| C9 | Missed days create one catch-up | Backend | `services/channel-library/test/library.test.ts:204` — five days advanced; `expect(f.store.activeRuns()).toHaveLength(1)` | PASS |
| C10 | Discovery continues beyond first page | Backend | `services/channel-library/test/library.test.ts:237`; `services/channel-library/test/remote.test.ts:68` — `expect(f.store.video('thirdvideo0')).not.toBeNull()`; page2 cursor sent | PASS |
| C11 | Partial failure saves page without checkpoint advancement | Backend | `services/channel-library/test/library.test.ts:260` — saved second video and `expect(...checkpoint).toBe(checkpoint)` | PASS |
| C12 | Rediscovery keeps one ready video | Backend | `services/channel-library/test/library.test.ts:270` — total 1; ready state; enrichment called once | PASS |
| C13 | Overlap joins existing collection | Backend | `services/channel-library/test/library.test.ts:278` — 202, same collectionId, one active run | PASS |
| C14 | Channel failure does not stop another channel | Backend | `services/channel-library/test/library.test.ts:293` — UPSTREAM_UNAVAILABLE on failed channel; video belongs to second channel | PASS |
| C15 | Restart resumes collection and processing stages | Backend | `services/channel-library/test/library.test.ts:301`; `services/channel-library/test/library.test.ts:826` — submit once and source preserved across reopen; no restart of partially collected pages | FAIL |
| C16 | Only one active video pipeline | Backend | `services/channel-library/test/library.test.ts:314`; `services/channel-library/test/library.test.ts:848` — `expect(f.remote.submit).toHaveBeenCalledTimes(1)`; second video remains pending while first blocked | PASS |
| C17 | 100-page bound preserves continuation | Backend | `services/channel-library/test/library.test.ts:324` — 101 list calls including seed, cursor more, status not completed | PASS |
| C18 | Authenticated POST, polling, transcript HTTP retrieval | Backend | `services/channel-library/test/library.test.ts:336` — paths and Bearer token asserted; HTTP method and submission body are not asserted | FAIL |
| C19 | Full original saved before enrichment | Backend | `services/channel-library/test/library.test.ts:350` — enrichment callback asserts `expect(f.store.original(videoId)).toEqual(original)` | PASS |
| C20 | Saved original/editorial survive source expiry | Backend | `services/channel-library/test/library.test.ts:364` — 200 and saved original plus summary while upstream transcript rejects JOB_EXPIRED | PASS |
| C21 | Unavailable source avoids LLM | Backend | `services/channel-library/test/library.test.ts:373` — status unavailable; `expect(f.remote.enrich).not.toHaveBeenCalled()` | PASS |
| C22 | All provider stages have bounded durable retry times | Backend | `services/channel-library/test/library.test.ts:382`; `services/channel-library/test/remote.test.ts:141` — submit-only 60/300-second delays, three calls and one-hour cap; discovery/enrichment stages and persisted restart times unproven | FAIL |
| C23 | Permanent provider errors terminate | Backend | `services/channel-library/test/library.test.ts:402`; `services/channel-library/test/remote.test.ts:150` — failed with PROVIDER_AUTHENTICATION_FAILED; 401/403 nonretryable | PASS |
| C24 | Six-hour poll timeout retains job ID | Backend | `services/channel-library/test/library.test.ts:412` — TRANSCRIPT_JOB_TIMEOUT and upstream-job retained | PASS |
| C25 | Only validated complete editorial result publishes | Backend | `services/channel-library/test/library.test.ts:419`; `services/channel-library/test/library.test.ts:472`; `services/channel-library/test/remote.test.ts:100` — ready and full result; invalid data withheld; both text API styles exercised | PASS |
| C26 | Correction instructions preserve meaning and language | Backend | `services/channel-library/test/library.test.ts:423` — regex assertions cover punctuation, names, quantities, source language, meaning, spelling, paragraphs, evident errors | PASS |
| C27 | Grounded Brazilian Portuguese summary instruction | Backend | `services/channel-library/test/library.test.ts:434` — Brazilian Portuguese, only supplied, key points asserted | PASS |
| C28 | Bounded ordered chunks and reduction without loss | Backend | `services/channel-library/test/library.test.ts:448` — joined chunks equal source; lengths [12000, 5]; summary reduction input/result never asserted | FAIL |
| C29 | Oversized source kept without LLM | Backend | `services/channel-library/test/library.test.ts:457` — length 1000001; TRANSCRIPT_TOO_LARGE; enrich never called | PASS |
| C30 | All invalid LLM responses produce INVALID_LLM_RESPONSE | Backend | `services/channel-library/test/library.test.ts:472`; `services/channel-library/test/remote.test.ts:124` — tested malformed content withheld; top-level null/array instead produces INVALID_PROVIDER_RESPONSE in independent probe | FAIL |
| C31 | Manual enrichment retry reuses source | Backend | `services/channel-library/test/library.test.ts:481` — 202; submit/getTranscript once; ready after retry | PASS |
| C32 | Published model, prompt version, completion time | Backend | `services/channel-library/test/library.test.ts:491` — model glm-5.3-flash, promptVersion 1, clock-derived completedAt | PASS |
| C33 | Discovery/LLM requests abort at 30/120 seconds | Backend | `services/channel-library/test/library.test.ts:508` — TIMEOUT at both deadlines; every captured signal aborted | PASS |
| C34 | Untrusted markup displayed as text | Browser | `services/channel-library/browser/reader.spec.ts:81` — literal script content visible and `Object.hasOwn(window, 'hacked')` false | PASS |
| C35 | Channel identity state times and pause/resume/sync actions | Browser | `services/channel-library/browser/reader.spec.ts:89` — identity, time labels, Pause/Collect now visible; collection-state value and Resume not asserted | FAIL |
| C36 | Cards include thumbnail and deterministic ordering | Browser | `services/channel-library/browser/reader.spec.ts:97` — single card title/channel/status/date asserted; fixture thumbnail null; browser ordering absent | FAIL |
| C37 | Channel/status/search filters and pagination bounds | Backend | `services/channel-library/test/library.test.ts:521`; `services/channel-library/test/library.test.ts:865` — search/default/page upper bound and order asserted; channel filter absent, status only matches sole fixture | FAIL |
| C38 | All four saved-content tabs | Browser | `services/channel-library/browser/reader.spec.ts:107` — summary, key point, corrected statement, original segment visible in corresponding tabs | PASS |
| C39 | Timestamp links source, never corrected prose | Browser | `services/channel-library/browser/reader.spec.ts:119` — href has video ID and t=12s; corrected tab has no timestamp link | PASS |
| C40 | Empty views have applicable next action | Browser | `services/channel-library/browser/reader.spec.ts:128` — empty video/channel messages and Add channel; filtered-empty Clear filters case absent | FAIL |
| C41 | Loading state in all three data views | Browser | `services/channel-library/browser/reader.spec.ts:142`; `services/channel-library/browser/reader.spec.ts:149`; `services/channel-library/browser/reader.spec.ts:156` — visible Loading status asserted separately for videos, reader, channels | PASS |
| C42 | Errors offer retry and retain previous content in every view | Browser | `services/channel-library/browser/reader.spec.ts:164` — video retry and retained card asserted; reader/channel retry and retained content unproven | FAIL |
| C43 | 401 clears credential and returns to access | Browser | `services/channel-library/browser/reader.spec.ts:182` — Unlock library visible, key empty, local/session storage empty | PASS |
| C44 | Incomplete reader state, original, applicable retry | Browser | `services/channel-library/browser/reader.spec.ts:195` — transcribing/unavailable/failed status plus original; retry visible for last two | PASS |
| C45 | Reader accessible without overflow at 360/1280 | Browser | `services/channel-library/browser/reader.spec.ts:207` — both widths have scrollWidth <= innerWidth and Back to library visible | PASS |
| C46 | Keyboard inputs focus tabs and actions | Browser | `services/channel-library/browser/reader.spec.ts:219` — labeled search and focused tab Enter work; no keyboard activation of an action | FAIL |
| C47 | Protected routes reject invalid owner before admission | Backend | `services/channel-library/test/library.test.ts:537`; `services/channel-library/test/library.test.ts:799` — all seven route/method pairs 401; upstream submit not called | PASS |
| C48 | Absent owner key fails closed | Backend | `services/channel-library/test/library.test.ts:544`; `services/channel-library/test/library.test.ts:772` — 503 on first route and all seven protected routes in C56 | PASS |
| C49 | No upstream secrets in web bundle; memory-only owner token | Backend | `services/channel-library/test/library.test.ts:566`; `services/channel-library/browser/reader.spec.ts:183` — generated bundle excludes three sentinel keys; no persistent storage APIs; browser storage empty | PASS |
| C50 | More than thirty admissions return 429/Retry-After | Backend | `services/channel-library/test/library.test.ts:587` — 29 syncs after registration succeed, next 429; positive retry-after | PASS |
| C51 | Failure envelope is sanitized | Backend | `services/channel-library/test/library.test.ts:596` — 502, UPSTREAM_UNAVAILABLE, error.message and requestId strings; provider token absent | PASS |
| C52 | Worker events always have stage outcome elapsed time | Backend | `services/channel-library/test/library.test.ts:607` — success event assertion passes; production fallback at api/server.ts:29 omits elapsedMs | FAIL |
| C53 | Unconfigured providers report CONFIGURATION_REQUIRED while reads work | Backend | `services/channel-library/test/library.test.ts:631` — registration fails 503 and saved original readable; transcript/LLM affected-action paths unproven | FAIL |
| C54 | Reproducible independent startup/config/storage/scheduling docs | Backend | `services/channel-library/test/library.test.ts:644` — required documentation terms present; CI browser installation swallows --with-deps without npm -- separator | FAIL |
| C55 | Existing API signatures and regressions unchanged | Backend + Root | `services/channel-library/test/library.test.ts:658`; `services/channel-library/test/library.test.ts:699` — separate assembly; production smoke 401/authorized response/static HTML/shutdown; root check 740 passed | PASS |
| C56 | Exact route status and error-envelope matrix | Backend | `services/channel-library/test/library.test.ts:716`; `services/channel-library/test/library.test.ts:778` — status matrix present, but only `expect(response.json().error.code).toEqual(expect.any(String))`; envelopes and exact codes absent for most failure cases | FAIL |

## Ranked findings and exact fixes

1. **C30 — normalize malformed LLM envelopes.** `services/channel-library/api/remote.ts:267` calls `object()` outside the response-validation catch. HTTP 200 JSON null/array produces the wrong stable code, reproduced against the compiled module. Include top-level envelope validation in INVALID_LLM_RESPONSE normalization and assert malformed envelopes at the HTTP adapter boundary, with no published enrichment.
2. **C52 — complete production worker failure telemetry.** `services/channel-library/api/server.ts:29` emits only stage/outcome on a rejected tick. Add elapsedMs and a proof of this production fallback path with no provider body, URL, IDs, content, or secrets. Existing C52 only observes successful enrichment logs.
3. **C54 — CI browser dependency installation.** `.github/workflows/channel-library.yml:21` uses `npm --prefix services/channel-library exec playwright install --with-deps chromium`; npm consumes --with-deps as its own unknown option. Use `npm --prefix services/channel-library exec -- playwright install --with-deps chromium`. The coordinator independently observed the CLI warning during this review; source confirms the missing separator. Keep documented commands consistent. This can prevent clean Linux CI from installing Chromium system dependencies despite local browser success.
4. **C15/C22 — durable recovery/retry proof.** Restart after a discovery page has persisted and prove resume starts at its cursor, keeps stored videos, and completes the checkpoint. Exercise discovery and enrichment retry budgets/times as well as transcription; reopen the database between failures/due times and show work is not admitted before the stored retry time. Current C15 covers saved job and source, while C22 exercises only submit failures in one open process.
5. **C56/C3/C4/C18 — exact HTTP contract proof.** Assert full error envelopes and stable error codes for each failure matrix case, not any string. Explicitly prove CHANNEL_NOT_FOUND and CHANNEL_EXISTS. At the transcript fetch boundary assert POST and request URL body for submission, and GET for polling/result retrieval. Current tests assert paths/auth only.
6. **C5/C28/C37/C53 — backend claim sampling.** Assert the exact selected recent IDs and a fewer-than-ten initial collection. Assert summary-reduction requests include every chunk summary and the saved summary/key points come from reduction. Use contrasting channel/state fixtures so filters exclude nonmatches, and assert maximum page size 100 is accepted. Exercise missing transcript and LLM configuration on their affected processing actions while saved reads remain available.
7. **C35/C36/C40/C42/C46 — browser claim sampling.** Assert collection state and Resume; use several video cards with date ties and an actual thumbnail to prove card order and image; exercise filtered empty state/Clear filters; for channels and reader assert retry action and retention of previously loaded content after a failed refresh; use keyboard to activate a primary action as well as a tab.

Search for missing proof used `rg -n -A 40 "test\('C"` over library tests, test-body searches over remote/browser tests, and a follow-up search for `channelId=`, summary-mode, nextPageToken, error.code, requestId, Resume and thumbnail across both proof directories. These findings follow assertion inspection, not inference from test names.

## Level and sampling limits

Verified at `0eca12321a2a9fc8f853ce5f38cdf24c6a52fa6d`.

Backend route assertions use Fastify injection; remote assertions intercept fetch; worker assertions use real temporary SQLite with controlled providers. C55 additionally launches the compiled server over real TCP. Browser proofs run the real React application with mocked API responses, so they do not establish an end-to-end browser-to-worker/provider flow. C26/C27 prove instruction contents, not a model's semantic compliance. C34 samples source markup; model prose uses the same plain-text rendering pattern but is not separately attacked. C44 samples transcribing as the processing state. C45 exercises the corrected-transcript reader at the two approved widths with short fixture content; long-content overflow and every tab/action are not exhaustively sampled. These scope statements do not establish live provider compatibility or visual approval.

No human visual or interaction acceptance was performed by this independent agent. No external design artifact is marked binding; a UI-profile arrangement comparison was not performed under the approved light profile. No claim of subjective visual approval is made.

## Coverage

Light profile: the author's Coverage join was read, not independently recomputed. Check-level sampling gaps found during the mandatory assertion review are listed above. No claim of an independently complete enumerated route/status/entity/screen join is made.

## Test policy rows

`checks.md` has no Test policy section. No such rows to judge.

## Swept existing

All nine Swept dimensions point to feature check IDs. None resolves to an `existing` constraint, so there is no Swept-existing code constraint to re-read. Active AD-004 through AD-016 and the plan were read; C55 and the actual diff confirm no transcript implementation or historical feature spec was rewritten.

## Faults injected

None — the approved light profile does not require fault injection. The additional C30 probe uses alternate fixture responses without changing source or tests; it is not a mutation experiment.

## Operational limits

No live provider validation was attempted: the YouTube API key and transcript-service credential are missing locally. Go-live still requires configuring providers and a real smoke run; fixture success does not remove that prerequisite. The coordinator separately reported six pre-existing root production dependency audit findings (2 moderate, 4 high), with unchanged root dependency declarations/lockfile and a clean library production audit. This independent review did not rerun either audit; those are attributed operational notes, not independently verified proof or a feature regression.

## Gate

`python3 .agents/skills/tlc-spec-lean/scripts/validate_verification.py channel-transcript-library` exited 1 with 1 error and 0 warnings because this report correctly records FAIL. Completion is blocked on the ranked fixes and scoped independent re-verification at the next committed HEAD, with all proof targets rerun.

Only this report was authored. No implementation, tests, historical artifacts, or dependencies were edited, and no commit was created. Project lesson distillation for the grounded failures is handed to the coordinator because this Verifier was explicitly restricted to writing this report.
