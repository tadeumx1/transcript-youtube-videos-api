# Run all services locally

Run these commands from the repository root. Development uses three terminals; keep all three
running at the same time. The transcript API also hosts its job worker and local RAG engine.
The library API hosts the daily channel collector and enrichment worker. Neither needs a separate
queue service or database server.

| Process | Development address | Start command from the repository root |
| --- | --- | --- |
| Transcript API, job worker and RAG | http://127.0.0.1:3000 | `npm run dev` |
| Channel library API and worker | http://127.0.0.1:3100 | `npm run library:dev:api` |
| React/Vite reader | http://127.0.0.1:5173 | `npm --prefix services/channel-library run dev:web -- --port 5173 --strictPort` |

Vite forwards `/api` requests to the library API at `127.0.0.1:3100`. The library calls the
transcript API at `TRANSCRIPT_API_URL`. Open the reader at port **5173** during development;
the library API serves the reader itself on port **3100** after a production build.

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

Wait for the APIs to announce that they are listening. Open **http://127.0.0.1:5173** and enter
`LIBRARY_ACCESS_KEY`. Add a public channel URL such as `https://www.youtube.com/@CHANNEL_HANDLE`.
The first collection imports up to ten recent videos; subsequent collections run daily at 06:00
in America/Sao_Paulo by default. The library API process must stay running for scheduled work.
Closing the browser leaves collection running; stopping the API does not.

A registered video proceeds through transcription and enrichment before its summary, key points
and corrected text are ready. Original text stays readable if enrichment fails. Live imports use
provider quotas; the health/auth checks below do not import a channel or call an LLM.

## Verify the running services

Run this from a fourth terminal at the repository root after both APIs and Vite are listening.
It reads the library owner key from its environment file, never prints it, and asserts both health
responses, the real reader page, and authenticated/unauthenticated requests through the Vite proxy:

```sh
node --env-file-if-exists=services/channel-library/.env --input-type=module <<'NODE'
import assert from 'node:assert/strict'
const key = process.env.LIBRARY_ACCESS_KEY
assert.ok(key, 'Configure LIBRARY_ACCESS_KEY before the smoke check')
for (const port of [3000, 3100]) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
}
const reader = await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(10000) })
assert.equal(reader.status, 200)
assert.match(await reader.text(), /<div id="root"><\/div>/)
const url = 'http://127.0.0.1:5173/api/v1/channels'
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
curl --fail --silent --show-error http://127.0.0.1:3000/ready
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

Press **Ctrl+C in each running terminal** and wait for its process to exit. Start the same commands
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
| Port already in use | Stop the earlier process. Vite uses `--strictPort` so it fails instead of silently opening a different port. |
| Vite proxy reports connection refused | Start the library API on 3100. If changing `LIBRARY_PORT`, also change `services/channel-library/vite.config.ts`'s proxy target. |
| Transcript connection refused | Start the root API on 3000. If changing `PORT`, update the library's `TRANSCRIPT_API_URL`. |
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
