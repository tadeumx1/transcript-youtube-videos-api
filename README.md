# Hybrid YouTube Transcription API

A Node.js, Fastify, and TypeScript API that receives a public YouTube video URL, prioritizes its
captions, and transcribes the audio with `muse-spark-1.2-contributor` through OpenCode Go when
captions are unavailable. Both sources produce the same JSON and a locally generated searchable
PDF. Results are available synchronously or through a durable job, and complete bundles are cached
for a limited time to support a RAG workflow. Completed jobs can also be materialized into a local
knowledge base with E5 embeddings and hybrid LanceDB search, without a remote embedding provider.

## How it works

1. Validates the URL and converts it to the canonical YouTube format.
2. Searches for captions in the requested order, defaulting to `pt-BR`, `pt`, and `en`.
3. Downloads audio with `yt-dlp` only when no usable captions are available.
4. FFmpeg converts the audio to mono MP3 at 16 kHz and 48 kbps, split into 10-minute chunks.
5. Sends each chunk sequentially to Muse with `reasoning.effort: "minimal"`.
6. Removes temporary files even when download, conversion, or transcription fails.
7. Generates a searchable PDF locally without another AI call, then publishes JSON and PDF to the
   cache only when the bundle is complete.
8. Serves synchronous routes immediately or processes jobs through a durable queue that recovers
   after restarts.

Muse is not called when captions work or when the caption provider fails unexpectedly.

## OpenCode Go and data policy

The fallback uses an OpenCode Go subscription and the workspace key in `OPENCODE_API_KEY`. The
Contributor model requires **“Allow models that use request data for training”** to be enabled in
the workspace.

This consent allows requests, including uploaded audio, to be used to improve the model. Process
only public videos that you are authorized to use. Do not submit private recordings, credentials,
sensitive personal data, or confidential content.

See the [official OpenCode Go documentation](https://dev.opencode.ai/docs/go/) for current models,
limits, and endpoints.

## Local requirements

- Node.js 22 or newer
- `yt-dlp`
- FFmpeg
- An OpenCode Go subscription and `OPENCODE_API_KEY` for videos without captions

The Dockerfile installs both media executables. For development without Docker, verify them first:

```bash
node --version
yt-dlp --version
ffmpeg -version
```

## Configuration

```bash
npm ci
cp .env.example .env
```

Populate only the `.env` file, which is already ignored by Git:

```dotenv
OPENCODE_API_KEY=your-opencode-go-key
API_ACCESS_KEY=a-long-random-token
```

The `dev` and `start` scripts load the root `.env` file when it exists. Variables supplied by the
hosting environment are also accepted.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | no | `0.0.0.0` | Address on which Fastify listens. |
| `PORT` | no | `3000` | TCP port, from 1 to 65535. |
| `OPENCODE_API_KEY` | fallback only | empty | OpenCode Go workspace key. |
| `API_ACCESS_KEY` | yes for protected routes | empty | Bearer token protecting transcription, jobs, RAG, and metrics. |
| `YT_DLP_PATH` | no | `yt-dlp` | Path to the `yt-dlp` executable. |
| `FFMPEG_PATH` | no | `ffmpeg` | Path to the FFmpeg executable. |
| `MAX_CONCURRENT_TRANSCRIPTS` | no | `1` | Global concurrent transcription limit, from 1 to 32. |
| `TRANSCRIPT_RETRY_AFTER_SECONDS` | no | `30` | Retry delay reported when capacity is full, from 1 to 3600 seconds. |
| `YT_DLP_TIMEOUT_MS` | no | `300000` | Download timeout, from 1 to 3600000 milliseconds. |
| `FFMPEG_TIMEOUT_MS` | no | `900000` | Conversion timeout, from 1 to 3600000 milliseconds. |
| `PROCESS_TERMINATION_GRACE_MS` | no | `5000` | Delay between `SIGTERM` and `SIGKILL`, from 1 to 60000 milliseconds. |
| `MUSE_TIMEOUT_MS` | no | `300000` | Muse request timeout, from 1 to 3600000 milliseconds. |
| `DATA_ROOT` | no | `.data/transcripts` | Non-empty persistence path; Railway IaC sets `/data/transcripts`. |
| `MAX_QUEUED_JOBS` | no | `100` | Active job limit (`queued + processing`), from 1 to 10000. |
| `ARTIFACT_TTL_SECONDS` | no | `604800` | Complete bundle retention, from 60 to 2678400 seconds. |
| `FAILED_JOB_TTL_SECONDS` | no | `86400` | Failed job retention, from 60 to 604800 seconds. |
| `JOB_TOMBSTONE_TTL_SECONDS` | no | `86400` | Expiration marker retention, from 60 to 604800 seconds. |
| `STORAGE_SWEEP_INTERVAL_MS` | no | `60000` | Local cleanup interval, from 1000 to 3600000 milliseconds. |
| `RAG_DATA_ROOT` | no | `.data/lancedb` | Non-empty RAG database path; Railway IaC sets `/data/lancedb`. |
| `RAG_MODEL_ROOT` | no | `.models` | Non-empty verified local E5 model path; the image uses `/app/models`. |
| `MAX_QUEUED_RAG_INGESTIONS` | no | `25` | Queued RAG ingestion limit, from 1 to 1000. |
| `MAX_CONCURRENT_RAG_SEARCHES` | no | `4` | Concurrent RAG search limit, from 1 to 32. |
| `RAG_SEARCH_RETRY_AFTER_SECONDS` | no | `5` | Retry delay for a search without capacity, from 1 to 3600 seconds. |
| `FAILED_RAG_INGESTION_TTL_SECONDS` | no | `86400` | Completed or failed ingestion retention, from 60 to 604800 seconds. |
| `RAG_INGESTION_TOMBSTONE_TTL_SECONDS` | no | `86400` | Expired ingestion marker retention, from 60 to 604800 seconds. |
| `RAG_SWEEP_INTERVAL_MS` | no | `60000` | RAG metadata cleanup interval, from 1000 to 3600000 milliseconds. |
| `RAG_MAX_SOURCE_CODE_POINTS` | no | `5000000` | Maximum code points per source, from 10000 to 20000000. |
| `RAG_MAX_CHUNKS_PER_DOCUMENT` | no | `5000` | Maximum chunks per document, from 1 to 20000. |
| `RAG_EMBEDDING_BATCH_SIZE` | no | `8` | Local embedding batch size, from 1 to 8. |
| `RAG_MIN_FREE_BYTES` | no | `134217728` | Volume reserve before a miss, from 16777216 to 536870912 bytes. |

`GET /health` and `GET /ready` remain public. If `API_ACCESS_KEY` is empty, transcription, job,
RAG, and metrics endpoints fail closed with HTTP 503; they never become public accidentally.

Never send `OPENCODE_API_KEY` in a request body, commit, or API response. Send `API_ACCESS_KEY` only
in the `Authorization` header and treat it as a production credential.

## Running the API

For development:

```bash
npm run dev
```

For a production build:

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t youtube-transcript-api .
docker run --rm \
  -p 3000:3000 \
  --env-file .env \
  youtube-transcript-api
```

The image includes FFmpeg, pins `yt-dlp` to version `2026.8.19`, and packages the five verified E5
model artifacts; runtime never downloads the model. The entrypoint starts as root only to create
and set ownership on `/data`, then uses `gosu` to replace itself with the unprivileged Node process.
Because YouTube changes frequently, update the pinned `yt-dlp` version when required. The checks in
[Quality](#quality) build the same production image and run the encoder and LanceDB inside it
without credentials or network access.

## Routes

### Health

```bash
curl http://localhost:3000/health
```

Response:

```json
{"status":"ok"}
```

### JSON transcription

```bash
export API_BASE_URL=http://localhost:3000
export VIDEO_URL=https://www.youtube.com/watch?v=YOUR_ID_HERE

curl -X POST ${API_BASE_URL}/v1/transcripts \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"url\":\"${VIDEO_URL}\",\"languages\":[\"pt-BR\",\"pt\",\"en\"]}" \
  --output transcript.json
```

Replace `YOUR_ID_HERE` with the 11-character ID of an authorized public video. `languages` is an
optional ordered list of one to five codes. When audio is transcribed, `source` is
`muse_transcription`, `isGenerated` is `true`, and `timestampPrecision` is `chunk`. Each timestamp
is the approximate start of a chunk of up to 10 minutes, not the exact time of every word.

### PDF

```bash
curl -X POST ${API_BASE_URL}/v1/transcripts/pdf \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"url\":\"${VIDEO_URL}\"}" \
  --output transcript.pdf
```

The PDF contains the canonical URL, video ID, transcription source, language, generated-content
indicator, timestamp precision, extraction time, and the complete text in chronological order.
PDFKit renders it locally without consuming Muse tokens.

Both synchronous routes first look for a verified bundle for the canonical video and requested
language order. A hit returns retained bytes without calling YouTube, Muse, FFmpeg, or the renderer.
On a miss, the API produces the transcription and PDF once, then publishes the complete bundle. A
cache completion failure does not turn an already produced JSON transcription into an error; the
PDF route preserves its existing rendering error.

### Durable jobs

Use jobs to avoid holding an HTTP connection open for long videos. Keep `VIDEO_URL` set to the
`YOUR_ID_HERE` placeholder until you choose an authorized public video. Every command below sends
the same Bearer token and writes the response to a file, keeping transcription content out of the
terminal.

Submit a job:

```bash
curl -X POST ${API_BASE_URL}/v1/jobs \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"url\":\"${VIDEO_URL}\",\"languages\":[\"pt-BR\",\"pt\",\"en\"]}" \
  --dump-header job-headers.txt \
  --output job-submission.json
```

The server responds with 202, `Location`, `Retry-After: 2`, a `jobId`, and a `miss`, `joined`, or
`hit` disposition. Copy the returned identifier without recording it in shared logs:

```bash
export JOB_ID=replace-with-returned-job-id
```

Read the `queued`, `processing`, `completed`, or `failed` status:

```bash
curl -X GET ${API_BASE_URL}/v1/jobs/${JOB_ID} \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output job-status.json
```

After completion, download the retained JSON and PDF:

```bash
curl -X GET ${API_BASE_URL}/v1/jobs/${JOB_ID}/transcript \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output transcript.json

curl -X GET ${API_BASE_URL}/v1/jobs/${JOB_ID}/pdf \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output transcript.pdf
```

Concurrent submissions with the same canonical identity have one owner: new work is a `miss`,
active followers are `joined`, and an already verified bundle is a `hit`. Only a new miss consumes
`MAX_QUEUED_JOBS`; the limit counts `queued + processing`. The worker selects jobs in FIFO order and
waits for the same global capacity used by synchronous routes, without rejecting or calling
providers until a permit is available.

TTLs are fixed and non-sliding: reads never extend retention. Complete bundles expire
`ARTIFACT_TTL_SECONDS` after completion; failed jobs use `FAILED_JOB_TTL_SECONDS`; the 410 marker
remains for `JOB_TOMBSTONE_TTL_SECONDS`. Cleanup runs every `STORAGE_SWEEP_INTERVAL_MS`.

After a restart, a complete bundle completes its job, while a verified partial transcription
resumes only local PDF generation. If an external effect is uncertain and no verified transcription
exists, the job ends as `JOB_INTERRUPTED`. YouTube and Muse are never retried automatically. To try
again and accept new quota usage, explicitly submit another `POST /v1/jobs`.

### Local RAG knowledge base

Ingestion starts exclusively from a durable `completed` job whose bundle is still verified. It
copies a local transcription snapshot, chunks the text, and publishes E5 embeddings to LanceDB.
This flow does not transcribe the video again, regenerate the PDF, or call YouTube, Muse/OpenCode,
an LLM, a model registry, or an embedding service over the network; embeddings run locally with the
packaged model.

Use only identifiers returned by earlier routes and do not record them in shared logs. Submit a
completed job to the RAG queue:

```bash
curl -X POST ${API_BASE_URL}/v1/rag/ingestions \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"jobId\":\"${JOB_ID}\"}" \
  --dump-header rag-ingestion-headers.txt \
  --output rag-ingestion.json
```

The server responds with 202, `Location`, `Retry-After: 2`, and a `miss`, `joined`, or `hit`
disposition. Copy the response placeholders to inspect processing without printing the body:

```bash
export RAG_INGESTION_ID=replace-with-returned-ingestion-id
export RAG_DOCUMENT_ID=replace-with-returned-document-id

curl -X GET ${API_BASE_URL}/v1/rag/ingestions/${RAG_INGESTION_ID} \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output rag-ingestion-status.json
```

Status is `queued`, `processing`, `completed`, or `failed`. After completion, run a hybrid search.
The query accepts 1 to 1000 characters, `topK` defaults to 5 and accepts 1 to 20, and the optional
filter accepts up to 50 distinct `documentIds`:

```bash
export RAG_QUERY=replace-with-an-authorized-query

curl -X POST ${API_BASE_URL}/v1/rag/search \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"query\":\"${RAG_QUERY}\",\"topK\":5}" \
  --output rag-search-results.json
```

Delete a document when it should no longer participate in retrieval:

```bash
curl -X DELETE ${API_BASE_URL}/v1/rag/documents/${RAG_DOCUMENT_ID} \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output /dev/null \
  --write-out '%{http_code}\n'
```

A completed deletion responds with 204 and immediately removes the document logically from search results
without changing the source job, transcription, or PDF. It does not provide secure physical erasure:
old LanceDB fragments and Railway backups can retain chunks until compaction and retention
policies remove them. The API must not be described as a cryptographic destruction or media
sanitization mechanism.

Concurrent ingestions of the same version use `miss`, `joined`, and `hit`. Only a new miss counts
toward the 25-item limit and requires at least 128 MiB free on the shared Volume. Insufficient space
returns 507 `RAG_STORAGE_CAPACITY_EXCEEDED`, and a full queue returns 429
`RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED` with `Retry-After: 30`. Four concurrent searches use
`RAG_SEARCH_CAPACITY_EXCEEDED` with `Retry-After: 5`; a concurrent update to the same document uses
409 `RAG_DOCUMENT_UPDATE_IN_PROGRESS` with `Retry-After: 2`. Hits, joins, status reads, searches,
and deletions remain available under their corresponding capacity conditions.

The chunker limits each model input to 320 tokens with at most 48 tokens of preceding context; it
does not rely on model truncation. Fixed, non-sliding 24-hour TTLs belong to the ingestion resource
and its tombstone. A published document remains searchable after the source artifact and ingestion
resource expire, until explicit replacement or DELETE.

`GET /health` is liveness only. `GET /ready` returns 200 only after transcription storage, the RAG
repository, LanceDB schema and embedding fingerprint, local model warmup, reconciliation, and both
workers are ready. During initialization, shutdown, or degradation it returns 503
`{"status":"not_ready"}`. RAG operations fail closed with fixed codes, while liveness and existing
transcription/job routes retain their own contracts.

`GET /metrics` requires the same Bearer token. The
`youtube_transcript_rag_submissions_total`, `youtube_transcript_rag_ingestions_current`,
`youtube_transcript_rag_component_healthy`, `youtube_transcript_rag_searches_total`, and
`youtube_transcript_rag_maintenance_total` families, along with related histograms and gauges, use
only fixed labels. Metrics and logs do not include queries, text, vectors, URLs, IDs, paths, or credentials.
Investigate health by component (`repository`, `index`, `model`, `worker`) and capacity
through aggregate outcomes; never add labels per document or content item.

## Errors

Errors use this format:

```json
{
  "error": {
    "code": "VIDEO_NOT_AVAILABLE",
    "message": "The YouTube video is not available"
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Missing, malformed, or incorrect Bearer token. |
| 400 | `INVALID_REQUEST` | Missing body, unknown field, or invalid languages. |
| 400 | `INVALID_YOUTUBE_URL` | Unsupported URL or invalid ID. |
| 404 | `VIDEO_NOT_AVAILABLE` | Private, restricted, or unavailable video. |
| 404 | `JOB_NOT_FOUND` | Unknown job or one that was never retained. |
| 404 | `RAG_INGESTION_NOT_FOUND` | Unknown RAG ingestion resource or one that was never retained. |
| 404 | `RAG_DOCUMENT_NOT_FOUND` | Unknown or already deleted RAG document. |
| 409 | `JOB_NOT_COMPLETED` | Result requested while the job is queued or processing; use `Retry-After: 2`. |
| 409 | `JOB_FAILED` | Result requested for a failed job; inspect its status. |
| 409 | `RAG_DOCUMENT_UPDATE_IN_PROGRESS` | The same document version is being updated; use `Retry-After: 2`. |
| 410 | `JOB_EXPIRED` | Expired job still represented by a retained tombstone. |
| 410 | `RAG_INGESTION_EXPIRED` | Expired ingestion still represented by a retained tombstone. |
| 429 | `JOB_QUEUE_CAPACITY_EXCEEDED` | New miss exceeded the queue; `joined` and `hit` remain accepted. |
| 429 | `RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED` | New RAG miss exceeded the queue; use `Retry-After: 30`. |
| 429 | `RAG_SEARCH_CAPACITY_EXCEEDED` | All search permits are occupied; use `Retry-After: 5`. |
| 502 | `YOUTUBE_UPSTREAM_ERROR` | Unexpected caption lookup failure. |
| 503 | `AUDIO_FALLBACK_NOT_CONFIGURED` | The fallback requires `OPENCODE_API_KEY`. |
| 503 | `AUDIO_TOOL_UNAVAILABLE` | `yt-dlp` or FFmpeg could not start. |
| 503 | `JOB_STORAGE_UNAVAILABLE` | The Volume, bundle, or durable metadata cannot be verified. |
| 503 | `RAG_MODEL_UNAVAILABLE` | The local model is missing, invalid, or not warmed up. |
| 503 | `RAG_STORAGE_UNAVAILABLE` | The local repository or index cannot be verified. |
| 507 | `RAG_STORAGE_CAPACITY_EXCEEDED` | The Volume cannot retain the minimum reserve for a new miss. |
| 502 | `AUDIO_EXTRACTION_FAILED` | Audio download or processing failed. |
| 502 | `AUDIO_CHUNK_TOO_LARGE` | A chunk exceeded the internal 8 MiB limit. |
| 502 | `MUSE_TRANSCRIPTION_FAILED` | OpenCode Go or Muse did not complete the transcription. |
| 500 | `PDF_GENERATION_FAILED` | The PDF could not be rendered. |
| 503 | `API_AUTH_NOT_CONFIGURED` | `API_ACCESS_KEY` is not configured on the server. |

There are no automatic retries. A failure stops the request or job to prevent duplicate quota usage
and amplification of YouTube blocking. `JOB_INTERRUPTED` is persisted in job status and is never
used to repeat external work silently.

## Railway

`.railway/railway.ts` manages the project and service with Railway's current Infrastructure as Code
implementation. It configures `/health` as the health check and allows up to 300 seconds for the
image to become healthy. The topology uses one replica and one shared 1024 MB (1 GB) Volume mounted
at `/data`: `DATA_ROOT=/data/transcripts` stores jobs and artifacts, while
`RAG_DATA_ROOT=/data/lancedb` stores local metadata and indexes. The verified model is in the image,
not the Volume. IaC preserves both existing secrets and creates no database, bucket, remote model,
or public storage. The container and Fastify use the `PORT` variable supplied by Railway.

The 1 GB limit is shared by both roots. Monitor aggregate space and preserve the 128 MiB reserve; a
RAG miss is rejected with 507 before consuming it. A Volume can attach to only one deployment of
this replica at a time, causing brief downtime during each redeploy. Backups are the operator's responsibility:
deleting, recreating, or corrupting the Volume without a recoverable copy can
permanently lose jobs, JSON, PDFs, and the RAG knowledge base.

To review infrastructure changes before applying them:

```bash
railway config plan --file .railway/railway.ts
```

Review the count and every add/change/destroy item. Tests do not apply configuration automatically;
run `railway config apply --file .railway/railway.ts` only after explicit approval of that exact
plan. This version's validation plan was read-only, so it does not prove that the remote state has
already been applied.

For the first deployment, run this from the project root:

```bash
railway up
```

Then configure both service secrets. Pass values through stdin so they are not recorded in shell
history:

```bash
printf '%s' "$OPENCODE_API_KEY" | railway variable set OPENCODE_API_KEY --stdin --service transcript-youtube-videos-api
printf '%s' "$API_ACCESS_KEY" | railway variable set API_ACCESS_KEY --stdin --service transcript-youtube-videos-api
```

A variable change triggers a new deployment. Generate the public domain and confirm status:

```bash
railway domain --service transcript-youtube-videos-api --json
railway deployment list --service transcript-youtube-videos-api --json
```

Use the returned domain in the same `curl` examples. First confirm `/health` without a credential,
then confirm that `POST /v1/transcripts` without a Bearer token returns 401 before testing an
authenticated call. Keep the real `API_ACCESS_KEY` only in the secret manager and authorized
clients.

After copying `API_ACCESS_KEY` into a password manager, you can use **Seal** in Railway's Variables
tab. Sealing is irreversible and prevents retrieval through the dashboard or CLI, so do it only
after confirming that the authorized client retained the token.

To separate platform health, captions, download, FFmpeg, and Muse without exposing content, follow
the [YouTube datacenter blocking runbook](docs/runbooks/youtube-datacenter-blocking.md). Preserve the
Bearer token, `MAX_CONCURRENT_TRANSCRIPTS`, `YT_DLP_TIMEOUT_MS`, `FFMPEG_TIMEOUT_MS`, and
`MUSE_TIMEOUT_MS` even during an incident; do not disable or expand these controls to work around a
provider failure.

### Backup, restore, and local model

Schedule a maintenance window that prevents new writes. Create a verifiable backup before any
manual compaction, store it outside the Volume, and preserve both roots together; this version has
no public compaction endpoint. A workflow compatible with the current CLI creates an archive in a
temporary operations area, downloads it, and verifies its local checksum:

```bash
railway ssh --service transcript-youtube-videos-api --environment production \
  'mkdir -p /data/.ops && tar --exclude=.ops -C /data -czf /data/.ops/volume-backup.tgz transcripts lancedb'
railway volume files download /data/.ops/volume-backup.tgz ./volume-backup.tgz \
  --service transcript-youtube-videos-api --environment production
sha256sum ./volume-backup.tgz
```

Record the checksum and test the archive in separate storage. Do not treat platform retention or an
eventual snapshot as a substitute for this backup. To restore, keep writes stopped, verify the
source and checksum, upload the archive, and extract both roots as one unit:

```bash
railway volume files upload ./volume-backup.tgz /data/.ops/volume-restore.tgz \
  --service transcript-youtube-videos-api --environment production
railway ssh --service transcript-youtube-videos-api --environment production \
  'tar -C /data -xzf /data/.ops/volume-restore.tgz'
```

Then restart the single replica, confirm `/health`, wait for `/ready` to return 200, and run a known
authenticated search. Remove `.ops` files only after validation and retain the external copy under
the applicable retention policy.

Each LanceDB namespace records the model/chunker embedding fingerprint. An invalid or missing
artifact, or a mismatched fingerprint, fails closed, leaves `/ready` at 503, and never triggers a
download or remote embedding. The application rejects implicit migration of an incompatible
namespace: restore the Volume with the same image and model, or explicitly reingest into a
compatible namespace while retaining the previous backup until validation succeeds.

The portable UINT8 precision policy uses RAG namespace `v2`. On the first deployment of this
version, namespace `v1` remains intact and excluded from searches; the application creates an empty
`v2` and becomes ready again. Explicitly resubmit retained source jobs to `/v1/rag/ingestions`, or
transcribe an expired source again, and validate search before deciding how long to retain `v1`.
Never copy vectors or fingerprint metadata between namespaces, and do not remove `v1` without a verifiable backup.

## Privacy and limitations

- Audio and chunks remain in a request-specific temporary directory and are removed in a `finally` block;
  audio never enters the Volume. Successful JSON, PDFs, and job metadata remain in
  `DATA_ROOT` only for configured TTLs.
- Chunks use 48 kbps MP3, last up to 10 minutes, and are sent to OpenCode Go as Base64.
- Synchronous routes and durable jobs share `MAX_CONCURRENT_TRANSCRIPTS`; use jobs for videos that
  can exceed the proxy timeout. `MAX_QUEUED_JOBS` limits new misses but is not a per-client quota.
- YouTube can block datacenter IPs, require login, rate-limit requests, or change endpoints. This
  version accepts only public videos available without cookies and does not bypass restrictions.
- Bearer authentication protects submission, status, and every JSON/PDF read. Treat persisted
  artifacts as video content and protect backups too. RAG documents survive bundle TTL until
  explicit replacement or deletion; logs and metrics exclude IDs, URLs, queries, and content.
- There are no automatic retries. Preserve `MAX_CONCURRENT_TRANSCRIPTS`, `YT_DLP_TIMEOUT_MS`,
  `FFMPEG_TIMEOUT_MS`, and `MUSE_TIMEOUT_MS`; do not expand them to work around failures.
- DELETE removes a document from search immediately, but deletion is logical: old LanceDB fragments
  and backups can persist according to compaction and retention. Do not promise secure physical
  destruction; handle exports and copies under the same policy as transcription data.
- A successful `/health` proves that the API is online; it does not prove that YouTube accepts
  requests from the Railway IP or that RAG is ready. Use `/ready` for local readiness and diagnose
  provider errors separately.

## Quality

Transcription tests use fake adapters: they do not access YouTube/OpenCode Go or execute `yt-dlp`
or FFmpeg. RAG gates use the real tokenizer, E5 encoder, and LanceDB locally.

Fetch and verify the five immutable artifacts only during explicit acquisition, then run the
offline suite, which blocks network and credentials:

```bash
npm run rag:model:fetch
npm run test:rag:offline
```

The evaluation contains exactly 12 fictional Brazilian automotive documents and 48 PT-BR qrels
covering exact search, semantic search, model/year disambiguation, accents and typos, numbers, and
distractors. It measures vector, FTS, and hybrid retrieval, enforces Recall/MRR/nDCG and subgroup
thresholds, and requires identical IDs and ranks across three fresh indexes.

Run the mutation, documentation/OpenAPI, dependency, and offline container gates too:

```bash
npm exec -- vitest run test/integration/lancedb-rag-index.test.ts test/integration/rag-ingestion-worker.test.ts
npm exec -- vitest run test/integration/openapi.test.ts test/unit/rag-readme-contract.test.ts
npm audit --omit=dev
npm ls
docker build -t transcript-rag:local .
docker run --rm --network none transcript-rag:local node scripts/rag-container-smoke.mjs
```

The smoke test runs inside the production image without credentials or network and proves a real
384-dimensional vector, replacement, vector/FTS search, deletion, an unprivileged user, and writes
under `/data`. Finally, run the complete gate:

```bash
npm run check
```

This command runs lint, strict type checking, unit and integration tests, and the production build.

### Continuous integration

GitHub Actions runs the same gates for pushes to `main` and pull requests. The workflow receives
neither `OPENCODE_API_KEY` nor `API_ACCESS_KEY`: tests use local adapters, and the Dockerfile build
does not access providers.

If branch protection is enabled on `main`, configure exactly these required checks:

- `Source checks`
- `Container build`

The first runs `npm ci` and `npm run check` on Node.js 22. The second starts only after the first,
builds and loads the production image without publishing it, then runs the smoke test with
`docker run --network none`.
