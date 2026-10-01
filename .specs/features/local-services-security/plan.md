# Local services guide and dependency security

## Problem

The separate APIs and reader have no shared guide under docs. The root npm audit currently
reports seven affected packages (four high, three moderate), including transitive dependents.
An operator needs reproducible startup instructions and patched dependencies.

## Flow

Reuse existing npm scripts, auth configuration and test suites.

1. Root `package.json` and `package-lock.json` (exists) resolve patched dependencies; npm audit validates the resulting tree (AC 1).
2. `services/channel-library/package-lock.json` (exists) is audited alongside the root tree (AC 2).
3. Root and library test suites (exists) exercise HTTP, persistence, native RAG and reader behavior after updates (AC 3).
4. Existing API and Vite entrypoints (exists) start together using a new guide under docs, then receive local HTTP health/auth/static requests (AC 4).

## Impact

| Front | What changes |
| --- | --- |
| dependencies | Fastify patch, adm-zip override patch, compatible fast-uri and undici lock resolutions |
| docs | One guide for setup, credentials, concurrent development, compiled startup, checks, shutdown and troubleshooting; root README links it |
| stored data | Nothing to migrate; preserve model assets, embedding fingerprint, RAG runtime and storage namespaces |
| tests | Update exact adm-zip version assertions from the vulnerable pin to the patched pin; retain all behavior assertions |

## Relations

None - no stored-data shape change.

## Surface

None - no route signatures change.

## Landing

None - patch updates to existing dependencies and documentation are reversible; no new dependency or contract.

## Criteria

### S1: Patched services and a usable local guide (P1)

**Acceptance Criteria**

1. The root dependency tree SHALL produce zero known vulnerabilities in a full npm audit.
2. The library dependency tree SHALL produce zero known vulnerabilities in a full npm audit.
3. The root and library check commands SHALL exit 0 after dependency updates, preserving all existing test cases.
4. WHEN an operator follows docs/running-all-services.md THEN both APIs and the Vite reader SHALL run concurrently on ports 3000, 3100 and 5173, with public health returning 200, protected channel reads returning 401 without a key and 200 with the library key through the Vite proxy.

**Independent test:** clean installs, full audits/checks and local startup smoke using temporary storage and fixture owner credentials without provider calls.

## Out of scope

| Excluded | Why |
| --- | --- |
| deployment and provider provisioning | User requested documentation and vulnerability fixes |
| model/runtime upgrades and data migrations | Patch the vulnerable ZIP dependency without changing inference behavior |
| process supervisor | Existing scripts in concurrent terminals satisfy local startup |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| approvals | Proceed under owner's prior instruction granting routine approvals | Scope directly requested | y |
| documentation language | English | Active AD-013 and AGENTS.md; chat remains Portuguese | y |
| affected package count | Use current registry audit result | Advisory dependency propagation can change the count | y |

**Open questions:** none - provider credentials are operator setup, not needed for local smoke.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| documentation | Install prerequisites, both env files and credential mapping | AC 4 |
| documentation | Development and compiled startup, ports, shutdown, persisted paths and troubleshooting | AC 4 |
| existing APIs | Authentication, errors and readiness | AC 3, AC 4; no signature changes |
| dependency tree | Patched resolved versions and security audit | AC 1, AC 2 |
| UI | Existing layout and interaction states | AC 3; no UI changes |

## Sources

- User request: add docs explaining concurrent startup and fix vulnerabilities.
- Existing README, service README, package scripts and environment examples: startup contract.
- npm audit on 2026-10-01: seven root findings.
- https://github.com/advisories/GHSA-4mh8-r7rc-xpvc — Fastify fixed in 5.12.5.
- https://github.com/advisories/GHSA-rcw4-f5rp-g42v — adm-zip fixed in 0.6.1.
- https://github.com/advisories/GHSA-hrr3-gc8f-f4qj — patched fast-uri lines.
- https://github.com/advisories/GHSA-r53p-7pc4-xj5r — patched undici line.

Approved by the owner's explicit request and standing delegation of routine approvals.
