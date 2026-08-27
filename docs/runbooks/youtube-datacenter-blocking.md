# Diagnosing YouTube datacenter blocking

This runbook separates a platform failure from a refusal by YouTube or another provider. It does
not create a diagnostic transcription, print video content, or change configuration. Use only the
shown placeholders and preserve the time and output limits.

Read-only evidence when this runbook was created on August 26, 2026: the active service deployment
was `SUCCESS/RUNNING`, with one replica and a health check at `/health`. That record does not replace
the current checks below.

## 1. Platform, liveness, readiness, and authentication

Confirm context, deployment, and all three HTTP boundaries first. Do not continue if liveness or
readiness fails. These commands return only state, HTTP status, and limited operational metadata.

```bash
timeout 20s railway status --json | head -c 32768
timeout 20s railway deployment list --service <SERVICE> --limit 3 --json | head -c 32768
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://<API_HOST>/health
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://<API_HOST>/ready
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' -X POST -H 'authorization: Bearer <API_ACCESS_KEY>' -H 'content-type: application/json' --data '{"url":"https://www.youtube.com/watch?v=<VIDEO_ID>"}' https://<API_HOST>/v1/transcripts
```

Interpretation:

- `/health` other than 200, or a deployment outside `SUCCESS/RUNNING`: a platform or process
  problem, not yet evidence of YouTube blocking.
- `/ready` at 503 with `not_ready`: the process is shutting down; wait for a healthy deployment.
- `UNAUTHORIZED`: the client credential is missing or incorrect.
- `API_AUTH_NOT_CONFIGURED`: the service credential is missing.
- HTTP 429 with `TRANSCRIPT_CAPACITY_EXCEEDED`: capacity is full. Honor `Retry-After`.

The POST discards its body to avoid printing a transcription. Inspect only sanitized codes in the
logs during the following steps.

## 2. Caption retrieval

Filter a short time window by code. The application logger records code and status, not a URL,
language, video ID, text, or provider response.

```bash
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'CAPTIONS_UNAVAILABLE OR VIDEO_NOT_AVAILABLE OR YOUTUBE_UPSTREAM_ERROR' --json | head -c 32768
```

Interpretation:

- `VIDEO_NOT_AVAILABLE`: the video is not publicly available to the application.
- `CAPTIONS_UNAVAILABLE`: no usable captions were found; the audio fallback can start.
- `YOUTUBE_UPSTREAM_ERROR`: caption lookup failed unexpectedly. The application does not enter the
  fallback in this case.

When the deployment and `/health` are healthy, these codes keep a YouTube failure separate from
Railway health.

## 3. Audio download with yt-dlp

Run only a silent simulation for the same public video. The command prints only the exit code and
discards stdout and stderr without saving audio, cookies, a page, or a YouTube response.

```bash
timeout 30s railway ssh --service <SERVICE> -- "timeout 20s sh -c 'yt-dlp --simulate --no-playlist --quiet --no-warnings \"https://www.youtube.com/watch?v=<VIDEO_ID>\" >/dev/null 2>/dev/null; printf \"yt_dlp_exit=%s\\n\" \"\$?\"'" | head -c 4096
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'AUDIO_TOOL_UNAVAILABLE OR AUDIO_EXTRACTION_FAILED OR AUDIO_PROCESS_TIMEOUT' --json | head -c 32768
```

Interpretation:

- `AUDIO_TOOL_UNAVAILABLE`: the executable did not start; inspect the image, not YouTube.
- `AUDIO_EXTRACTION_FAILED`: the process started, but download or processing failed.
- `AUDIO_PROCESS_TIMEOUT`: yt-dlp or FFmpeg exceeded its configured limit.
- `AUDIO_PROCESS_ABORTED`: shutdown or cancellation stopped the process.

A non-zero exit code with healthy Railway services indicates public access failure from the egress
or a YouTube change. It does not authorize trying another identity or network origin.

## 4. Conversion with FFmpeg

Confirm only that the image binary starts. Do not read or produce media during diagnosis.

```bash
timeout 20s railway ssh --service <SERVICE> -- "timeout 10s ffmpeg -version 2>/dev/null | head -n 1" | head -c 4096
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'AUDIO_TOOL_UNAVAILABLE OR AUDIO_EXTRACTION_FAILED OR AUDIO_PROCESS_TIMEOUT OR AUDIO_PROCESS_ABORTED' --json | head -c 32768
```

If yt-dlp completes and FFmpeg does not start, treat it as an image or tool problem. If both start
and `AUDIO_EXTRACTION_FAILED` appears, preserve the sanitized error and investigate the pinned tool
versions in a non-production environment.

## 5. Transcription with Muse

Check only whether configuration is present, never its value. Then inspect limited codes. Do not
submit test audio or print an OpenCode Go response body.

```bash
timeout 15s railway ssh --service <SERVICE> -- 'timeout 5s sh -c '\''if test -n "$OPENCODE_API_KEY"; then printf "muse_config=configured\n"; else printf "muse_config=missing\n"; fi'\''' | head -c 4096
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'MUSE_AUTHENTICATION_FAILED OR MUSE_QUOTA_EXCEEDED OR MUSE_TIMEOUT OR MUSE_UPSTREAM_UNAVAILABLE OR MUSE_INVALID_RESPONSE' --json | head -c 32768
```

Interpretation:

- `MUSE_AUTHENTICATION_FAILED`: the credential is invalid or unauthorized.
- `MUSE_QUOTA_EXCEEDED`: quota is exhausted; honor the validated `Retry-After`.
- `MUSE_TIMEOUT`: the request exceeded its configured limit.
- `MUSE_UPSTREAM_UNAVAILABLE`: the network or upstream service is unavailable.
- `MUSE_INVALID_RESPONSE`: the response could not be validated.

These codes are Muse/OpenCode Go failures, not evidence of YouTube blocking.

## Support policy and closure

The API supports only public videos available without account state. Cookies, residential proxies, CAPTCHA solving, IP rotation, and restriction bypass are explicitly incompatible with this service and runbook.

During an incident:

- do not reduce or disable Bearer authentication;
- do not increase or remove timeouts;
- do not increase or remove the concurrency limit;
- do not record transcriptions, audio, Base64, tokens, cookies, provider bodies, or real IDs/URLs;
- do not retry Muse calls automatically.

End diagnosis at the first stage proven to have failed. Record only the time, deployment, stage,
HTTP status, sanitized code, and exit code. If the platform is healthy and the YouTube stage fails,
preserve that distinction in the incident instead of weakening controls.
