# Docker applications verification

**Verdict**: PASS
**Profile**: light
**Diff range**: d8377dc68d8182f77a51226fda76acc56f54dde8..75472f9255548b9dcd958a67043b244b42964219
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Verified all C1-C17 at commit `75472f9255548b9dcd958a67043b244b42964219` in
`/tmp/transcript-docker-work`. The implementation was not edited. The only verification
artifact written is this report. Existing dependency symlinks were present before verification.

## Proof runs

- D: `sg docker -c 'node --test test/docker/stack.test.mjs'` — final isolated run:
  14 tests passed, 0 failed, 0 skipped. Every Docker test name in the table below appeared
  individually as passed. Images were built from copied contexts excluding host dependency
  and build directories. Docker build cache was enabled.
- P: `python3 -m unittest -v test/docker/test_launcher.py` — 6 tests passed,
  with `test_cleanup`, `test_commands`, `test_documentation`, `test_port_rejection`,
  `test_prerequisites` and `test_runtime_gate` individually reported.
- H: `npm exec -- vitest run test/integration/dev-runner.test.ts test/integration/dev-session.test.ts --reporter=verbose`
  — 26 tests passed across both files. Named cases included available-port selection,
  SIGINT/SIGTERM process-group cleanup, stubborn descendants, command failures, and real
  service/proxy sessions with both free and occupied default ports.
- V: `npm --prefix services/channel-library test -- --reporter=verbose -t 'T2 root development wrapper forwards both Vite flags'`
  — the named T2 test passed; 152 unrelated tests were intentionally excluded by this
  approved selector.

The Docker/Python proof files are new in the reviewed feature range. H and V are unchanged
regression proofs for C15, whose obligation explicitly preserves existing host behavior.
All named proofs were located with `rg -n` and surrounding assertion context. No zero-match
test invocation was accepted as evidence.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Three Linux amd64 images build with locked dependencies and no host dependencies/output | D: C1 all three images built from clean dependency-free contexts | `test/docker/stack.test.mjs:22` — `assert.equal(p.status, 0, ...)` checks each clean-context build; `test/docker/stack.test.mjs:89` — `assert.equal(...Architecture, 'amd64')` for transcript/library/web. Locked installs are `Dockerfile:7`, `services/channel-library/Dockerfile:7`, `services/channel-library/web/Dockerfile:5` (`npm ci`). | PASS |
| C2 | Three healthy services, bounded startup, loopback URL and labeled logs | D: C2 three healthy services print URL and combined logs | `test/docker/stack.test.mjs:93` — `assert.equal(inspect().filter(c => c.State.Health.Status === 'healthy').length, 3)`; `test/docker/stack.test.mjs:95` waits for library listening, transcript ready and web GET log labels. `test/docker/stack.test.mjs:41` requires a loopback URL within 180000 ms; `scripts/docker.py:128` supplies `--wait-timeout 180` after build. | PASS |
| C3 | Five missing prerequisites fail without printing fixture credentials | P: test_prerequisites | `test/docker/test_launcher.py:75` — `self.assertNotEqual(result.returncode,0)`; lines 76-77 require the prerequisite name and reject `must-not-be-printed`. Cases at line 64 enumerate Docker, Compose, engine and both env files. | PASS |
| C4 | Only web publishes a loopback dynamic port despite occupied usual ports | D: C4 loopback dynamic port with usual ports occupied | `test/docker/stack.test.mjs:110` — `assert.equal(published.length, 1); assert.equal(published[0].HostIp, '127.0.0.1')`; lines 111-112 exclude 3000/3100/5173/8080 and require zero API publications. The four listener preconditions appear at lines 100-103. | PASS |
| C5 | Invalid/occupied explicit port preserves listeners and env files | P: test_port_rejection; D: C5 occupied explicit port preserves listener and env files | `test/docker/test_launcher.py:87` — `self.assertNotEqual(result.returncode,0)` for 0, -1, 65536, abc and an occupied port; `test/docker/stack.test.mjs:120` asserts nonzero, named DOCKER_WEB_PORT and `assert.ok(server.listening)`; line 121 compares both env files byte-for-byte. | PASS |
| C6 | Existing proxy methods, authentication, request bodies and response statuses | D: C6 proxy preserves methods bodies auth and status codes | `test/docker/stack.test.mjs:126` — unauthorized GET status equals 401; lines 127-131 assert 200, 400, 404, 202 and PATCH 200. `test/docker/stack.test.mjs:132` — `assert.equal(detail.body.video.reading.notes,'Container note')` verifies the PATCH body through subsequent GET. | PASS |
| C7 | Internal real transcript API enforces the configured bearer contract | D: C7 library reaches authenticated real transcript service | `test/docker/stack.test.mjs:137` — `assert.equal(result,'401\n400')` after HTTP POSTs from the library container to its configured transcript URL, first without and then with credentials. `compose.yaml:45` fixes that URL to `http://transcript:3000`. | PASS |
| C8 | Interrupt and partial failure preserve volumes and unrelated containers | P: test_cleanup; D: C8 interrupt retains volumes and leaves unrelated containers alone | `test/docker/stack.test.mjs:143` — `assert.equal(compose('ps','-a','-q'),'')`; line 144 requires unrelated container running and line 145 requires both named volumes. `test/docker/test_launcher.py:98` requires nonzero on partial startup; line 99 requires `['rm','-f','created']`, line 100 forbids volume removal. | PASS |
| C9 | Status/logs inspect; down removes selected containers while keeping volumes | P: test_commands; D: C9 status logs down never start a project and retain its volumes | `test/docker/stack.test.mjs:153` — `assert.equal(compose('ps','-a','-q'), containers)` after status/logs; line 159 requires no containers after down and line 160 inspects retained volumes. `test/docker/test_launcher.py:107` forbids up/volume-delete commands. | PASS |
| C10 | Originals, enrichment and reading state survive recreation | D: C10 persisted content and reading state survive recreation | `test/docker/stack.test.mjs:171` — `assert.deepEqual(after.original,before.original); assert.deepEqual(after.enrichment,before.enrichment)`; line 172 requires favorite/read true and notes exactly `Persisted note`. | PASS |
| C11 | Both application stores use project-scoped named volumes without host binds | D: C11 named volumes never share host library paths | `test/docker/stack.test.mjs:178` — `assert.equal(c.Mounts.filter(m=>m.Type==='bind').length,0)`; line 179 requires volume type, project-prefixed name and expected destination for both stores. | PASS |
| C12 | Images and served assets exclude the fixture secret and local data | D: C12 image layers and frontend contain no env credentials or local data | `test/docker/inspect_layers.py:23` rejects .env names; lines 24, 27-28 reject local.sqlite, the supplied fixture credential and local-data-sentinel from inspected files. `test/docker/stack.test.mjs:188` — `assert.ok(!html.includes(secret))`; line 189 repeats this for referenced JS/CSS assets. | PASS |
| C13 | Serving processes are non-root; application code rejects writes and data accepts them | D: C13 applications are non-root and application code is read-only | `test/docker/stack.test.mjs:195` requires UID 1000 for both API processes; line 196 requires `writable-data-only` after forbidden application write and successful data write. Lines 198-199 require web UID 101 and an unwritable index.html. | PASS |
| C14 | Provider rejection preserves original through API/browser and emits safe logs | D: C14 provider rejection preserves original in API and browser and logs safely | `test/docker/stack.test.mjs:204` — `assert.equal(detail.video.failure.code,'PROVIDER_REQUEST_REJECTED'); assert.ok(detail.original.text)`; lines 205-206 require the safe error and exclude credential, original and provider body. Line 208 asserts the authenticated headless browser's Original transcript panel contains the saved original. | PASS |
| C15 | Existing host port selection and process-group lifecycle are preserved | H; V: T2 root development wrapper forwards both Vite flags | `test/integration/dev-runner.test.ts:271` — `expect(Number(api.port)).toBe(transcript.port + 2)`; lines 272-275 assert library/web selection and synchronized URLs. `test/integration/dev-runner.test.ts:462` — `expect(owned.filter(running)).toEqual([])`, with unrelated PID alive at line 463. `services/channel-library/test/dev-command.test.ts:11` requires both Vite flags; `test/integration/dev-session.test.ts:121` requires authenticated real proxy status 200. | PASS |
| C16 | English run guide includes WSL/env/commands and backup/restore/deletion guidance | P: test_documentation | `test/docker/test_launcher.py:117` — `self.assertIn(value,text)` over the explicit required-term list at lines 114-116. Direct review of `docs/docker.md` confirms root .env, both services' backup and restore commands, and the sentence that removing a volume deletes its saved data. | PASS |
| C17 | Missing Docker is a failing proof; provider evidence is explicitly controlled | P: test_runtime_gate; D: C17 controlled provider proof never claims live external success | `test/docker/test_launcher.py:122` — `self.assertNotEqual(result.returncode,0)`; line 123 requires `Docker runtime proof unavailable`. `test/docker/stack.test.mjs:211` — `assert.match(env.TRANSCRIPT_ENV_FILE,/docker-proof-/)`; line 212 prints the controlled-provider/live-provider distinction, observed in output. | PASS |

## Scope and limitations

This is the approved **light** profile. No fault injection was performed. The Coverage join was
not independently recomputed, and there are no Test policy rows in checks.md. Passing tests do
not establish mutation sensitivity or exhaustive coverage of unlisted set members.

The HTTP/status claims cross actual container boundaries. C14 additionally uses headless
Chromium; no interactive browser window was opened. C10/C14 use controlled upstream responses,
and no live YouTube or OpenCode success is claimed. C7 reaches the real transcript service for
authentication/request validation, not a complete external transcription.

C3 and partial-startup C8 use a recording Docker CLI at the launcher subprocess boundary.
Real Docker proves interrupt/down isolation, volume retention and normal startup; this review
does not claim a deliberately damaged real-engine partial startup. C12 inspects application
paths in saved runtime-image layers, excludes node_modules from content scanning, and scans
file bodies smaller than 10 MB. It verifies the supplied fixtures in their packaged application
locations, not arbitrary secrets in every base-image file or discarded build stage.
C13 samples application-code write rejection and required data writes; it is not an exhaustive
filesystem permission audit. C6 samples the methods/statuses named by the check without
enumerating every existing application route.

The first concurrent attempt was not green: Docker C2 failed with STARTUP_FAILED while the
orchestrator's broad RAG suite and host regressions were also running. An independent
app.ready() probe in the same image with temporary data then succeeded, and subsequent
starts succeeded. The complete isolated Docker rerun passed, including C2 in about 20 seconds.
The exact startup exception was sanitized; resource contention with the existing startup hook
is a hypothesis, not an established root cause. Startup under competing heavy RAG workloads
remains unproven.

The first host run had 25 passes and one failed occupied-default-port session while competing
tests shared ports/env fixtures. An intermediate verbose Python run also hit one 10-second
CLI subprocess timeout under load. Those attempts are retained here rather than counted as
passes; final isolated target runs supplied the successful evidence above. No timeout,
assertion or test selection was weakened.

## Sources and swept constraints

Read AGENTS.md, plan.md, checks.md, STATE.md, the pinned skill and verify reference, and the
full feature diff. Opened the binding repository files Dockerfile, docker-entrypoint.sh,
services/channel-library/api/server.ts, scripts/dev.mjs and docs/running-all-services.md.
Also opened the plan's official Docker references:
[WSL integration](https://docs.docker.com/desktop/features/wsl/),
[Compose services](https://docs.docker.com/reference/compose-file/services/) and
[health-based ordering](https://docs.docker.com/compose/how-tos/startup-order/).
No UI binding-source enumeration is claimed under light.

Swept contains no rows literally classified as existing. Its inherited constraints were still
checked: startup refuses existing containers and uses a project lock
(`scripts/docker.py:115`, `scripts/docker.py:119`); cleanup selects invocation labels
(`scripts/docker.py:89`); both persistent stores remain separate named mounts
(`compose.yaml:22`, `compose.yaml:47`). No storage schema, API implementation or host launcher
implementation changed in the feature range. Existing single-writer and retention behavior
therefore remain the baseline, with C10/C11/C15 providing targeted regression evidence.

## Gate

`python3 .agents/skills/tlc-spec-lean/scripts/validate_verification.py docker-all-applications`
— exit 0; 0 errors, 0 warnings across docker-all-applications.
