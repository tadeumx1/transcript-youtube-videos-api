# Docker applications checks

Profile: light
Plan: `.specs/features/docker-all-applications/plan.md`

17 checks in 2 slices · 3 one-way doors · 0 open

## Checks

### S1 - Start and operate the stack

**C1** - All three images build using locked dependencies without host node_modules or dist (AC 1; door 1).
Proof: `node --test --test-name-pattern='C1 ' test/docker/stack.test.mjs`

**C2** - Startup reaches three healthy services within the configured 180-second readiness bound, prints the loopback browser URL and streams service-prefixed logs (AC 2, 3, 9; doors 1, 3).
Proof: `node --test --test-name-pattern='C2 ' test/docker/stack.test.mjs`

**C3** - Missing Docker, Compose, engine access, root env or library env each exits nonzero naming the missing prerequisite without printing credential values (AC 4).
Proof: `python3 -m unittest test/docker/test_launcher.py -k test_prerequisites`

**C4** - Default publication binds only web port 8080 to an automatically allocated loopback host port while 3000, 3100, 5173 and 8080 are occupied (AC 5; door 3).
Proof: `node --test --test-name-pattern='C4 ' test/docker/stack.test.mjs`

**C5** - Invalid or occupied DOCKER_WEB_PORT exits nonzero without stopping its listener or changing either env file (AC 6).
Proof: `python3 -m unittest test/docker/test_launcher.py -k test_port_rejection`
Proof: `node --test --test-name-pattern='C5 ' test/docker/stack.test.mjs`

**C6** - The web proxy preserves authenticated library GET/POST/PATCH paths, bodies and 200/202/400/401/404 responses (AC 7).
Proof: `node --test --test-name-pattern='C6 ' test/docker/stack.test.mjs`

**C7** - Library can reach the real transcript API at http://transcript:3000: missing credentials return 401 and configured credentials reach request validation (400) (AC 8).
Proof: `node --test --test-name-pattern='C7 ' test/docker/stack.test.mjs`

**C8** - Interrupt stops only the invocation's containers and retains named volumes; a partial startup failure exits nonzero and removes only containers created by that invocation (AC 10, 11).
Proof: `python3 -m unittest test/docker/test_launcher.py -k test_cleanup`
Proof: `node --test --test-name-pattern='C8 ' test/docker/stack.test.mjs`

**C9** - docker-status and docker-logs inspect the selected project without starting it; docker-down removes that project's containers and retains its volumes (AC 10, 12; door 3).
Proof: `python3 -m unittest test/docker/test_launcher.py -k test_commands`
Proof: `node --test --test-name-pattern='C9 ' test/docker/stack.test.mjs`

### S2 - Preserve application behavior and storage

**C10** - A saved original, enrichment, favorite, read state and note survive container removal/recreation with the same values (AC 13; door 2).
Proof: `node --test --test-name-pattern='C10 ' test/docker/stack.test.mjs`

**C11** - Both data mounts are project-scoped named volumes; no host library/data path is mounted (AC 14; door 2).
Proof: `node --test --test-name-pattern='C11 ' test/docker/stack.test.mjs`

**C12** - The three image layers and served frontend exclude fixture credentials, env files and local-data sentinels (AC 15).
Proof: `node --test --test-name-pattern='C12 ' test/docker/stack.test.mjs`

**C13** - Running application processes use non-root UIDs, application files reject writes and the two data volumes permit writes (AC 16).
Proof: `node --test --test-name-pattern='C13 ' test/docker/stack.test.mjs`

**C14** - A controlled LLM rejection leaves the original readable through the containerized browser/API and logs the safe provider error without transcript or credential content (AC 17).
Proof: `node --test --test-name-pattern='C14 ' test/docker/stack.test.mjs`

**C15** - The host launcher still selects available ports and shuts down its own process groups (AC 18).
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t 'T2 root development wrapper forwards both Vite flags'`

Additional proof for C15 (port selection and process lifecycle):
Proof: `npm exec -- vitest run test/integration/dev-runner.test.ts test/integration/dev-session.test.ts --reporter=verbose`

**C16** - The English run guide names WSL checks, both env files, four make targets, backup/restore and explicit volume-deletion data loss (AC 19).
Proof: `python3 -m unittest test/docker/test_launcher.py -k test_documentation`

**C17** - Runtime verification fails explicitly when Docker is unavailable and reports controlled-provider proof separately from live-provider success (AC 20).
Proof: `python3 -m unittest test/docker/test_launcher.py -k test_runtime_gate`
Proof: `node --test --test-name-pattern='C17 ' test/docker/stack.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| images (3) | transcript C1 · library C1 · web C1 | - |
| startup assemblies (3) | transcript C2 · library C2 · web C2 | - |
| prerequisites (5) | docker C3 · compose C3 · engine C3 · root-env C3 · library-env C3 | - |
| port policy (3) | automatic C4 · invalid C5 · occupied C5 | - |
| commands (4) | docker-up C2 · docker-down C9 · docker-status C9 · docker-logs C9 | - |
| proxy statuses (5) | 200 C6 · 202 C6 · 400 C6 · 401 C6 · 404 C6 | - |
| lifecycle (3) | interrupt C8 · partial-failure C8 · down C9 | - |
| storage (2) | transcript-data C11 · library-data C10 | - |
| stored values (5) | original C10 · enrichment C10 · favorite C10 · read C10 · note C10 | - |
| one-way doors (3) | images/network C1 · volumes C11 · commands C9 | - |

Claims about HTTP/browser responses cross real container boundaries. Providers are controlled
in C10/C14; these checks do not claim a live YouTube or OpenCode result.

## Swept

- validation: C3, C5
- failure modes: C8, C14
- idempotency: C10; startup refuses an existing project rather than adopting its containers
- authorization: C6, C7, C12
- concurrency: C8, C11; one owner per project, no shared host SQLite
- data lifecycle: C10, C11, C16
- dependency failure: C3, C14, C17
- state transitions: C2, C8, C10, C14
- observability: C2, C9, C14

## Handoff

Existing relevant source/docs measured with wc -c: 107997 bytes / 4 = 27000 tokens.
Allow 16000 tokens for container/launcher/tests/docs additions: 43000 total, below the
150000 default budget. One builder, no handoff. Feature base: d8377dc68d8182f77a51226fda76acc56f54dde8.
Implementation uses an isolated snapshot worktree to preserve unrelated uncommitted owner work.
Proof commands add named Docker tests using the existing Node/Python tools, since no complete-stack
container proof exists yet. The owner approved building this container feature on 2026-10-05.

Proof invocation correction: npm exec with --prefix still used the root runner directory;
C15 now uses npm test with --prefix to run the same named T2 assertion in its package.
The port/process claims additionally run the existing root dev-runner/dev-session boundary tests.

Runtime harness correction: GNU Make preserves SIGINT as its exit signal after its Python
recipe completes cleanly. C8 asserts that signal and the successful cleanup message, in addition
to container absence, retained volumes and the unrelated container still running. The plan
requires interrupt cleanup, not an exit-0 convention for GNU Make itself.

## Build evidence

C1-C17 implemented and exercised: 14 real-container tests passed (controlled provider),
6 launcher/documentation tests passed, 26 host process/port regression tests passed, and
T2 Vite argument forwarding passed. C9 additionally passed with a running attached stack
stopped through make docker-down. The final independent verifier must rerun all proofs.
The browser process is always headless; no interactive window is launched.
