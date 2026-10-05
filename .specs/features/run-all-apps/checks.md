# Run all applications checks

Profile: light
Plan: `.specs/features/run-all-apps/plan.md`
Approved: user confirmed the plan on 2026-10-04.
Feature base: `93ecb028cad6dd152d7237f11ba139a79d1e8a98`

7 checks in 1 slice · 0 one-way doors · 0 open questions.

## Checks

### S1 - One development session

**C1** - `make dev` starts exactly the three existing development commands concurrently, with Vite port 5173 and strict port selection (AC 1).
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'launches the three documented commands'`

**C2** - The commands keep service working directories, their existing env-file loading and inherited variables (AC 2).
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'preserves service directories and environment loading'`

**C3** - Output labels distinguish transcript, library and web stdout/stderr; launches show PIDs without claiming readiness, and exits show code or signal (AC 3).
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'labels output and process lifecycle'`

**C4** - SIGINT and SIGTERM stop managed descendants but leave an unrelated process alive; a stubborn descendant receives force termination after the ten-second grace period (AC 4).
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'cleans up managed process groups|forces a stubborn descendant after ten seconds'`

**C5** - Spawn failure and unexpected command exits (zero, nonzero and signal) identify the command, clean up peers and return nonzero through make (AC 5).
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'stops peers on command exit|reports a spawn failure'`

**C6** - The real combined development session returns 200 and `{ status: 'ok' }` from both health endpoints, serves the reader HTML, and returns 401 without auth and 200 with auth through the Vite channels proxy (AC 6).
Proof: `npm test -- test/integration/dev-session.test.ts -t 'serves both APIs and the authenticated reader proxy'`

**C7** - The English run guide explains `make dev`, labels, Ctrl+C, failure behavior and prerequisites, and retains all three individual commands (AC 7).
Proof: `npm test -- test/integration/dev-runner.test.ts -t 'documents the combined session and individual commands'`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| command launches (3) | transcript C1 · library C1 · web C1 | - |
| service configuration assemblies (3) | transcript C2 · library C2 · web C2 | - |
| lifecycle output (4) | launch C3 · stdout C3 · stderr C3 · exit C3 | - |
| shutdown signals (2) | SIGINT C4 · SIGTERM C4 | - |
| shutdown outcomes (3) | cooperative descendants C4 · stubborn descendant C4 · unrelated process C4 | - |
| command failures (4) | spawn failure C5 · exit 0 C5 · exit 7 C5 · SIGTERM C5 | - |
| HTTP wiring (5) | transcript health C6 · library health C6 · reader HTML C6 · denied proxy C6 · allowed proxy C6 | - |

Claims about HTTP responses cross real HTTP boundaries in C6. Subprocess proofs use isolated
fixtures for lifecycle behavior; they do not assert provider behavior or RAG readiness.

## Swept

- validation: C1 - strict reader port; the existing service commands validate application configuration.
- failure modes: C4, C5 - partial startup, unexpected exits and bounded cleanup.
- idempotency: n/a - this launcher creates a foreground session, not a retryable data operation; existing port binding rejects conflicting listeners.
- authorization: existing - service Bearer-token guards remain unchanged; C6 asserts both proxy authorization outcomes.
- concurrency: C1, C4 - concurrent commands and independent process groups.
- data lifecycle: C2 - existing service working directories; tests use temporary storage and never delete user data.
- dependency failure: C5 - missing executable or command exit tears down the session.
- state transitions: C3, C4, C5 - launched commands, stopping session and exited commands.
- observability: C3 - named stdout/stderr and launch/exit events.

## Handoff

- One builder. Read scope is 24,816 bytes (package manifests, guide and plan), about 6k tokens at
  four bytes/token; allow 24k for runner, subprocess fixtures, real HTTP smoke and documentation,
  totaling about 30k, below the default 150k budget. No slice split is required.
- Existing Vitest runs TypeScript integration tests; the named proofs are new tests in that
  established runner. Real HTTP proof uses temporary stores and fixture tokens without importing
  channels or calling paid providers.
- Pre-existing work remains outside feature commits; only this feature's documentation hunks
  are staged. The feature is also tested against the owner's current working tree.
- **Boundary:** C1–C7 implemented and all 12 named test cases passed locally; the five existing
  CI contract tests also passed. Typecheck, lint, Node syntax and diff whitespace checks passed.
  Independent verification follows the feature commit.
- **Settled mid-build:** The source CI job needs the existing library dependency install for C6.
  Its contract assertion now requires that extra install step while retaining every earlier gate.
  GNU make was absent locally and installed from Ubuntu's package into the user's `.local/bin`.
- **Abandoned:** None.
