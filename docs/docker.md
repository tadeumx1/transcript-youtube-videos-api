# Run all applications with Docker

For first-time environment setup, manual startup and a command-by-command explanation of every
Makefile target, start with [Run all services locally](running-all-services.md).

From the repository root:

```sh
make docker-up
```

This builds and starts the transcript API, library API and frontend, waits for their health
checks, prints `URL: http://127.0.0.1:<port>`, then streams their combined logs. Open that URL.
The first build downloads npm dependencies, FFmpeg, yt-dlp and the pinned encoder model;
subsequent builds reuse Docker's cache. Startup allows 180 seconds for health after building.
Ctrl+C gives the applications up to 20 seconds to stop, removes this invocation's containers
and retains both persistent volumes.
Host Node/npm is not required: the launcher uses Make, Python 3 and Docker Compose.
The existing `make dev` still runs the host development processes with hot reload.

## Local capabilities and future hosting

The `transcript` service builds the same root Dockerfile used by the former Railway deployment.
It includes transcript JSON/PDF generation, the durable job worker, artifact cache, LanceDB and
the local E5 encoder. Compose also runs the separate library API and React reader.
No Railway account is needed for this setup. YouTube extraction needs internet, while Muse
audio fallback and library enrichment still consume the configured OpenCode quota. Embedding
inference and RAG search run locally after the model has been downloaded during the build.

Host directories, Docker named volumes and the former Railway Volume are separate stores;
starting locally does not import remote data. Use the backup/restore section below to move data.
The [Railway redeployment procedure](../README.md#redeploy-the-transcript-api) retains the service
configuration, secrets setup, deployment checks and recovery requirements for a future return.

## WSL prerequisites

Run these inside the same WSL distribution and terminal where you use the repository:

```sh
docker version
docker compose version
```

Both Client and Server must respond. Use Linux containers. With Docker Desktop, enable
Settings → Resources → WSL Integration for this distribution and restart its terminal.
A native Linux Docker Engine inside WSL also works; do not run two competing engines.
Compose v2.24 or newer is required (the newer v5 release is supported).

If `docker version` reports permission denied on `/var/run/docker.sock`, inspect `id` and
`getent group docker`. When your user is already listed in the docker group but your current
shell has not loaded it, open a new login shell or run:

```sh
newgrp docker
make docker-up
```

Do not make the Docker socket world-writable. If the engine is stopped, start Docker Desktop
or your installed Linux Docker service. Official setup: [Docker Desktop WSL integration](https://docs.docker.com/desktop/features/wsl/).

## Environment files and access

Fill these two files before startup; the launcher names a missing file without printing secrets:

- `.env`: transcript API settings, especially `API_ACCESS_KEY` and `OPENCODE_API_KEY`.
- `services/channel-library/.env`: `LIBRARY_ACCESS_KEY`, `OPENCODE_API_KEY` and discovery/model settings.

Use the library's `LIBRARY_ACCESS_KEY` in the browser's **Access key** field. No frontend env
file or separate frontend access key is required. With `YOUTUBE_DISCOVERY_MODE=rss`, `YOUTUBE_API_KEY`
can remain empty. The existing [environment guide](running-all-services.md) explains each setting.

Compose sets container-specific hosts, ports, storage and executable paths. Library requests go
to `http://transcript:3000`, using the root `API_ACCESS_KEY` as `TRANSCRIPT_API_KEY` automatically.
The frontend forwards `/api` to `http://library:3100`; provider credentials stay in API containers.
Only the frontend publishes a host port. API port 3000 and library port 3100 stay inside Docker.
Environment files and local databases are excluded from image build contexts and frontend assets.

## Ports and commands

The default host port is allocated by Docker and bound only to `127.0.0.1`; existing listeners
on 3000, 3100, 5173 or 8080 do not need to stop. For an explicit browser port:

```sh
DOCKER_WEB_PORT=8085 make docker-up
```

An invalid or occupied explicit port fails before startup. Omit `DOCKER_WEB_PORT` for automatic
allocation. A concurrent process can still claim a checked port before Docker publishes it;
that startup fails and the invocation cleans up its own containers without stopping that process.

```sh
make docker-status   # Container health and published ports
make docker-logs     # Last 200 lines, prefixed by service
make docker-down     # Stop/remove this project; keep saved data
```

`make docker-up` follows logs continuously. Another attached launcher or an existing stack is
reported rather than silently adopted: inspect it with `make docker-status`, or stop it with
`make docker-down` before restarting. Status/log/stop commands do not start services and remain
usable even if an environment file has been moved.

The default project name is `transcript-library`. For a second isolated installation, export
`DOCKER_PROJECT_NAME=my-library` before **all** its make commands. This gives it separate
containers, network and volumes. A failed first startup removes its containers but keeps volumes.
Neither shutdown nor recovery stops unrelated Docker projects or the host `make dev` processes.

## Data, backup and restore

Compose creates `<project>_transcript-data` at `/data` and `<project>_library-data` at
`/data/library`. Transcript artifacts live in `/data/transcripts`, RAG data in `/data/lancedb`.
The library volume stores originals, corrected transcripts, summaries, favorites and notes.
Rebuilding/removing containers preserves these volumes. The container library starts empty;
it does not automatically import or share the host `.data/library` directory.

Stop writers before a backup or restore. For the default project:

```sh
make docker-down
mkdir -p backups
docker run --rm -v transcript-library_library-data:/source:ro -v "$PWD/backups:/backup" --entrypoint sh transcript-library-library -c 'tar -C /source -czf /backup/library.tar.gz .'
docker run --rm -v transcript-library_transcript-data:/source:ro -v "$PWD/backups:/backup" --entrypoint sh transcript-library-transcript -c 'tar -C /source -czf /backup/transcript.tar.gz .'
```

The backup directory must be writable by UID 1000 (the owner on typical WSL installs). These
archives contain private content; store them accordingly. To restore the saved data, keep all
writers stopped, use the matching current image/schema, and extract into the selected volume:

```sh
docker run --rm --user 0 -v transcript-library_library-data:/restore -v "$PWD/backups:/backup:ro" --entrypoint sh transcript-library-library -c 'tar -C /restore -xzf /backup/library.tar.gz && chown -R 1000:1000 /restore'
docker run --rm --user 0 -v transcript-library_transcript-data:/restore -v "$PWD/backups:/backup:ro" --entrypoint sh transcript-library-transcript -c 'tar -C /restore -xzf /backup/transcript.tar.gz && chown -R 1000:1000 /restore'
make docker-up
```

Restore into an empty volume to avoid mixing old and restored artifacts. To explicitly import
a host library, stop its `make dev` session, archive the **contents** of its configured
`LIBRARY_DATA_DIR` (including SQLite sidecar files), and restore that archive into an empty
container library volume using the procedure above. Never mount the same SQLite directory
into two running workers. Keep the original host data and a backup until the import is verified.

Removing a volume **deletes** its saved data. `docker compose down --volumes` and
`docker volume rm` are destructive; none of the make targets deletes volumes automatically.
Adapt project-prefixed image/volume names when using `DOCKER_PROJECT_NAME`.

## Verification and troubleshooting

A healthy container means its local HTTP endpoint responds. YouTube availability, provider
credentials, quota and model output are separate: those failures appear in library processing
logs and the saved video status. Original transcripts remain readable when enrichment fails.
See [processing logs](running-all-services.md) for the service flow and 15-second wait events.

Repository proofs (requires the normal test dependencies and Playwright Chromium on the host):

```sh
python3 -m unittest test/docker/test_launcher.py
node --test test/docker/stack.test.mjs
npm --prefix services/channel-library test -- --reporter=verbose -t 'T2 root development wrapper forwards both Vite flags'
```

The real-container suite builds from contexts without host dependencies, uses an isolated
`docker-proof-*` project and fixture credentials, tests HTTP/browser behavior and persistence,
and removes only its test containers/volumes afterward. It uses controlled transcript/LLM
providers; it does not claim live YouTube/OpenCode success. Missing engine access is a failing
runtime proof, never a skipped pass. Normal application startup never runs these fixtures.
