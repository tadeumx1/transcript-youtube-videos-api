# Railway Production Deploy Validation

**Date:** 2026-08-25 (America/Sao_Paulo)
**Status:** Deployment evidence complete; independent TLC verification pending

## Railway Scope

| Resource | Value |
| -------- | ----- |
| Workspace | `Matheus Tadeu's Projects` |
| Project | `transcript-youtube-videos-api` (`cf42a201-0f75-4029-af45-222b3b8f3f27`) |
| Environment | `production` (`969aaf93-84e0-4479-9a17-71d59d1c0752`) |
| Service | `transcript-youtube-videos-api` (`bdcca9c0-aa9e-4e54-b0a8-0836a6dc076e`) |
| Final deployment | `b30f931e-3f97-4f1b-a635-f46db5512d86` |
| Public domain | `https://transcript-youtube-videos-api-production.up.railway.app` |

## Deployment Contract

- Final deployment reached terminal `SUCCESS`.
- Deployment manifest reported builder `DOCKERFILE`, path `Dockerfile`, health path `/health`,
  timeout 300, restart policy `ON_FAILURE`, and maximum 10 retries.
- The current `.railway/railway.ts` plan reports `No changes.`, zero diagnostics, and preserves both
  production variables without embedding their values.
- `OPENCODE_API_KEY` and `API_ACCESS_KEY` were both confirmed non-empty through a boolean-only CLI
  projection. Their values were not captured.
- The generated access key's mode-600 temporary local file was deleted after smoke testing. The
  Railway service variable remains the production copy.

## Public Smoke Tests

| Contract | Result | Evidence |
| -------- | ------ | -------- |
| Public health | PASS | `GET /health` returned HTTP 200 and `{ "status": "ok" }`. |
| Missing credentials | PASS | `POST /v1/transcripts` returned HTTP 401 and `UNAUTHORIZED`. |
| Authenticated JSON | PASS | Public captioned video returned HTTP 200, `youtube_captions`, `pt-BR`, caption precision, 60 segments, and complete non-empty text. Transcript text was not printed. |
| Authenticated PDF | PASS | Same video returned HTTP 200, `application/pdf`, the video-ID attachment name, 3,068 bytes, and `%PDF` signature. PDF bytes were not retained. |

The live caption request succeeded from Railway, so YouTube datacenter blocking did not occur for
this sample. Platform health/authentication and provider behavior remain separate operational signals
if a future video or egress IP is blocked.

## Local Gate

- `npm run check`: PASS.
- Vitest: 10 files, 83 tests passed, 0 failed, 0 skipped.
- Biome, strict TypeScript check, and production build: PASS.
- Production secrets in committed files or validation output: none.
