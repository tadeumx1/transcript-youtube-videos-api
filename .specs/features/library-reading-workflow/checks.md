# Library reading workflow checks

Profile: light
Plan: `.specs/features/library-reading-workflow/plan.md`

15 user-requested tasks, in three groups of five. Routine approvals delegated. Live failures remain
blocked and are not counted as completed. CLI browser exploration supplements reproducible tests.

## Checks

### S1 - Review and corrections

**C1** - Patched dependency pins remain, both CI workflows audit all dependencies, and audit network failure is reported honestly. (AC 1)
Proof: `npm test -- --reporter=verbose test/unit/ci-contract.test.ts test/unit/rag-dependency-contract.test.ts`; `npm audit`; `npm --prefix services/channel-library audit`

**C2** - Root Vite wrapper forwards --port and --strictPort. (AC 2)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T2 "`

**C3** - Terminal failed jobs resubmit on retry; pending polls keep the ID. (AC 3)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T3 "`

**C4** - Whitespace credentials trim; unknown/repeated/invalid filters return 400 INVALID_REQUEST. (AC 4)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T4 "`

**C5** - Old-session responses cannot restore content or invalidate a new session. (AC 5)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "T5 "`

### S2 - Integration validation

**C6** - Local setup preserves existing values and creates missing distinct owner keys; preflight exits 2 for missing names with no secret values. (AC 6)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T6 "`; `npm --prefix services/channel-library run validate:live -- preflight`

**C7** - Explicit RSS mode discovers bounded public channel uploads without a key; live discovery must actually succeed to close this task. (AC 7)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T7 "`; `npm --prefix services/channel-library run validate:live -- discovery`

**C8** - Live transcript job/source identity validates within a deadline; source is saved only in ignored validation storage. (AC 8)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T8 "`; `npm --prefix services/channel-library run validate:live -- transcript`

**C9** - Actual OpenCode output validates without content/key logging; sample smoke is identified separately from actual transcript enrichment. (AC 9)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T9 "`; `npm --prefix services/channel-library run validate:live -- llm`

**C10** - Real local transcript/library HTTP assemblies reach ready, preserve original, restart and deduplicate; fixtures are explicitly identified. (AC 10)
Proof: `npm run test:library:http`

### S3 - Reading features

**C11** - Favorite toggles and migration defaults persist through restart with prior metadata/originals preserved. (AC 11)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T11 "`; `npm --prefix services/channel-library run test:browser -- --grep "T11 "`

**C12** - Read/unread is persistent and independent of favorite/processing. (AC 12)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T12 "`; `npm --prefix services/channel-library run test:browser -- --grep "T12 "`

**C13** - Notes enforce 0–10000 code points, known fields/types, preservation of source/enrichment and unsaved drafts during refresh/errors. (AC 13)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T13 "`; `npm --prefix services/channel-library run test:browser -- --grep "T13 "`

**C14** - Authenticated Markdown export includes all available sections, canonical URL, unavailable labels and escaped untrusted text; no credential URL. (AC 14)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T14 "`; `npm --prefix services/channel-library run test:browser -- --grep "T14 "`

**C15** - Combined reading filters compose with existing filters/pagination; clear resets everything to page 1, and controls fit 360px and keyboard operation. (AC 15)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "T15 "`; `npm --prefix services/channel-library run test:browser -- --grep "T15 "`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| PATCH /api/v1/videos/:videoId/reading statuses (7) | 200 C11 · 400 C13 · 401 C13 · 404 C13 · 413 C13 · 429 C13 · 503 C13 | - |
| GET /api/v1/videos/:videoId/export statuses (5) | 200 C14 · 400 C14 · 401 C14 · 404 C14 · 503 C14 | - |
| GET /api/v1/videos statuses (4) | 200 C15 · 400 C4 · 401 C13 · 503 C13 | - |
| reading fields (4) | favorite C11 · read C12 · notes C13 · updatedAt C11 | - |
| discovery modes (2) | data_api existing C1/C10 proofs · rss C7 | - |
| CLI live stages (4) | preflight C6 · discovery C7 · transcript C8 · llm C9 | - |
| new doors (4) | migration C11 · reading API C11/C13 · export C14 · keyless discovery C7 | - |

## Swept

- validation: C4, C7, C13
- failure modes: C3, C5, C6–C10, C13
- idempotency: C3, C10, C11
- authorization: C5, C13, C14
- concurrency: C5, C13; existing single-process store retained
- data lifecycle: C10, C11, C13
- dependency failure: C1, C6–C10
- state transitions: C3, C11, C12
- observability: C6–C10; sanitized stage outcomes, no credentials or source content

## Handoff

One builder. Existing service files measured 156102 bytes / 4 = 39026 tokens; root boundary tests,
CLI probes and new code budget ~100000 bytes / 4 = 25000; verification allowance 30000.
Total estimate 94026 under the default 150000 budget. The 15 task rows are explicitly requested by
the owner; they do not replace the frozen claims. Independent verifier after the final code snapshot.
Current environment makes .git read-only; if local commits are denied, record the exact working-tree
snapshot and mark that workflow limitation instead of bypassing it. Historical specs remain intact.

## Task status

| Task | Objective | Status |
| --- | --- | --- |
| 1 | Dependency and CI review | implemented; registry audit blocked by DNS |
| 2 | Development command forwarding | direct CLI proof passed; subprocess capture blocked |
| 3 | Job retry recovery | implemented; regression passed |
| 4 | Configuration and API validation | implemented; regression passed |
| 5 | Browser session isolation | implemented; browser proof blocked |
| 6 | Safe setup and preflight | implemented; unit and actual preflight passed |
| 7 | Keyless discovery and live probe | RSS/probe implemented; fixtures pass; live DNS blocked |
| 8 | Actual transcript probe | probe implemented; fixtures pass; video/network/listener blocked |
| 9 | Actual LLM probe | probe implemented; fixtures pass; live DNS blocked |
| 10 | Real local HTTP integration | proof script ready; listener EPERM |
| 11 | Favorites | backend passed; browser proof blocked |
| 12 | Read/unread | backend passed; browser proof blocked |
| 13 | Personal notes | backend passed; browser proof blocked |
| 14 | Markdown export | backend passed; browser proof blocked |
| 15 | Reading filters | backend passed; browser proof blocked |

Proof placement amendment before C10 implementation: use a standalone compiled-assemblies HTTP script instead of importing library source into the root TypeScript test project. This preserves independent package installs/typechecking; the asserted outcome and actual HTTP boundary are unchanged. Owner delegation covers this reversible placement choice.

Environment evidence (2026-10-02): npm registry and YouTube/OpenCode requests fail DNS with EAI_AGAIN.
Vite and the real HTTP proof fail `listen EPERM`; Playwright CLI fails daemon startup even with a
writable /tmp cache. Root child-process capture/port tests fail due sandbox restrictions; a direct
root Vite --help command confirms forwarded flags, but the captured subprocess test has no output.
No assertions or existing tests were removed/skipped to claim green. Local setup and preflight succeeded.
New setup unit proof imports the exported function directly rather than spawning Node; its same
credential-preservation assertions remain. The CLI was separately executed against actual ignored env files.

Independent round 2: C3/C4/C6 PASS; remaining checks BLOCKED by required runtime evidence.
Both discovered defects (persisted terminal-job retries and unrelated channel identity) were fixed;
the new regression assertions failed before their fixes and pass afterward. Full root suite:
737 passed / 740; library: 85 passed / 90, with the same environment-bound failures. Lint,
typecheck and builds pass. The completion validator exits 1, so none of the blocked tasks is
reported complete. See `verification.md` and `snapshot.sha256` for the independent review scope.
