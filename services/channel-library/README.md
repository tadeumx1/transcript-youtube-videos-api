# Margin — channel transcript library

A separate Node/Fastify API and React/Vite reading application. Register public YouTube channels,
collect their ten latest videos, and check daily for new publications. Each video gets an original
transcript from the existing API and an OpenCode Go editorial correction, Brazilian Portuguese
summary, and key points. Original transcripts remain available for comparison.

## Start locally

Requires Node **22.12+**, npm, and the existing transcript API running locally or remotely.
From the repository root:

```sh
npm --prefix services/channel-library ci
cp services/channel-library/.env.example services/channel-library/.env
```

Fill the server environment file, then start the two development processes in separate terminals:

```sh
npm --prefix services/channel-library run dev:api
npm --prefix services/channel-library run dev:web
```

Open `http://localhost:5173`, enter `LIBRARY_ACCESS_KEY`, and add a channel URL.
The web development server proxies `/api` to the library API at `127.0.0.1:3100`.
If you change the development API port, change `vite.config.ts`'s proxy target too.
The transcript API remains a separate process on port 3000 by default.

For a single process serving the compiled web app and library API:

```sh
npm --prefix services/channel-library run build
npm --prefix services/channel-library start
```

Open `http://127.0.0.1:3100`. The API worker must be **always running** for daily collection;
a browser tab is not a scheduler. Closing the browser does not stop background collection.
These commands do not deploy the service or change the existing API's configuration.

## Configuration

Variables load from this service's `.env`, never from browser variables or the repository root `.env`.
Use separate, server-held credentials. Existing `API_ACCESS_KEY` belongs in `TRANSCRIPT_API_KEY`
when this service calls the transcript API; do not give that credential to the browser.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIBRARY_ACCESS_KEY` | empty | Owner's library key; missing configuration fails closed. Enter only this key in the access screen. It stays in memory and clears on reload/lock. |
| `LIBRARY_HOST` | `127.0.0.1` | Listen address. A container/reverse proxy may require `0.0.0.0`. |
| `LIBRARY_PORT` | `3100` | Library API and production web port. |
| `LIBRARY_DATA_DIR` | `.data/library` | Persistent SQLite directory, relative to the service working directory. |
| `LIBRARY_TIME_ZONE` | `America/Sao_Paulo` | IANA timezone for collection. |
| `LIBRARY_DAILY_HOUR` | `6` | Daily collection hour, 0–23; default **06:00**. |
| `YOUTUBE_API_KEY` | empty | YouTube Data API v3 key for public channel lookup and upload-playlist pagination. |
| `TRANSCRIPT_API_URL` | `http://127.0.0.1:3000` | Existing transcript API origin. |
| `TRANSCRIPT_API_KEY` | empty | Bearer credential for existing `/v1/jobs` routes. |
| `OPENCODE_API_KEY` | empty | OpenCode Go key used for text enrichment. |
| `LLM_BASE_URL` | `https://opencode.ai/zen/go/v1` | Operator-controlled provider base URL. |
| `LLM_API_STYLE` | `chat_completions` | Explicit `chat_completions` or `responses` protocol. |
| `LLM_MODEL` | `glm-5.3-flash` | Configurable text model; choose a model supporting the configured protocol. |

See the official [OpenCode Go model/endpoint table](https://dev.opencode.ai/docs/go/) when changing
models. The library supports those two protocols, not an arbitrary provider's Messages protocol.
Keys, model selection, and quota availability require operator configuration; automated tests use
local fixtures and incur no provider charges.

## Reading and collection

- Supported URLs: `/@handle`, `/channel/UC…`, `/user/name`, including their standard video tabs.
  Legacy `/c/name` URLs must be replaced with the channel's current handle URL.
- First import: the ten most recent discoverable public upload-playlist entries (or fewer).
  Shorts and public archived streams appearing in that playlist are included; currently live,
  scheduled, inaccessible, or unsupported media can fail transcription and remain visible.
- Daily scans paginate through uploads with a seven-day overlap around the last completed scan.
  Repeated video IDs do not create another entry or re-enrich completed text. A pass exceeding
  100 pages persists its cursor and continues later. Videos made public long after their original
  publication date can fall outside this overlap; this is not a full historical backfill.
- After downtime, one catch-up collection is admitted per channel. Partial pages and stage progress
  survive restarts. Manual collection joins an existing active collection. Pause stops future
  automatic admission; an already admitted collection may finish.
- One pipeline runs at a time. Retryable network/429/5xx failures get at most three attempts per
  stage, with 60/300-second delays or the provider's Retry-After up to one hour. Failed videos offer
  manual retry. Credential failures stop automatic retries. Source jobs are polled with a two-second
  minimum and stop after six hours. An LLM failure preserves the source transcript.
- Text is corrected in source-language chunks up to 12000 Unicode code points. Summaries are reduced
  in bounded groups. Originals over one million code points remain readable but are not sent to an
  LLM. Summary/key-point output is PT-BR. All corrections are AI-generated editorial suggestions,
  not verified facts; use the immutable original and video to check questionable statements.
- Original segment timestamps preserve the upstream caption/chunk precision. Corrected prose is
  not presented as time-aligned subtitles. Text and HTML-like model output are displayed as text.

## Persistence and recovery

Run **one library process per database** on a persistent local filesystem. SQLite stores channels,
video metadata, originals, editorial results, collection cursors, retries, and chunk progress.
Migrations are versioned. The library never opens the existing transcript/RAG storage directories.
Its content does not expire when source jobs expire. Temporary intermediate chunk results are
removed after successful enrichment; originals and final text are kept until operator cleanup.

Stop the service before copying its entire data directory for a backup. Restore that directory to
`LIBRARY_DATA_DIR` with the service stopped; keep the SQLite database and WAL-related files together.
Graceful shutdown checkpoints the current stage. Forced termination recovers from saved progress.
A provider request that succeeds immediately before a crash may be repeated: local deduplication
cannot guarantee exactly-once upstream billing. Monitor disk capacity as this library grows.

Admission routes require the library Bearer key and allow 30 requests per minute. Reading remains
available if provider credentials are missing or providers are offline. Use HTTPS at your reverse
proxy when accessing the service remotely. Provider credentials are never delivered to the frontend.

YouTube does not guarantee access to every video. Removed/private/restricted videos and upstream
blocking can prevent transcription. The existing audio fallback currently has an automotive/PT-BR
prompt; this service preserves that upstream limitation and keeps original/corrected output distinct.

## Checks

```sh
npm --prefix services/channel-library exec playwright install chromium
npm --prefix services/channel-library run check
```

On Linux CI, install Playwright's required system libraries with `playwright install --with-deps chromium`.
Backend proofs use an actual temporary SQLite database, Fastify requests, and controlled external
responses. Browser proofs run the real React application in Chromium with controlled API fixtures.
`npm run check:all` from the repository root runs the original API checks plus this application's checks.
The library CI workflow installs its own locked dependencies and browser. No live-provider success
is implied by fixture-based verification.
