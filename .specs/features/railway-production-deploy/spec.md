# Railway Production Deploy Specification

## Problem Statement

The transcript API is ready locally, but exposing its synchronous YouTube and Muse processing on a
public Railway domain without access control would let unknown callers consume CPU, bandwidth, and
the owner's OpenCode Go quota. The service needs a secure deployment contract, protected transcript
routes, Railway health checks, sealed provider credentials, and reproducible operational evidence.

## Goals

- [ ] Protect every transcript-producing endpoint with one server-managed Bearer token.
- [ ] Package the container and service configuration for Railway's dynamic runtime port.
- [ ] Deploy the service with sealed OpenCode and API access credentials.
- [ ] Verify health, authentication, JSON, and PDF behavior through the public Railway domain.
- [ ] Record separately prioritized production-hardening tasks discovered during the audit.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Multi-user accounts and token issuance | A single owner-managed access token is sufficient for this private API. |
| Durable asynchronous jobs | It changes the synchronous HTTP contract and is tracked as a hardening task. |
| Transcript persistence and RAG ingestion | The current service returns source artifacts; storage belongs to a later feature. |
| Private or restricted YouTube videos | The service continues to process public videos without cookies. |
| Custom domain | A Railway-provided domain is sufficient for the first production deployment. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Public exposure | Use a Railway-provided public domain | The user explicitly requested deployment and needs an externally callable API. | yes |
| API authentication | Require `Authorization: Bearer <API_ACCESS_KEY>` on both transcript endpoints | This prevents an open endpoint from consuming the owner's Muse quota. | no, safe security default |
| Health endpoint | Keep `GET /health` public and dependency-free | Railway must probe it without application credentials. | no, platform-safe default |
| Missing access key | Return HTTP 503 from protected routes instead of starting unprotected | Configuration mistakes must fail closed while preserving health diagnostics. | no, safe security default |
| Secret storage | Store `OPENCODE_API_KEY` and `API_ACCESS_KEY` as Railway service variables | Secrets remain outside Git, image layers, request bodies, and logs. | yes |
| Access key generation | Generate a high-entropy key for Railway without printing it in command output | Avoids committing or disclosing a reusable production credential. | no, safe security default |
| Deployment region and replicas | Keep Railway defaults and one service instance | The initial workload and preferred region were not specified. | no, reversible default |
| Provider verification | Exercise a captioned public video during smoke testing; do not intentionally spend Muse quota unless captions are absent | Verifies the deployed HTTP/media image while minimizing subscription use. | no, bounded default |

**Open questions:** none blocking; all unconfirmed choices are safe, reversible defaults.

---

## User Stories

### P1: Call the production API without exposing subscription quota ⭐ MVP

**User Story**: As the API owner, I want transcript generation protected by an access key so that
only my RAG workflow can trigger YouTube processing and Muse usage.

**Why P1**: Public unauthenticated routes create immediate cost and resource-abuse risk.

**Acceptance Criteria**:

1. **RYSEC-01** WHEN a client calls `GET /health` without credentials THEN the system SHALL return HTTP 200 with `{ "status": "ok" }` and SHALL not call transcript or PDF dependencies.
2. **RYSEC-02** WHEN a client calls either transcript endpoint without a Bearer token, with a malformed authorization header, or with an incorrect token THEN the system SHALL return HTTP 401 with error code `UNAUTHORIZED` and SHALL not call transcript or PDF dependencies.
3. **RYSEC-03** WHEN a client calls either transcript endpoint with the exact configured Bearer token THEN the system SHALL continue through the existing request validation and transcript/PDF behavior.
4. **RYSEC-04** IF `API_ACCESS_KEY` is not configured THEN either transcript endpoint SHALL return HTTP 503 with error code `API_AUTH_NOT_CONFIGURED` and SHALL not start provider, media, or PDF work.
5. **RYSEC-05** WHEN authentication fails or succeeds THEN the system SHALL not serialize the configured token, authorization header, OpenCode credential, transcript text, audio, or PDF bytes to application logs or responses.
6. **RYSEC-06** WHEN runtime configuration is loaded THEN `API_ACCESS_KEY` SHALL be trimmed like other secrets and SHALL be passed through application wiring without being accepted from an HTTP body.

**Independent Test**: Use Fastify injection with fake transcript/PDF dependencies to exercise public
health, missing configuration, missing/malformed/wrong credentials, valid credentials, and log
redaction without network or subprocess access.

---

### P1: Run the container as a healthy Railway service ⭐ MVP

**User Story**: As the operator, I want a repeatable Railway deployment so that the API remains
reachable and restarts predictably after failures.

**Why P1**: A locally working container is not sufficient evidence of a healthy hosted service.

**Acceptance Criteria**:

1. **RYDEP-01** WHEN Railway builds the repository THEN it SHALL use the checked-in Dockerfile containing Node.js 22, FFmpeg, the pinned `yt-dlp`, and the compiled API.
2. **RYDEP-02** WHEN Railway supplies its runtime `PORT` THEN the Fastify listener and container health check SHALL target that port instead of assuming port 3000.
3. **RYDEP-03** WHEN the service is configured THEN Railway SHALL probe `/health`, wait up to 300 seconds for deployment health, and restart failed processes under a bounded on-failure policy.
4. **RYDEP-04** BEFORE the public transcript routes are verified THEN the Railway service SHALL contain non-empty `OPENCODE_API_KEY` and `API_ACCESS_KEY` variables without either value appearing in committed files or captured deployment evidence.
5. **RYDEP-05** WHEN deployment completes THEN Railway SHALL report terminal `SUCCESS` for the scoped service and environment before the deployment is described as successful.
6. **RYDEP-06** WHEN a Railway-provided domain is generated THEN public smoke tests SHALL prove health is unauthenticated, transcript routes reject missing credentials, and an authenticated captioned-video JSON request succeeds.
7. **RYDEP-07** WHEN the authenticated PDF endpoint is smoke-tested for the same video THEN it SHALL return HTTP 200, `application/pdf`, and a payload beginning with the PDF signature.

**Independent Test**: Inspect the scoped Railway deployment/configuration with the CLI and run
bounded HTTP smoke tests against the generated domain without printing credentials or response
transcript content.

---

## Edge Cases

- **RYSEC-07** IF the authorization scheme has different casing (`bearer`) but the exact token THEN the system SHALL accept it because HTTP authentication schemes are case-insensitive.
- **RYSEC-08** IF the Bearer token is empty or contains extra whitespace/token material THEN the system SHALL return `UNAUTHORIZED`.
- **RYDEP-08** IF a deployment fails or remains non-terminal THEN the system SHALL inspect bounded build/runtime logs and SHALL not report success.
- **RYDEP-09** IF YouTube blocks the Railway datacenter request THEN deployment health/authentication SHALL be reported separately from the failed provider smoke test.

---

## Requirement Traceability

| Requirement ID | Story | Planned task | Status |
| -------------- | ----- | ------------ | ------ |
| RYSEC-01 | Protected production API | T2 | Planned |
| RYSEC-02 | Protected production API | T2 | Planned |
| RYSEC-03 | Protected production API | T2 | Planned |
| RYSEC-04 | Protected production API | T2 | Planned |
| RYSEC-05 | Protected production API | T2 | Planned |
| RYSEC-06 | Protected production API | T1 | Planned |
| RYSEC-07 | Edge case | T2 | Planned |
| RYSEC-08 | Edge case | T2 | Planned |
| RYDEP-01 | Railway service | T3, T4 | Planned |
| RYDEP-02 | Railway service | T3 | Planned |
| RYDEP-03 | Railway service | T4 | Planned |
| RYDEP-04 | Railway service | T6 | Planned |
| RYDEP-05 | Railway service | T6 | Planned |
| RYDEP-06 | Railway service | T6 | Planned |
| RYDEP-07 | Railway service | T6 | Planned |
| RYDEP-08 | Edge case | T6 | Planned |
| RYDEP-09 | Edge case | T6 | Planned |

**Coverage:** 17 total, 17 mapped to planned tasks, 0 unmapped.

---

## Success Criteria

- [ ] `npm run check` passes with unit and integration coverage for authentication.
- [ ] No production secret is added to Git or emitted in command output.
- [ ] Railway reports a terminal successful deployment and healthy service.
- [ ] The public domain passes health, unauthorized, authenticated JSON, and authenticated PDF smoke tests.
- [ ] Production hardening findings exist as prioritized, acceptance-testable backlog tasks.
