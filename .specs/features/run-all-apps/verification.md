# Run all applications verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 93ecb028cad6dd152d7237f11ba139a79d1e8a98..d74b7be5be163efb70bfd5fc526b4eb71eec85fc
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

## Execution

Verified at `d74b7be5be163efb70bfd5fc526b4eb71eec85fc` in a detached temporary worktree.
The main workspace's unrelated uncommitted changes were excluded. Installed root/library
dependency trees and the existing model directory were symlinked into the worktree; no owner
environment files were copied. The HTTP test supplied fixture credentials and temporary stores.

All proofs were batched in one invocation, with individually named results:

```sh
npm test -- test/integration/dev-runner.test.ts test/integration/dev-session.test.ts test/unit/ci-contract.test.ts --reporter=verbose
```

Exit 0: 17 passed, 0 failed, across three files. The 12 feature cases were:

- launches the three documented commands
- preserves service directories and environment loading
- labels output and process lifecycle
- cleans up managed process groups on SIGINT
- cleans up managed process groups on SIGTERM
- forces a stubborn descendant after ten seconds
- stops peers on command exit: zero
- stops peers on command exit: nonzero
- stops peers on command exit: signal
- reports a spawn failure
- documents the combined session and individual commands
- serves both APIs and the authenticated reader proxy

The five existing CI contract cases also individually passed: supported source/offline/audit
triggers; production image build/smoke; fail-closed gates; no provider-secret coupling; and
existing scripts/lockfile/Dockerfile/documented checks. The feature extends the first case's
expected sequence with the library dependency install.

Named tests and their assertion bodies were located using `rg -n -A 48` on both integration
files. Both files are added in the reviewed diff; none of C1–C7 rests solely on an untouched test.

## Checks

All proof references below refer to the successful batched invocation above.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Three existing commands run concurrently with strict Vite port 5173. | `launches the three documented commands` — passed | `test/integration/dev-runner.test.ts:192` — `expect(all.map((entry) => entry.args)).toEqual([['run', 'dev'], ['run', 'library:dev:api'], ['--prefix', 'services/channel-library', 'run', 'dev:web', '--', '--port', '5173', '--strictPort']])`; line 206 — `expect(all.every((entry) => running(entry.pid))).toBe(true)`. | PASS |
| C2 | Service directories, env-file loading and inherited variables are retained. | `preserves service directories and environment loading` — passed | `test/integration/dev-runner.test.ts:213` — `expect(transcript.cwd).toBe(session.dir)`; lines 214–217 assert both library/web directories and `root-env` / `library-env`; line 218 — `expect([transcript.inherited, library.inherited, web.inherited]).toEqual(['from-shell', 'from-shell', 'from-shell'])`. | PASS |
| C3 | Labels identify stdout/stderr and lifecycle, without readiness claims. | `labels output and process lifecycle` — passed | `test/integration/dev-runner.test.ts:229` — `await until(() => session.output().includes(`[${name}] fixture stderr`))`; lines 230–231 assert labeled PID/stdout for all three names; line 233 rejects readiness/listening claims; line 236 — `expect(session.output()).toContain('[web] exited code=0')`; line 238 checks peer code/signal messages. | PASS |
| C4 | Both signals clean up descendants, preserve unrelated processes, and force stubborn descendants after ten seconds. | Both `cleans up managed process groups` cases and `forces a stubborn descendant after ten seconds` — passed | `test/integration/dev-runner.test.ts:255` — `expect(owned.filter(running)).toEqual([])`; line 256 — `expect(running(unrelated.pid)).toBe(true)`; line 273 — `expect(running(stubborn)).toBe(true)` before the deadline; lines 275–276 — `expect(Date.now() - before).toBeGreaterThanOrEqual(9900)` and `.toBeLessThan(13000)`; line 278 confirms all recorded processes stopped. | PASS |
| C5 | Launch failure and zero/nonzero/signal exits identify failure, return nonzero through make and stop peers. | Three `stops peers on command exit` cases and `reports a spawn failure` — passed | `test/integration/dev-runner.test.ts:289` — `expect(session.child.exitCode).not.toBe(0)`; lines 290–293 assert the web result (`code=0`, `code=7`, `signal=SIGTERM`) and `expect(owned.filter(running)).toEqual([])`; line 301 repeats the nonzero assertion for ENOENT and line 302 matches a labeled ENOENT failure. | PASS |
| C6 | Real health, reader and authenticated/unauthenticated proxy responses meet the specified contract. | `serves both APIs and the authenticated reader proxy` — passed | `test/integration/dev-session.test.ts:72` — `expect(response.status).toBe(200)` and line 73 — `expect(await response.json()).toEqual({ status: 'ok' })`, for ports 3000 and 3100; lines 76–77 assert reader 200/root HTML; line 80 — `expect(denied.status).toBe(401)`; line 82 asserts `UNAUTHORIZED`; line 86 — `expect(allowed.status).toBe(200)` and line 88 asserts an empty items array. | PASS |
| C7 | English guide documents setup, combined operation, shutdown/failure and individual commands. | `documents the combined session and individual commands` — passed | `test/integration/dev-runner.test.ts:322` — `assert.ok(guide.includes(text), `Guide must include ${text}`)` over the inline literal list at lines 307–320 containing `make dev`, all three labels/commands, `Ctrl+C`, `ten seconds`, `nonzero`, installation, env-file and model prerequisites. Read the committed guide directly to confirm those tokens form accurate English instructions. | PASS |

Two additional literal assertions above use regular expressions, reproduced outside the table:

- `test/integration/dev-runner.test.ts:233`: `expect(session.output()).not.toMatch(/ready|listening/i)`.
- `test/integration/dev-runner.test.ts:302`: `expect(session.output()).toMatch(/\[(transcript|library|web)\] failed to start: ENOENT/)`.

## Level and sampling judgment

The process tests invoke the actual Makefile and runner in isolated directories. C1 demonstrates
simultaneously live commands, C2 uses real npm with the existing API command prefixes, and C4/C5
observe operating-system process state and make's exit. C6 crosses real HTTP boundaries through
the actual combined development session; it also confirms every service label and closed listeners
after SIGINT (`test/integration/dev-session.test.ts:89`, `:101`, `:103`). These levels match the
claims. All two shutdown signals and all three specified unexpected-exit outcomes ran individually.

Sampling limits: the ENOENT scenario removes npm for all commands; it does not separately simulate
one spawn failing after another has succeeded. Peer cleanup is exercised by each unexpected-exit
case, with bounded force termination exercised by C4. C2 substitutes a fixture for Vite to observe
its directory/inherited environment; actual Vite startup and proxy wiring are covered by C6.
No provider calls, RAG readiness, browser interaction, native Windows behavior, or automatic
restarts are claimed. The run guide correctly distinguishes process launch from readiness and
documents that a watcher can remain alive after an application error.

## Swept existing

The authorization constraint is present and unchanged in the feature diff. Transcript Bearer
parsing/comparison and 401 rejection are at `src/http/app.ts:168`, `:192` and `:195`; the hook is
attached to transcript/PDF routes at `:385` and `:421`, and passed to job/RAG registration at
`:317` and `:320`. Library `/api/` requests require the configured Bearer key and reject mismatch
with 401 at `services/channel-library/api/app.ts:58` through `:64`. C6 verifies both Vite proxy
authorization outcomes. The existing npm API commands retain their service-local
`--env-file-if-exists=.env` handling, and the new runner inherits `process.env`.

## Profile scope

No binding source is designated in the plan. No Test policy rows are present. Under the approved
light profile, the Coverage join was not recomputed and no faults were injected. This report does
not claim the stronger guarantees of those steps. No human UI judgment is needed for this local
process-launcher change. No grounded failure was found, so no lesson was added.

## Additional checks

- `npm run lint` — exit 0, 124 files checked, no fixes.
- `npm run typecheck` — exit 0.
- `node --check scripts/dev.mjs` — exit 0.
- `git diff --check 93ecb028cad6dd152d7237f11ba139a79d1e8a98..HEAD` — exit 0.

## Gate

`python3 .agents/skills/tlc-spec-lean/scripts/validate_verification.py run-all-apps` — exit 0; 0 errors, 0 warnings.
