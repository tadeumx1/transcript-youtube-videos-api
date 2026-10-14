# Run all services locally

This English walkthrough covers first-time setup, starting each service manually, and then using
the existing root [Makefile](../Makefile) to start and manage the applications. Commands use a
Linux, macOS or WSL shell. On Windows, run them inside WSL.

Choose one startup mode per session:

| Mode | Preparation | Start | Browser address |
| --- | --- | --- | --- |
| Manual development, three terminals | Steps 1–3 | [Step 4](#4-start-each-service-manually) | `http://127.0.0.1:5173` with the example settings |
| Makefile development, one terminal | Steps 1–3 | [Step 5](#5-start-all-services-with-make-dev) | The printed `[web] URL:` |
| Makefile Docker, one terminal | Two environment files from step 2, Docker, Make and Python 3 | [Step 6](#6-run-all-applications-with-the-docker-make-targets) | The printed `[docker] URL:` |
| Compiled local applications, two terminals | Steps 1–3 | [Compiled mode](#compiled-mode-two-terminals-no-vite-server) | `http://127.0.0.1:3100` with the example settings |

Docker builds dependencies and model assets inside the images, so it does not need host Node/npm
installation or step 3. See [Run all applications with Docker](docker.md) for its complete reference.
Neither local mode requires Railway. YouTube access requires internet, and audio fallback and
library enrichment still use OpenCode credentials and quota. Local RAG uses the downloaded model.

Run these commands from the repository root. After the setup below, **`make dev` starts all three
development processes in one terminal**, with labeled logs and shared shutdown.
The transcript API also hosts its job worker and local RAG engine.
The library API hosts the daily channel collector and enrichment worker. Neither needs a separate
queue service or database server.

| Process | Preferred development address | Individual start command from the repository root |
| --- | --- | --- |
| Transcript API, job worker and RAG | http://127.0.0.1:3000 | `npm run dev` |
| Channel library API and worker | http://127.0.0.1:3100 | `npm run library:dev:api` |
| React/Vite reader | http://127.0.0.1:5173 | `npm --prefix services/channel-library run dev:web -- --port 5173 --strictPort` |

With `make dev`, use the **selected URLs** printed in the terminal. The launcher checks each
preferred port and uses the **next available port** if another local application occupies it.
It keeps the library's `TRANSCRIPT_API_URL` and Vite's `/api` proxy aligned with the selected APIs.
Individual commands retain the defaults above; the library API serves the reader itself on
port **3100** after a production build.

## 1. Prerequisites and installation

Open a terminal and enter your checkout. On the owner's current machine:

```sh
cd /home/matheus/transcript-youtube-videos-api
```

On another machine, replace that path with your checkout directory. Use this same working
directory in every terminal below. The relative `docs`, `services` and `scripts` paths start here.

- Node.js **22.12 or newer** and npm (the shared minimum includes Vite's requirement).
- Python 3, a C/C++ build toolchain and make for npm's native-addon build step. On Debian/Ubuntu,
  install them with `sudo apt-get install build-essential python3`.
- `yt-dlp` and FFmpeg on PATH for videos that require audio fallback. See the
  [yt-dlp installation guide](https://github.com/yt-dlp/yt-dlp#installation) and
  [FFmpeg downloads](https://ffmpeg.org/download.html).
- An OpenCode Go key for enrichment/audio fallback. YouTube discovery can use public feeds without a key
  with `YOUTUBE_DISCOVERY_MODE=rss`. An optional Data API key enables paginated discovery; see Google's
  [getting started guide](https://developers.google.com/youtube/v3/getting-started).

```sh
node --version
npm --version
python3 --version
make --version
yt-dlp --version
ffmpeg -version
```

Resolve any missing prerequisites before continuing. Install the two locked dependency trees:

```sh
npm ci
npm --prefix services/channel-library ci
```

Install both dependency trees: the library has its own package manifest and lockfile.

On a supported platform without a compiler, the library's locked better-sqlite3 package includes
prebuilt binaries. You can install that package tree without lifecycle scripts and verify the
actual SQLite binding before continuing:

```sh
npm --prefix services/channel-library ci --ignore-scripts
node --input-type=module <<'NODE'
import Database from './services/channel-library/node_modules/better-sqlite3/lib/index.js'
import assert from 'node:assert/strict'
const db = new Database(':memory:')
assert.deepEqual(db.prepare('SELECT 1 AS ok').get(), { ok: 1 })
db.close()
console.log('Library SQLite binding loaded.')
NODE
```

This alternative skips all lifecycle scripts in the library install. If the binding check or
subsequent library build fails on your platform, install the build prerequisites and use ordinary
`npm ci` instead. Keep the root install as ordinary `npm ci`.

If media tools are installed elsewhere, set `YT_DLP_PATH` and `FFMPEG_PATH` in the root `.env`.
The existing root Dockerfile packages only the transcript API, not the library or reader.

## 2. Configure the two environment files

Create the files only if they do not already exist; preserve any existing credentials:

```sh
[ -f .env ] || cp .env.example .env
[ -f services/channel-library/.env ] || cp services/channel-library/.env.example services/channel-library/.env
```

Open each file in your editor (for example, `nano .env` followed by
`nano services/channel-library/.env`). Preserve the other example settings.

Edit the **root `.env`**:

```dotenv
HOST=127.0.0.1
PORT=3000
API_ACCESS_KEY=replace-with-a-long-random-transcript-token
OPENCODE_API_KEY=replace-with-your-opencode-go-key
```

Edit **`services/channel-library/.env`**:

```dotenv
LIBRARY_HOST=127.0.0.1
LIBRARY_PORT=3100
LIBRARY_ACCESS_KEY=replace-with-a-different-long-random-library-token
TRANSCRIPT_API_URL=http://127.0.0.1:3000
TRANSCRIPT_API_KEY=replace-with-the-exact-root-API_ACCESS_KEY-value
YOUTUBE_DISCOVERY_MODE=rss
YOUTUBE_API_KEY=
OPENCODE_API_KEY=replace-with-your-opencode-go-key
LLM_BASE_URL=https://opencode.ai/zen/go/v1
LLM_API_STYLE=chat_completions
LLM_MODEL=glm-5.3-flash
LIBRARY_TIME_ZONE=America/Sao_Paulo
LIBRARY_DAILY_HOUR=6
```

Replace the non-empty placeholder values above; `YOUTUBE_API_KEY` may remain empty in RSS mode.
Generate one token for `API_ACCESS_KEY`, then run the command again for `LIBRARY_ACCESS_KEY`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For Docker-only setup without host Node, generate each token with Python instead:

```sh
python3 -c 'import secrets; print(secrets.token_hex(32))'
```

Copy the root `API_ACCESS_KEY` value into the library's `TRANSCRIPT_API_KEY`; only
`LIBRARY_ACCESS_KEY` goes into the web access screen. The OpenCode key can be the same in both
files, but must be configured in both because the library does not load the root `.env`.

Keep credentials out of `VITE_*` variables and source control. The npm start scripts load each
service's environment file from its own working directory. Already exported shell variables take
precedence over values in those files; unset stale exported values if a change appears ignored.
See the [library configuration reference](../services/channel-library/README.md#configuration)
for supported LLM protocols and the [root configuration reference](../README.md#configuration)
for all transcript/RAG options.

## 3. Prepare the local RAG model

The RAG engine runs inside the transcript API. Fetch its pinned, checksum-verified E5 model once:

```sh
npm run build
npm run rag:model:fetch
```

This downloads model assets into `.models`; it does not call a paid LLM. Runtime inference is local.
The fetch script does not load `.env` itself. If you chose a custom `RAG_MODEL_ROOT`, supply that
same path explicitly when fetching, for example:

```sh
RAG_MODEL_ROOT=/absolute/path/to/models npm run rag:model:fetch
```

A missing model can leave `/health` at 200 while `/ready` returns 503 and RAG remains unavailable.
Do not delete stored RAG data to fix a missing model; first fetch the verified artifacts and check
the configured path. The current model, embedding fingerprint and `v2` storage namespace are unchanged.

## 4. Start each service manually

Complete steps 1–3 first. Open three terminals in the repository root. Each start command stays
running; leave that terminal open and use the next terminal for the next service.
These commands use the ports configured in step 2 and do not select alternate API ports.

In **terminal 1**, start the transcript API, including its job worker and RAG engine:

```sh
npm run dev
```

In **terminal 2**, check the first service before starting the library API and its workers:

```sh
curl --fail --silent --show-error http://127.0.0.1:3000/health
curl --fail --silent --show-error http://127.0.0.1:3000/ready
npm run library:dev:api
```

Expect `{"status":"ok"}` and, after model initialization, `{"status":"ready"}`. If either command
fails, resolve it before starting the next service; a 503 from `/ready` can indicate a missing
model or unavailable storage.

In **terminal 3**, check the library API and start the reader:

```sh
curl --fail --silent --show-error http://127.0.0.1:3100/health
npm --prefix services/channel-library run dev:web -- --port 5173 --strictPort
```

Expect `{"status":"ok"}` from the library. Open **http://127.0.0.1:5173** and enter the value of
`LIBRARY_ACCESS_KEY` from `services/channel-library/.env` in the browser's **Access key** field.
Use **Add video** to import one public YouTube video URL, or **Channels** to follow a public
channel. Imports invoke the providers; health checks do not. The APIs must stay running while
videos are processed, and the library API must stay running for scheduled channel collection.

To stop this mode, press **Ctrl+C in all three terminals**. Stop it before trying `make dev`,
because both host workflows use the same saved data. For changed ports, update the library's
`TRANSCRIPT_API_URL`; start Vite with `LIBRARY_PROXY_TARGET=http://127.0.0.1:<library-port>` and
the desired `--port`. The next section automates these connections.

## 5. Start all services with make dev

After completing steps 1–3, run this from the repository root on Linux, macOS or WSL:

```sh
make dev
```

The API preferences come from `PORT` in the root `.env` and `LIBRARY_PORT` in the library's `.env`,
defaulting to 3000 and 3100. The reader defaults to 5173; set `WEB_PORT` in the root `.env` to
change its preference. Exported shell values take precedence, for example:

```sh
PORT=4000 LIBRARY_PORT=4100 WEB_PORT=5200 make dev
```

Each search considers at most 100 consecutive ports, including the preferred one, and stops at
65535. The selected ports are distinct. Invalid configuration or an exhausted search exits
nonzero before launching applications. The checks use the configured API hosts; wildcard bind
addresses are converted to loopback addresses in the local connection URLs.

The launcher prints a `URL:` line for each application and reports every changed port. Open the
reader at the `[web] URL:` shown for that session. Port and connection overrides are temporary:
the launcher **does not modify** either `.env` file or stop applications occupying those ports.
For the combined session, the library always points to the transcript API launched with it.
Vite receives the selected library origin in its server-only `LIBRARY_PROXY_TARGET` environment
variable. Individual Vite commands still default to `http://127.0.0.1:3100` unless that variable
is exported explicitly.

The terminal shows interleaved stdout and stderr with `[transcript]`, `[library]` and `[web]`
labels. Each command reports its PID when started and its exit code or signal when it stops.

The library also logs API method, route template, HTTP status and duration, plus processing
stage start/success/failure events. Failures include the error code, retry decision and provider
HTTP status when available; tokens, request bodies and transcript text are omitted.

An HTTP `GET 200` only means the reader fetched saved state. It does not mean the LLM
completed. The processing flow is:

```text
web -> library: admit a video or read its saved status
library -> transcript: submit_job -> poll_job -> fetch_transcript
library -> local storage: save or reuse the original transcript
library -> llm: correct_chunk (part 1/N, then 2/N, ...)
library -> llm: reduce_summaries when multiple chunks need combining
library -> local storage: save corrected text, summary and key points; status ready
```

`stage=upstream` logs each call's `from`, `to`, `operation`, start, received headers,
completion or failure. While a call is pending, a heartbeat every 15 seconds reports
`phase=response_headers` or `phase=response_body`, `elapsedMs`, `remainingMs` and `timeoutMs`.
This reports what the local HTTP client is waiting for, not a percentage or access to the
provider's internal processing. `headers_received` with HTTP 200 alone is not completed output.
Chunk events report `part`, `parts`, input character count, and whether the result was saved
or reused. A terminal processing event reports `status`; failures include `retryInMs`.
GET request logs use `operation=read_saved_state` to distinguish browser polling from work.

For GLM 5.3 chat-completion models, editorial requests ask for low reasoning effort and JSON output.
OpenCode requests use `reasoning: { effort: "low" }`; direct endpoints use `reasoning_effort=low`.
The native field was rejected by an OpenCode upstream route during a live integration check.
The [GLM 5.3 reference](https://docs.z.ai/guides/llm/glm-5.3) documents a `max` default,
and [GLM 5.3 Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash) shares those text parameters.
Other model families and the Responses protocol retain their existing parameters. This lowers
the requested reasoning effort but does not guarantee provider latency or eliminate retries.

If no activity appears in your terminal, confirm that the browser uses that terminal's `[web] URL:`.
Another `make dev` session can be serving an older browser tab on a different port. Stop the old
session with Ctrl+C instead of running two workers against the same library data directory.

The OpenCode adapter sends this application's user agent and a stable, opaque
`x-opencode-session` per video, as required by the [provider's client documentation](https://opencode.ai/docs/go/#where-can-i-use-it).
An HTTP 400 rejection is reported as `PROVIDER_REQUEST_REJECTED`, with its upstream status in
server logs, rather than a generic connection failure. No session environment variable is needed.
For slow full-transcript responses, `LLM_TIMEOUT_MS` in the library environment controls the
per-request timeout (default 120000 ms; allowed 1000–900000). For example, set
`LLM_TIMEOUT_MS=300000` for five minutes and restart the library. Saved transcript chunks survive
retries, so already completed work is reused.

A "started" line confirms a process launch; use the health checks below to verify readiness.
The existing npm commands retain their environment files, working directories and watch behavior.

Press **Ctrl+C once** to stop the whole session. The launcher sends SIGTERM to its process groups,
waits up to ten seconds, and force-stops any remaining descendants. If a command cannot start or
exits unexpectedly (including exit code 0), the launcher identifies it, stops the other groups,
and `make dev` exits nonzero. A development watcher may remain alive after an application error;
check its labeled logs and the HTTP health endpoints in that case.

The command requires Node.js, npm and make, plus the setup above. It does not install dependencies,
download models or overwrite configuration. If make is unavailable, install it using your OS
package manager, or run the same launcher directly with `node scripts/dev.mjs`.

Port checks happen before application startup. If another application takes a selected port
between the check and the actual bind, inspect the startup logs and restart `make dev` to select
again. Vite keeps `--strictPort` for the chosen port so it cannot silently invalidate the printed
URL. Multiple instances of this library still require separate data directories; changing ports
does not make concurrent writers to the same SQLite database supported.

Wait for the APIs to announce that they are listening. Open the printed `[web] URL:` and enter
`LIBRARY_ACCESS_KEY`. Add a public channel URL such as `https://www.youtube.com/@CHANNEL_HANDLE`.
The first collection imports up to ten recent videos; subsequent collections run daily at 06:00
in America/Sao_Paulo by default. The library API process must stay running for scheduled work.
Closing the browser leaves collection running; stopping the API does not.

A registered video proceeds through transcription and enrichment before its summary, key points
and corrected text are ready. Original text stays readable if enrichment fails. Live imports use
provider quotas; the health/auth checks below do not import a channel or call an LLM.

## 6. Run all applications with the Docker make targets

Configure the two environment files in step 2 first. This mode needs Make, Python 3 and a working
Docker engine with Compose v2.24 or newer. It builds Node, native/media dependencies and model
assets inside the images; skip host npm installation and model downloads when using only Docker.
On WSL, enable Docker integration and check engine permissions as described in the
[Docker prerequisites](docker.md#wsl-prerequisites).

In **terminal 1**, at the repository root, verify the tools:

```sh
make --version
python3 --version
docker version
docker compose version
```

`docker version` must report both Client and Server. Then start the complete stack:

```sh
make docker-up
```

Wait for the builds and health checks, then open the printed `[docker] URL: http://127.0.0.1:<port>`.
Enter `LIBRARY_ACCESS_KEY` in the browser. The command continues streaming logs; keep its terminal
open. The frontend publishes one loopback port, while both APIs remain inside the Docker network.
The host `curl` commands for ports 3000 and 3100 do not check these containers.

In **terminal 2**, at the same repository root, inspect the running stack:

```sh
make docker-status
make docker-logs
```

Status reports container health and the published address. Logs show the last 200 lines.
Stop the stack with Ctrl+C in terminal 1, or from terminal 2:

```sh
make docker-down
```

Containers are stopped/removed and saved volumes remain. After the previous session exits,
restart with `make docker-up`. To choose a fixed browser port for the next session:

```sh
DOCKER_WEB_PORT=8085 make docker-up
```

Open **http://127.0.0.1:8085**. Unlike `make dev`, an explicitly requested occupied Docker port
fails rather than advancing to another port. Omit `DOCKER_WEB_PORT` for automatic allocation.

The existing Makefile exposes exactly these targets:

| Target | Launcher | Purpose |
| --- | --- | --- |
| `make dev` | `node scripts/dev.mjs` | Start all three host development processes and follow logs. |
| `make docker-up` | `python3 scripts/docker.py up` | Build/start all three containers, wait for health, print URL and follow logs. |
| `make docker-status` | `python3 scripts/docker.py status` | Show this Compose project's containers and ports. |
| `make docker-logs` | `python3 scripts/docker.py logs` | Show the most recent container logs. |
| `make docker-down` | `python3 scripts/docker.py down` | Stop/remove this Compose project's containers while retaining volumes. |

There is no `make stop` or `make restart` target. Host development stops with Ctrl+C; Docker
restarts with `make docker-down` followed by `make docker-up`. You can run the listed launcher
commands directly if Make is unavailable. Docker and host modes keep separate data stores;
see [Docker backup and restore](docker.md#data-backup-and-restore) before moving saved readings.

## Verify the running services

Run this from another terminal at the repository root after both APIs and Vite are listening.
It reads the library owner key from its environment file, never prints it, and asserts both health
responses, the real reader page, and authenticated/unauthenticated requests through the Vite proxy:

Set these variables to the selected URLs printed by `make dev`; the example uses the defaults.

```sh
export TRANSCRIPT_ORIGIN=http://127.0.0.1:3000
export LIBRARY_ORIGIN=http://127.0.0.1:3100
export READER_ORIGIN=http://127.0.0.1:5173
node --env-file-if-exists=services/channel-library/.env --input-type=module <<'NODE'
import assert from 'node:assert/strict'
const key = process.env.LIBRARY_ACCESS_KEY
assert.ok(key, 'Configure LIBRARY_ACCESS_KEY before the smoke check')
for (const origin of [process.env.TRANSCRIPT_ORIGIN, process.env.LIBRARY_ORIGIN]) {
  const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
}
const reader = await fetch(process.env.READER_ORIGIN, { signal: AbortSignal.timeout(10000) })
assert.equal(reader.status, 200)
assert.match(await reader.text(), /<div id="root"><\/div>/)
const url = `${process.env.READER_ORIGIN}/api/v1/channels`
const denied = await fetch(url, { signal: AbortSignal.timeout(10000) })
assert.equal(denied.status, 401)
assert.equal((await denied.json()).error.code, 'UNAUTHORIZED')
const allowed = await fetch(url, {
  headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
})
assert.equal(allowed.status, 200)
assert.ok(Array.isArray((await allowed.json()).items))
console.log('Both APIs, the reader and authenticated Vite proxy passed.')
NODE
```

Then check full transcript/RAG readiness separately after model initialization:

```sh
curl --fail --silent --show-error "$TRANSCRIPT_ORIGIN/ready"
```

Expected JSON is `{"status":"ready"}`. These checks prove local service wiring; they do not prove
that YouTube or OpenCode credentials are valid or that a particular video is accessible.

## Compiled mode: two terminals, no Vite server

Build both applications once from the repository root:

```sh
npm run build
npm --prefix services/channel-library run build
```

Stop any host development session first. In **terminal 1**, at the repository root:

```sh
npm start
```

In **terminal 2**, at the repository root:

```sh
npm --prefix services/channel-library start
```

Open **http://127.0.0.1:3100**: the library process serves the compiled React application and API
on the same origin. The transcript API stays at **http://127.0.0.1:3000**. The Vite-specific smoke
block above is for development; in compiled mode use the library origin for the HTML and `/api`
requests. This is a local production build, not a deployment or an automatic process supervisor.

## Stop, restart and retain data

With `make dev`, press **Ctrl+C once** and wait for the combined session to exit. When using
individual commands, press **Ctrl+C in each running terminal**. Start the same command or commands
to resume. The library resumes saved collection/enrichment progress; after downtime it admits one
catch-up collection per channel. Stop both APIs before backing up their complete data directories.
Do not run two library processes against the same SQLite database.

Default paths, relative to the service working directories:

| Content | Path from repository root |
| --- | --- |
| Transcript job metadata and expiring source bundles | `.data/transcripts` |
| RAG database and metadata | `.data/lancedb` (including its versioned namespace) |
| Verified model assets | `.models` |
| Library SQLite, saved originals and editorial results | `services/channel-library/.data/library` |

Deleting a data directory deletes that service's saved history. Rebuilding or restarting does not.
The library's saved originals are independent of the transcript API's source-bundle expiration.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Port already in use | `make dev` selects another available port and prints its URL. If a port is taken after the check, restart the session. Individual commands still need explicit port changes or the earlier process stopped. |
| Vite proxy reports connection refused | Check the library's startup logs at its selected URL. `make dev` configures the proxy automatically; for individual commands export `LIBRARY_PROXY_TARGET` with the actual library origin. |
| Transcript connection refused | Check transcript startup logs at its selected URL. `make dev` sets the library's upstream automatically; with individual commands, update `TRANSCRIPT_API_URL` when changing the API port. |
| Access screen rejects the token | Enter the library owner key, not the transcript or OpenCode key. Restart the library after editing its env file. |
| Protected routes return 503 | Configure the appropriate owner key; root routes need `API_ACCESS_KEY`, library routes need `LIBRARY_ACCESS_KEY`. Check data directory permissions. |
| Channel discovery fails | In RSS mode use a public channel ID URL and check feed access. In data_api mode enable YouTube Data API v3 and configure its key; check restrictions/quota. |
| Transcript request rejected | Confirm `TRANSCRIPT_API_KEY` exactly matches the root `API_ACCESS_KEY`. Check transcript API logs and connectivity. |
| LLM enrichment fails | Confirm the library's OpenCode key, model, protocol and subscription quota. Source text is preserved; use Retry processing after correction. |
| `/ready` remains 503 | Check `.models`, configured RAG model/storage paths, file permissions and root logs; allow time for local model initialization. |
| Audio fallback fails | Verify `yt-dlp`, FFmpeg and the root OpenCode key. YouTube restrictions may still prevent extraction. |
| Native SQLite install fails | Use a supported Node release and install your OS C/C++ build tools and Python 3 before retrying `npm ci`. |

Removed, private, region-restricted or blocked videos may remain unavailable even with correctly
configured services. The existing Muse audio fallback has an automotive/PT-BR prompt; this guide
does not change that behavior. See the [datacenter blocking runbook](runbooks/youtube-datacenter-blocking.md)
for diagnosis, and the [library README](../services/channel-library/README.md) for limits/recovery.

## Quality and dependency audits

For the Chromium reader tests, install the browser once, then check both packages:

```sh
npm --prefix services/channel-library exec -- playwright install chromium
npm run check:all
npm audit
npm --prefix services/channel-library audit
```

On Linux CI use `playwright install --with-deps chromium` to install browser system dependencies.
Audits query the registry's current advisory database; repeat them as advisories change. Both lockfiles
must stay committed, and `npm ci` installs their resolved versions.

The October 2026 security update patches Fastify to 5.12.5 and the existing adm-zip override to 0.6.1,
and refreshes compatible fast-uri/undici resolutions. Transformers, ONNX runtime, model artifacts and
embedding fingerprints remain unchanged. Sources: [Fastify advisory](https://github.com/advisories/GHSA-4mh8-r7rc-xpvc),
[adm-zip advisory](https://github.com/advisories/GHSA-rcw4-f5rp-g42v),
[fast-uri advisory](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj),
[undici advisory](https://github.com/advisories/GHSA-r53p-7pc4-xj5r).

The 2026-10-13 CI follow-up pins `sharp` to 0.35.5, updates the locked `source-map-js` to 1.2.2,
and overrides ONNX Runtime's installer dependency to `global-agent` 4.1.3, removing the vulnerable
`roarr`/`sprintf-js` chain. The installer bootstrap is checked in a subprocess without downloads.
LanceDB, Transformers, ONNX Runtime and model versions remain unchanged. These updates address
the [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w),
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and
[sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

For automatic setup, reading features and stage-specific probes, see [Reading workflow and validation](library-reading-workflow.md).

## Add an individual video

In **Library**, paste a **YouTube video URL** above the filters and select **Add video**.
Watch, youtu.be, Shorts, live and embed HTTPS links are supported. Playlist and timestamp
parameters still import only the specified video. A channel URL belongs in **Channels**.
The reader opens immediately while transcription and enrichment run in the background.
A duplicate link opens the existing video and preserves its progress, favorites and notes.

This does not follow a channel. Until channel discovery supplies real metadata, the title is
`YouTube video <id>`, the source is **Added individually**, and the displayed date is its
addition date, not a guessed publication date. Existing retry, reading filters and Markdown
export also work for individual videos. Provider credentials and transcript availability
still determine whether background processing can finish.

The authenticated `POST /api/v1/videos` endpoint accepts `{ "url": "https://youtu.be/abcdefghijk" }`.
It returns `{ video, created }` with 202 for admission or 200 for an existing video.
It shares the owner's mutation rate limit and rejects malformed URLs and unknown fields.

This upgrade introduces schema 3. Stop the library and make a backup of the complete
`LIBRARY_DATA_DIR` before upgrading. Schemas 1 and 2 migrate atomically, preserving sources,
enrichment, reading state, jobs and collections. Older service binaries cannot open schema 3;
rolling back requires restoring the backup alongside the older code. Do not lower `user_version`.

## Which environment files to fill

There are **two runtime environment files**. `.env.example` files are templates, not additional
configuration to fill. The Vite frontend needs no `.env`: it uses the library API proxy.

| File | Variable | Meaning |
| --- | --- | --- |
| Root `.env` | `API_ACCESS_KEY` | Private password you choose for the transcript API. |
| Root `.env` | `OPENCODE_API_KEY` | Provider-issued key used by the transcript service where required. |
| `services/channel-library/.env` | `LIBRARY_ACCESS_KEY` | Private password you choose; enter this in the browser's **Access key** field. |
| `services/channel-library/.env` | `TRANSCRIPT_API_KEY` | Copy the exact root `API_ACCESS_KEY` here so the library can call the transcript API. |
| `services/channel-library/.env` | `OPENCODE_API_KEY` | Provider-issued key for summaries and corrected transcripts. May be the same provider key as the root file. |
| `services/channel-library/.env` | `YOUTUBE_DISCOVERY_MODE` | Keep `YOUTUBE_DISCOVERY_MODE=rss` to collect recent channel videos from public feeds. |
| `services/channel-library/.env` | `YOUTUBE_API_KEY` | Optional with `rss`; required only when selecting `data_api` discovery through YouTube Data API. |

RSS is a public feed of recent channel publications. It does not use a Google API key.
It has a limited recent window; API discovery supports paginated channel history.
The individual-video form also needs no `YOUTUBE_API_KEY`; it queues the video ID directly.

Keep the other example defaults for local use unless changing ports, storage, provider model
or installed binary paths. `make dev` selects free ports and connects the local services using
the chosen ports; it does not rewrite your env files. Without the launcher, set
`TRANSCRIPT_API_URL` to the transcript API address yourself. Never put provider keys in frontend
variables. Changing a runtime `.env` requires restarting `make dev`.
