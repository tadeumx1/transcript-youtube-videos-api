# Railway Production Deploy Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute
flow and Critical Rules.** The skill is the source of truth for the per-task cycle, gates, atomic
commits, independent Verifier, and requirement traceability.

**If the skill cannot be activated, STOP and tell the user.**

---

**Design:** `.specs/features/railway-production-deploy/design.md`
**Status:** Approved and ready for execution

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found:
> `README.md`, `package.json`, `vitest.config.ts`, and existing tests under `test/unit` and
> `test/integration`; strong defaults fill requirements not explicitly documented.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Runtime configuration | unit | Every new normalization branch and missing-value behavior | `test/unit/**/*.test.ts` | `npm run test:unit` |
| Fastify authentication and routes | integration | Both protected routes: configured/unconfigured, valid, missing, malformed, wrong, scheme-casing, dependency short-circuit, and log secrecy | `test/integration/**/*.test.ts` | `npm run test:integration` |
| Container and Railway configuration | none | Static contract inspection plus full build gate | `Dockerfile`, `railway.json` | `npm run check` |
| Documentation and external Railway state | none | Build gate plus scoped CLI/HTTP deployment evidence | `README.md`, Railway service | `npm run check` |

## Gate Check Commands

> Generated from the existing TypeScript/Vitest project - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After runtime configuration changes with unit tests | `npm run test:unit` |
| Full | After Fastify integration changes or live HTTP contract checks | `npm test` |
| Build | After phase completion, container/config, docs, or external deployment tasks | `npm run check` |

---

## Execution Plan

Phases are ordered and run sequentially; the six tasks fit one inline execution batch.

### Phase 1: Fail-closed API access

```text
T1 → T2
```

### Phase 2: Reproducible Railway runtime

```text
T2 → T3 → T4 → T5
```

### Phase 3: Production publication

```text
T5 → T6
```

---

## Task Breakdown

### T1: Load the production API access credential ✅

**What:** Extend runtime configuration and application composition with a trimmed, server-only `API_ACCESS_KEY`.
**Where:** `src/config.ts`
**Depends on:** None
**Reuses:** Existing `optionalValue`, `RuntimeConfig`, and `ApplicationConfig` patterns
**Requirement:** RYSEC-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `API_ACCESS_KEY` is trimmed and exposed only as `apiAccessKey` in runtime/application configuration.
- [x] Blank values remain absent and cannot accidentally become a valid credential.
- [x] `.env.example` documents a placeholder without a real secret.
- [x] Configuration unit tests cover configured and blank access keys.
- [x] `npm run test:unit` passes with 53 tests and no silent test deletions.

**Tests:** unit
**Gate:** quick
**Commit:** `feat(config): load api access credential`

### T2: Protect transcript-producing routes with Bearer authentication

**What:** Add fail-closed Bearer authentication before both transcript routes while leaving health public.
**Where:** `src/http/app.ts`
**Depends on:** T1
**Reuses:** Fastify hooks, structured error envelopes, dependency-injected integration tests
**Requirement:** RYSEC-01, RYSEC-02, RYSEC-03, RYSEC-04, RYSEC-05, RYSEC-07, RYSEC-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `/health` remains public and dependency-free.
- [ ] Both transcript routes return exact 503/401 error envelopes for missing configuration or invalid authentication before dependency work.
- [ ] Exact tokens and case-insensitive Bearer schemes continue into existing route validation and success behavior.
- [ ] Empty, extra-material, malformed, and wrong credentials are rejected.
- [ ] Logs and responses contain no configured credential or authorization header.
- [ ] Integration tests cover every authentication acceptance criterion and edge case on both protected routes.
- [ ] `npm test` passes with no silent test deletions.

**Tests:** integration
**Gate:** full
**Commit:** `feat(api): protect transcript routes`

### T3: Make the container health check use Railway's runtime port

**What:** Change the Docker health probe to read `PORT` at runtime with the existing local fallback.
**Where:** `Dockerfile`
**Depends on:** T2
**Reuses:** Existing dependency-free `/health` route and Node runtime
**Requirement:** RYDEP-01, RYDEP-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`, `use-railway`

**Done when**:

- [ ] The health command targets `process.env.PORT` and falls back to 3000 only when absent.
- [ ] Node.js 22, FFmpeg, pinned `yt-dlp`, non-root execution, and compiled entrypoint remain unchanged.
- [ ] `npm run check` passes.

**Tests:** none - container files use the build gate per matrix
**Gate:** build
**Commit:** `fix(container): probe the runtime port`

### T4: Define the Railway service deployment contract

**What:** Add checked-in Railway build, health, timeout, and restart configuration.
**Where:** `railway.json`
**Depends on:** T3
**Reuses:** Existing Dockerfile and public `/health` route
**Requirement:** RYDEP-01, RYDEP-03

**Tools**:

- MCP: Railway CLI
- Skill: `tlc-spec-driven`, `use-railway`

**Done when**:

- [ ] Railway selects the Dockerfile builder and repository Dockerfile.
- [ ] Railway probes `/health` with a 300-second deployment timeout.
- [ ] Failed processes use a bounded `ON_FAILURE` restart policy.
- [ ] `npm run check` passes.

**Tests:** none - Railway configuration uses the build gate per matrix
**Gate:** build
**Commit:** `chore(railway): define service deployment`

### T5: Document authenticated local and Railway operation

**What:** Update operator documentation and curl examples for access-key authentication and Railway limitations.
**Where:** `README.md`
**Depends on:** T4
**Reuses:** Existing setup, route, privacy, Docker, and limitation documentation
**Requirement:** RYSEC-03, RYDEP-04, RYDEP-06, RYDEP-07, RYDEP-09

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`, `use-railway`

**Done when**:

- [ ] Configuration lists `API_ACCESS_KEY` and explains fail-closed protected routes.
- [ ] JSON and PDF curl examples use a Bearer token without embedding a real secret.
- [ ] Railway deployment, variable, domain, and verification behavior is documented.
- [ ] Synchronous timeout, YouTube datacenter blocking, and later hardening tasks remain explicit.
- [ ] `npm run check` passes.

**Tests:** none - documentation uses the build gate per matrix
**Gate:** build
**Commit:** `docs(api): document authenticated railway use`

### T6: Deploy and verify the public Railway service

**What:** Provision/link the Railway service, set sealed credentials, deploy, generate a domain, and verify its public contract.
**Where:** `.specs/features/railway-production-deploy/validation.md`
**Depends on:** T5
**Reuses:** Root `.env` OpenCode credential, `railway.json`, Dockerfile, and authenticated route contract
**Requirement:** RYDEP-04, RYDEP-05, RYDEP-06, RYDEP-07, RYDEP-08, RYDEP-09

**Tools**:

- MCP: Railway CLI
- Skill: `tlc-spec-driven`, `use-railway`

**Done when**:

- [ ] The service variables contain non-empty `OPENCODE_API_KEY` and a generated high-entropy `API_ACCESS_KEY` without values in evidence.
- [ ] The scoped Railway deployment reaches terminal `SUCCESS`.
- [ ] A Railway-provided public domain is active.
- [ ] Public health returns exact HTTP 200 and unauthenticated transcript returns exact HTTP 401.
- [ ] Authenticated caption JSON returns HTTP 200 with the unified contract without capturing transcript text.
- [ ] Authenticated PDF returns HTTP 200, `application/pdf`, and the PDF signature without retaining its payload.
- [ ] `npm run check` passes before independent verification.

**Tests:** none - external deployment state uses scoped CLI/HTTP evidence and the build gate per matrix
**Gate:** build
**Commit:** `chore(railway): record production deployment`

---

## Phase Execution Map

```text
Phase 1 → Phase 2 → Phase 3

Phase 1: T1 → T2
Phase 2: T3 → T4 → T5
Phase 3: T6
```

Execution is strictly sequential. Cross-phase dependencies are carried by the last task of the
previous phase and the first task of the next phase.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | One runtime configuration concept | ✅ Granular |
| T2 | One HTTP authentication boundary | ✅ Granular |
| T3 | One container health correction | ✅ Granular |
| T4 | One Railway service configuration | ✅ Granular |
| T5 | One operator-documentation update | ✅ Granular |
| T6 | One production deployment operation | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | Phase 1 start | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | Phase 1 → Phase 2, T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | Phase 2 → Phase 3, T5 → T6 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Runtime configuration | unit | unit | ✅ OK |
| T2 | Fastify authentication/routes | integration | integration | ✅ OK |
| T3 | Container configuration | none | none | ✅ OK |
| T4 | Railway configuration | none | none | ✅ OK |
| T5 | Documentation | none | none | ✅ OK |
| T6 | External Railway state/evidence | none | none | ✅ OK |
