# Development port fallback checks

Profile: light
Feature base: `4ef95c7a7116d9efcf19aebd0833b8fbd6e4ca6d`

## Intent

The owner explicitly requested an amendment to the approved and implemented `make dev` workflow:
check configured ports and select alternatives when other local applications already occupy them.
This supersedes the earlier fixed-port startup requirement for the combined session. Keep the
historical run-all-apps artifacts intact. This bounded amendment touches three operational files:
the existing launcher, Vite configuration and run guide, plus their verification tests; there is
no new dependency or one-way door, so use the skill's checks-only path.

Use the first bindable port from the preferred port through the next 99 ports, capped at 65535.
Honor shell overrides before service-local `.env` values for API hosts/ports; keep 3000/3100/5173
as defaults; `WEB_PORT` optionally selects the reader preference from the shell or root `.env`.
Pass the selected transcript origin to the library and the selected library origin
to Vite through process-local environment values. Never print or copy service credentials.
Bind probes use the actual configured host and reserve distinct ports until selection finishes.
Release probes before starting the existing npm commands. As with any probe-before-bind scheme,
another application can win the subsequent race; do not claim an atomic port handoff or automatic
application restart. Existing command-exit handling and Ctrl+C cleanup remain in force.

## Checks

**C1** - Free preferred ports are retained; occupied preferred ports advance to the first free candidate; choices are distinct even when API preferences coincide.
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'launches the three documented commands|selects free ports and synchronizes service URLs|keeps coinciding port preferences distinct'`

**C2** - Shell host/port values override service `.env` preferences, file values are used when no shell override exists, and both `.env` files remain byte-for-byte unchanged.
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'honors port configuration without rewriting env files'`

**C3** - The launcher passes the selected API ports and matching upstream/proxy origins only to the relevant commands, prints the three selected URLs and announces each changed port without printing credentials.
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'selects free ports and synchronizes service URLs'`

**C4** - Invalid port configuration, a failed host lookup and an exhausted bounded candidate range fail nonzero before any application command starts; probe listeners are released.
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'rejects invalid preferred ports|reports exhausted port selection|releases probes after a host failure'`

**C5** - With all three default ports occupied, the real combined session serves both health endpoints, the reader HTML and the authenticated Vite proxy on the selected alternatives; unrelated listeners remain alive after session shutdown.
Proof: `npm test -- test/integration/dev-session.test.ts -t 'serves both APIs and the authenticated reader proxy'`

**C6** - The English run guide explains automatic selection, selected URLs, temporary overrides and how to run health/proxy checks against the selected ports.
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'documents automatic port selection'`

**C7** - Labeled output, env loading, command-exit failure and signal cleanup retain the previous behavior, including ten-second forced descendant termination.
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'preserves service directories and environment loading|labels output and process lifecycle|cleans up managed process groups|forces a stubborn descendant after ten seconds|stops peers on command exit|reports a spawn failure'`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| managed services (3) | transcript C1 C3 C5 · library C1 C3 C5 · web C1 C3 C5 | - |
| configuration sources (3) | shell C2 · env files C2 · defaults C1 | - |
| allocation outcomes (4) | free C1 · occupied C1 · internal collision C1 · exhausted C4 | - |
| preflight failures (3) | invalid port C4 · host lookup C4 · exhaustion C4 | - |
| wiring (2) | library upstream C3 · Vite proxy C3 C5 | - |
| probe and process cleanup (2) | preflight C4 · running session C7 | - |

## Swept

- validation: C4 - integer ports from 1 through 65535 and a maximum 100-candidate search.
- failure modes: C4, C7 - fail before launch on preflight error; preserve existing teardown afterward.
- idempotency: C2 - selection is temporary, never persisted in configuration.
- authorization: existing - the same API token guards remain; C5 asserts proxy 401/200.
- concurrency: C1 - distinct reserved selections; the probe-to-process race is explicitly outside atomicity guarantees.
- data lifecycle: n/a - no storage change; running multiple library writers against the same database remains unsupported.
- dependency failure: C4, C7 - failed lookup and missing npm produce errors without killing unrelated applications.
- state transitions: C4, C7 - selecting, launching and stopping release owned resources.
- observability: C3, C6 - preferred-to-selected changes and the final three URLs.

## Handoff

- One builder: five existing files total approximately 35 KB / 4 = 9k read tokens; allow another
  20k for implementation, tests and review, about 29k under the default 150k budget.
- Independent verification follows the final implementation commit. Existing uncommitted
  owner work remains outside feature commits.
- **Boundary:** C1–C7 implemented; subprocess and real HTTP proofs passed locally with both free
  and occupied defaults. The full 100-candidate exhaustion case also passed. Root lint, both
  package typechecks, script syntax and diff whitespace checks passed.
- **Settled mid-build:** Existing process fixtures use explicit, isolated port preferences to
  avoid racing the real HTTP test for the same ports. The HTTP test retains exact assertions
  for default ports when free and adds the all-defaults-occupied case.
- **Abandoned:** None.
