# Local services guide and dependency security checks

Profile: light
Plan: `.specs/features/local-services-security/plan.md`

4 checks in 1 slice · 0 one-way doors · 0 open questions.

## Checks

### S1 - Patched services with concurrent startup instructions

**C1** - Root full dependency audit reports zero known vulnerabilities. (AC 1)
Proof: `npm audit`

**C2** - Library full dependency audit reports zero known vulnerabilities. (AC 2)
Proof: `npm --prefix services/channel-library audit`

**C3** - Both packages pass lint, type checks, build and every existing test after updates; exact dependency assertions retain the patched adm-zip value 0.6.1 and the current inference packages. (AC 3)
Proof: `npm run check:all`
Named dependency proof: `npm test -- --reporter=verbose test/unit/rag-dependency-contract.test.ts`

**C4** - The docs guide covers prerequisites, both env files and credential mapping, three concurrent development terminals, compiled mode, persistent paths, shutdown and troubleshooting; real startup serves API health on 3000 and 3100, reader HTML on 5173, and protected channel requests via the Vite proxy give 401 without auth and 200 with the library owner token. (AC 4)
Proof: follow `docs/running-all-services.md` startup using isolated temporary data and fixture owner credentials, then run its executable `Verify the running services` block (exit 0). The verifier reads each guide section against package scripts and config; local HTTP assertions settle the startup contract. No paid/provider calls required.

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| audited dependency trees (2) | root C1 · library C2 | - |
| running services (3) | transcript API 3000 C4 · library API 3100 C4 · Vite 5173 C4 | - |
| library proxy auth statuses (2) | unauthenticated 401 C4 · owner 200 C4 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C3, C4
- idempotency: n/a - no processing or persistence behavior changes
- authorization: C3, C4
- concurrency: C4
- data lifecycle: C3, C4; no schema/model/fingerprint changes
- dependency failure: C1, C2, C3
- state transitions: n/a - existing state machines unchanged
- observability: C4; existing logs and local health requests

## Handoff

One builder. Root manifest/lock ~200 KB / 4 = 50000 tokens; guide, contract test, specs and README
~60 KB / 4 = 15000; verification allowance 20000. Estimated 85000 below the default 150000 budget.
The user has authorized these corrections and delegated routine approval decisions. The existing
adm-zip 0.6.0 exact-version assertions must move to 0.6.1 as part of the requested security update;
this replaces an obsolete vulnerable pin, preserves exactness and weakens no behavioral assertion.
No historical feature specs will be edited. Fresh independent verification follows the final commit.

Completion: C1–C4 author proofs passed; fresh independent verification pending.

- Full root and library audits: zero known vulnerabilities, including development dependencies.
- `npm run check:all`: 740 root, 69 library backend and 17 browser tests passed; lint, types and builds passed.
- Root `npm ci` passed. Default library `npm ci` exposed missing local make; documented both build
  prerequisites and the prebuilt alternative. Library `npm ci --ignore-scripts`, SQLite binding
  probe and full build/check passed. No dependency scripts, native binaries or secrets were committed.
- Real documented development and compiled startup passed with temporary storage and fixture
  credentials: health bodies, reader HTML, Vite proxy 401/200, real E5 readiness and clean shutdown.
  Guide smoke code was executed verbatim; no external provider calls occurred.
- Initial documentation smoke caught npm argument loss through the nested root web wrapper.
  The guide now invokes the service's dev:web script directly; rerun passed. A smoke harness cleanup
  wait was added so it checks released ports after child processes finish shutting down.
- The model fetch command reused and verified local pinned artifacts. No model or storage changes.

