# Railway Production Deploy Context

**Gathered:** 2026-08-25
**Spec:** `.specs/features/railway-production-deploy/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Protect the two transcript-producing routes, make the existing Docker image Railway-aware, publish
one Railway service with sealed credentials, and prove its externally observable contract. Do not
change the transcript, Muse, or local PDF algorithms.

---

## Implementation Decisions

### Access control

- Use one `API_ACCESS_KEY` server variable and the standard `Authorization: Bearer` header.
- Keep `/health` public; protect `/v1/transcripts` and `/v1/transcripts/pdf`.
- Fail closed with `API_AUTH_NOT_CONFIGURED` when the access key is missing.
- Never accept the access key or OpenCode key from the request body.

### Railway service

- Continue using the checked-in multi-stage Dockerfile because it already installs FFmpeg and a
  pinned `yt-dlp` as a non-root runtime.
- Resolve health checks using Railway's runtime `PORT`.
- Check in `railway.json` with Dockerfile builder, `/health`, a 300-second health timeout, and
  bounded `ON_FAILURE` restarts.
- Use one Railway-provided public domain and platform service variables.

### Verification

- Use the existing Vitest unit and Fastify integration conventions.
- Require terminal Railway `SUCCESS`, then smoke-test public health, unauthorized rejection,
  authenticated JSON, and authenticated PDF.
- Keep secrets and transcript/PDF payloads out of captured evidence.

### Agent's Discretion

- Exact internal helper names for parsing and comparing Bearer credentials.
- The generated production access-key value and Railway project/service identifiers.
- Selection of a stable public captioned video for smoke testing.

### Declined / Undiscussed Gray Areas → Assumptions

- The generated access key is stored only in Railway; the owner can rotate or retrieve it in the
  Railway dashboard.
- Railway's default region and one replica are adequate for the first deployment.
- A custom domain, WAF, and CDN caching are not enabled.

---

## Specific References

- Existing HTTP boundary: `src/http/app.ts`.
- Existing runtime configuration: `src/config.ts` and `src/app.ts`.
- Existing container contract: `Dockerfile`.
- Railway configuration fields verified through `use-railway` reference `configure.md`.

---

## Deferred Ideas

See `.specs/features/railway-production-deploy/improvements.md` for the prioritized production
hardening backlog derived from the repository audit.
