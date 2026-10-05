# Run all services locally

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

- Node.js **22.12 or newer** and npm (the shared minimum includes Vite's requirement).
- Python 3, a C/C++ build toolchain and make for npm's native-addon build step. On Debian/Ubuntu,
  install them with `sudo apt-get install build-essential python3`.
- `yt-dlp` and FFmpeg on PATH for videos that require audio fallback. See the
  [yt-dlp installation guide](https://github.com/yt-dlp/yt-dlp#installation) and
  [FFmpeg downloads](https://ffmpeg.org/download.html).
- A YouTube Data API v3 key for channel discovery and an OpenCode Go key for enrichment/audio fallback.
  Obtain the YouTube key using Google's [getting started guide](https://developers.google.com/youtube/v3/getting-started).

```sh
node --version
npm --version
yt-dlp --version
ffmpeg -version
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
YOUTUBE_API_KEY=replace-with-your-youtube-data-api-key
OPENCODE_API_KEY=replace-with-your-opencode-go-key
LLM_BASE_URL=https://opencode.ai/zen/go/v1
LLM_API_STYLE=chat_completions
LLM_MODEL=glm-5.3-flash
LIBRARY_TIME_ZONE=America/Sao_Paulo
LIBRARY_DAILY_HOUR=6
```

The placeholder values above must be replaced, including the provider keys. Generate each owner
access token separately with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
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

## 4. Start all services together for development

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

### Run individual processes for debugging

For separate terminals, use the commands below instead of `make dev`. Do not start both workflows
against the same ports or library database.

In **terminal 1**, at the repository root:

```sh
npm run dev
```

In **terminal 2**, at the same repository root:

```sh
npm run library:dev:api
```

In **terminal 3**, at the same repository root:

```sh
npm --prefix services/channel-library run dev:web -- --port 5173 --strictPort
```

Wait for the APIs to announce that they are listening. Open the reader's selected URL
(**http://127.0.0.1:5173** by default) and enter
`LIBRARY_ACCESS_KEY`. Add a public channel URL such as `https://www.youtube.com/@CHANNEL_HANDLE`.
The first collection imports up to ten recent videos; subsequent collections run daily at 06:00
in America/Sao_Paulo by default. The library API process must stay running for scheduled work.
Closing the browser leaves collection running; stopping the API does not.

A registered video proceeds through transcription and enrichment before its summary, key points
and corrected text are ready. Original text stays readable if enrichment fails. Live imports use
provider quotas; the health/auth checks below do not import a channel or call an LLM.

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

Run `npm start` in terminal 1 and `npm --prefix services/channel-library start` in terminal 2.
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
| Channel discovery fails | Enable YouTube Data API v3 and configure `YOUTUBE_API_KEY`; check provider restrictions/quota. Use a handle, channel ID URL or username URL. |
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
