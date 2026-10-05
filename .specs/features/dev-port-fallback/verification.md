# Development port fallback verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 4ef95c7a7116d9efcf19aebd0833b8fbd6e4ca6d..0908f4cff36a978672bca4c1b92b8aeed7355014
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier)

## Scope and execution

Verified the committed source at `0908f4cff36a978672bca4c1b92b8aeed7355014` in a temporary detached worktree. Root and library dependencies and model assets were symlinked from the main workspace. Uncommitted owner changes were excluded. This is the approved checks-only amendment; there is no separate plan or binding source. Historical run-all-apps specifications were not modified.

Proof command P1: `npm test -- test/integration/dev-runner.test.ts test/integration/dev-session.test.ts --no-file-parallelism --reporter=verbose` — exit 0, 26 passed, 0 failed. Both files ran in one invocation, sequentially. Every named case appeared individually in verbose output. Assertions and test names were located using `rg -n -A 48 'it\(|test\(|it.each'` over both files and compared with the full feature diff. C7 intentionally retains the existing lifecycle regression assertions while exercising the modified launcher and fixture.

## Checks

All proofs rerun at `0908f4cff36a978672bca4c1b92b8aeed7355014`. C2 assertion review verified at this SHA; C1/C3/C4/C5/C6/C7 semantic reviews carried from `522c7652e7b50a63c08b40c74cecb955e1d324c4`, with citations refreshed after the inserted test. The scoped diff changes only fixture host recording and adds the C2 case; no existing assertion was removed or weakened.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Retain free preferences, advance to first free candidate, keep selections distinct | P1: launches the three documented commands; selects free ports and synchronizes service URLs; keeps coinciding port preferences distinct | `test/integration/dev-runner.test.ts:249` — `expect(all[0].port).toBe(String(session.preferred.transcript))`; `test/integration/dev-runner.test.ts:271` — `expect(Number(api.port)).toBe(transcript.port + 2)`; `test/integration/dev-runner.test.ts:304` — `expect([api.port, library.libraryPort, web.args.at(-2)]).toEqual([String(port), String(port + 1), String(port + 2)])` | PASS |
| C2 | Shell host/port precedence, file fallback, unchanged env bytes | P1: honors port configuration without rewriting env files: shell override false / true; honors port configuration without rewriting env files from file hosts | `test/integration/dev-runner.test.ts:333` — selected ports equal `(override ? [shellPort, shellLibrary, shellWeb] : [filePort, fileLibrary, fileWeb]).map(String)`; file bytes unchanged at lines 338–339. New case explicitly removes shell hosts at line 354; `test/integration/dev-runner.test.ts:358` — `expect(api.host).toBe('localhost')`, line 359 — `expect(library.libraryHost).toBe('localhost')`; lines 360–362 assert the two localhost URLs and matching upstream; lines 363–364 assert unchanged file bytes. | PASS |
| C3 | Per-command selected ports/origins, three URLs, changed-port notices, credential omission | P1: selects free ports and synchronizes service URLs | `test/integration/dev-runner.test.ts:274` — `expect(readerApi.upstream).toBe(\`http://127.0.0.1:${api.port}\`)`; line 275 asserts reader proxy origin, lines 276–277 preserve unrelated command values; `test/integration/dev-runner.test.ts:286` — `expect(session.output()).toContain(\`[${name}] port ${original} unavailable; using ${selected}\`)`; line 287 asserts each URL; line 289 asserts output excludes `private-test-key` | PASS |
| C4 | Invalid ports, host failure and bounded exhaustion fail before launch and release probes | P1: rejects invalid preferred ports: 0 / 65536 / invalid / 3.5; reports exhausted port selection with 1 / 100 candidates; releases probes after a host failure | `test/integration/dev-runner.test.ts:372` — `expect(session.child.exitCode).not.toBe(0)` and line 374 excludes `started pid=`; exhaustion equivalents at lines 382–384; `test/integration/dev-runner.test.ts:397` — `expect((await occupy(port)).server.listening).toBe(true)` after host failure | PASS |
| C5 | Real HTTP session works with all defaults occupied and preserves unrelated listeners | P1: serves both APIs and the authenticated reader proxy: occupied defaults false / true | `test/integration/dev-session.test.ts:102` — occupied selected ports are greater than defaults; lines 107–108 assert health 200 and `{ status: 'ok' }`; line 112 asserts reader root HTML; lines 115 and 121 assert proxy 401/200; `test/integration/dev-session.test.ts:144` — `expect((await fetch(\`http://127.0.0.1:${address.port}\`)).status).toBe(418)` after shutdown | PASS |
| C6 | English guide explains selection, URLs, temporary overrides and selected-origin checks | P1: documents automatic port selection | `test/integration/dev-runner.test.ts:412` — `expect(guide).toContain(text)` over the inline required phrases at lines 402–410. Read `docs/running-all-services.md:143` for overrides and bounded selection and `docs/running-all-services.md:225` for the health/proxy example using all three origin variables. | PASS |
| C7 | Preserve env loading, labels, command-exit failure, signals and ten-second forced descendant cleanup | P1: preserves service directories and environment loading; labels output and process lifecycle; cleans up managed process groups on SIGINT / SIGTERM; forces a stubborn descendant after ten seconds; stops peers on command exit: zero / nonzero / signal; reports a spawn failure | `test/integration/dev-runner.test.ts:423` — `expect(transcript.local).toBe('root-env')`, line 424 library env, lines 425–428 shell inheritance; lines 437–438 assert PID/stdout labels; line 462 asserts no owned process remains and line 463 preserves unrelated process; `test/integration/dev-runner.test.ts:482` — `expect(Date.now() - before).toBeGreaterThanOrEqual(9900)` with upper bound 13000 at line 483; lines 496/500 assert nonzero command exit and no remaining owned processes; line 509 asserts spawn ENOENT | PASS |

## Findings

**F1 — C2 sampling gap, found in round 1 at `522c765`, resolved in round 2 at `0908f4c`:** `test/integration/dev-runner.test.ts:153` and line 154 always put `HOST=127.0.0.1` and `LIBRARY_HOST=127.0.0.1` into the child environment. Both configuration cases put `unknown.invalid` hosts in the files (lines 320–321), but only remove shell **ports** in the fallback case (lines 325–328). They prove shell-host precedence and file-port fallback, not file-host fallback. Search `rg -n 'HOST|LIBRARY_HOST|host:' test/integration/dev-runner.test.ts test/integration/dev-session.test.ts` found no named proof with absent shell hosts and asserted file-selected hosts. This was a missing proof, not an observed launcher defect. The added named case at `test/integration/dev-runner.test.ts:346` runs real npm with both shell hosts absent, asserts the two file-loaded child hosts and printed URLs, asserts the library upstream, and checks unchanged env bytes. The original assertions remain intact. F1 is resolved. Lesson L-024 is retained; no duplicate lesson was added.

## Level, lifecycle and existing constraints

Carried from `522c7652e7b50a63c08b40c74cecb955e1d324c4`, except C2 sampling reassessed at `0908f4cff36a978672bca4c1b92b8aeed7355014`.

The subprocess boundary is appropriate for selection, output, environment and process ownership; the real HTTP proof covers health and authenticated proxy outcomes. The documentation proof is supplemented by direct reading of the committed guide. F1 is resolved; no remaining level or sampling gap was found in the seven claims.

Reread the `Swept existing` authorization constraint: `services/channel-library/api/app.ts:58` protects `/api/`, fails closed on absent owner configuration at line 60 and returns 401 on mismatched tokens at lines 61–64. `src/http/app.ts:180` retains transcript authentication, including missing-configuration 503 at line 183 and missing/invalid credential 401 at line 195. Neither guard changed in this feature. C5 exercised library authorization through Vite.

Port probes reserve distinct ports until the `finally` block closes all successful reservations in `scripts/dev.mjs:88`. Selection aborts on session shutdown. `scripts/dev.mjs:122` signals only owned detached child groups; line 145 retains the ten-second deadline and line 152 forces remaining groups. Successful HTTP teardown and the stubborn-descendant proof passed. The guide explicitly documents the probe-to-bind race; no atomic handoff is claimed.

Under profile light, coverage joins were not recomputed and faults were not injected. No human interaction proof is required for this operational change.

## Additional validation

Root lint, root typecheck and diff whitespace verified at `0908f4cff36a978672bca4c1b92b8aeed7355014`. Library typecheck and launcher syntax results carried from `522c7652e7b50a63c08b40c74cecb955e1d324c4`; the fix changes neither library nor launcher source.

- `npm run lint` — exit 0, 124 files checked, no fixes.
- `npm run typecheck` — exit 0.
- `npm --prefix services/channel-library run typecheck` — exit 0.
- `node --check scripts/dev.mjs` — exit 0.
- `git diff --check 4ef95c7a7116d9efcf19aebd0833b8fbd6e4ca6d..HEAD` — exit 0.
- All 26 individually reported cases passed, including the extra existing combined-session documentation regression.

## Gate

Round 1: exit 1 because F1 left C2 unproven. Round 2: `python3 .agents/skills/tlc-spec-lean/scripts/validate_verification.py dev-port-fallback` — exit 0, 0 errors, 0 warnings. All seven checks are proven. The temporary detached worktree was removed after testing; unrelated owner files and processes were preserved.
