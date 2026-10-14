# Create and validate restorable local container backups

Status: scope and detailed plan approved under the owner's blanket approval on 2026-10-09.
Profile: `light` (repository default). Planning approval does not authorize operations or
implementation.

## Problem

The Docker guide documents separate manual tar commands for the transcript/RAG volume and the
library volume. They require operator knowledge of volume names and project state, and the two
archives do not share a machine-checkable manifest or integrity check. A mistaken restore can
mix databases or overwrite the only local copy. No backup schedule or remote destination was
provided.

The owner will create one manifest-backed local snapshot and validate/restore it while Compose
writers are stopped. Restore into nonempty volumes requires an explicit replace option and a
separate safety backup.

## Flow

Reuse `scripts/docker.py`, the selected Compose project, both named volumes and Docker images;
use Python standard-library archive/hash support in the transcript image and host orchestration.

1. make docker-backup calls the existing launcher with a backup subcommand. It validates Docker,
Compose project name and output directory, and refuses if any service in this project is running.
2. For each existing Compose volume (transcript-data, library-data), a temporary container mounts the
volume read-only and writes a gzip tar stream to the host output directory. No volume is mounted
for write during creation.
3. The tool writes `manifest.json` with format version, Compose project, UTC creation time,
relative archive names, archive byte sizes and SHA-256 hashes. It validates the completed pair
before reporting success.
4. make docker-backup-verify BACKUP=<directory> validates exact file membership, manifest
shape, hashes, tar integrity and required data paths (`transcripts`, `lancedb`, `library.sqlite`).
5. make docker-restore BACKUP=<directory> verifies the entire snapshot before changing volumes,
requires Compose stopped, and requires both named volumes empty. `--replace` is an explicit
destructive option: it first creates and validates a safety snapshot of the current volumes and
requires typing the exact Compose project name.
6. Restore unpacks the transcript and library archives into their project volumes, fixes ownership
to the runtime UID/GID, validates the restored SQLite database opens and foreign keys pass, and
reports that the operator can run `make docker-up`.
7. The Docker guide documents privacy, project naming, stopped-writer requirement, verify and
restore commands, replacement semantics, and isolated fixture rehearsal.

## Impact

| Front | What changes |
| --- | --- |
| command | Add backup, verify and restore actions to the existing Python Docker launcher and Makefile; no host Node/npm is required. |
| stored data | Archives capture the full transcript data volume (including RAG index/model assets) and full library data volume (including SQLite/WAL sidecars) as one matched snapshot. |
| lifecycle | All Compose service writers must be stopped; the CLI refuses an active project instead of racing SQLite or transcript writes. |
| overwrite | Restore is non-destructive by default and requires empty volumes. Explicit replace saves a verified safety snapshot before extracting. |
| privacy | Transcripts, reading notes and vectors are private archives; permissions default to owner-only where supported. No archive is uploaded. Runtime `.env` files are not included because they live outside both data volumes. |
| compatibility | Manifest format is versioned; a restore validates project/volume set and runtime file structure before writes. |

## Relations

One Snapshot contains exactly one transcript volume archive and one library volume archive. Each
archive contains one named volume's full data tree. Snapshot is portable to the same Compose
project configuration, not an individual-file merge format.

## Surface

None - no new HTTP route is consumed outside the operator's host. The local command surfaces are:

- `make docker-backup` · optional `BACKUP_DIR`; default `.data/backups/<project>-<UTC timestamp>` · writes two archives, manifest and verified summary · exit 0 success, 1 validation/Docker/IO failure.
- `make docker-backup-verify BACKUP=<dir>` · verifies one snapshot directory · prints each archive verification without contents · exit 0 valid, 1 invalid/missing/changed archive.
- `make docker-restore BACKUP=<dir> [REPLACE=<project>]` · restores verified snapshot into empty volumes or uses an explicitly confirmed replacement · exit 0 restored, 1 validation/IO/Compose failure; nonempty without exact confirmation exits 1 before writes.

All output omits data content, environment values and secrets. Failure output names the operation
and safe path/reason without archive contents.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1: snapshot unit | A version-1 directory contains `transcript.tar.gz`, `library.tar.gz`, and `manifest.json`; manifest records project, UTC timestamp, sizes and SHA-256 for both archives. Both archives are required to validate. | Independent unpaired archives can restore library jobs against a different transcript/RAG generation. |
| 2: restore replacement | Default restores only into two empty named volumes. Replacement requires an automatic verified safety backup and exact project-name confirmation before clearing either volume. | Silent extraction into nonempty volumes can mix SQLite rows/WAL files and stale RAG artifacts. |
| 3: consistency boundary | Creation and restore require Compose stopped; the command never pauses only one writer or copies live SQLite files. | Live copying without SQLite backup API risks an incomplete WAL/database snapshot and unmatched RAG files. |

## Criteria

### S1: Create and validate a matched snapshot (P1)

**Acceptance Criteria**

1. WHEN backup is requested while any Compose service in the selected project is running THEN the command SHALL exit 1 before reading or writing volume data and print `Stop the Compose project before backup.`
2. WHEN the project is stopped and both volumes exist THEN backup SHALL create exactly the three version-1 files described in Landing and verify each archive before exit 0.
3. WHEN backup is invoked with no output directory THEN it SHALL choose `.data/backups/<project>-<UTC timestamp>` under the already Git-ignored `.data/` directory and SHALL fail rather than overwrite any existing directory.
4. WHEN `manifest.json` is written THEN each archive entry SHALL contain its relative filename, exact byte size and lowercase SHA-256; manifest version SHALL be integer 1 and volume list SHALL contain exactly `transcript-data` and `library-data`.
5. WHEN archives are created THEN the volume helper SHALL mount each source read-only and capture all paths including SQLite `-wal` and `-shm` sidecars, hidden files, transcript artifacts, RAG index and model assets.
6. IF either volume, Docker helper image or destination is unavailable/unwritable THEN command SHALL exit 1, leave pre-existing data untouched and clean temporary containers/files.
7. WHEN verify receives a valid snapshot THEN it SHALL check exact required file set, manifest schema, project name, sizes, SHA-256 values, tar readability and required path entries without extracting to live volumes.
8. IF any archive byte changes, file is missing, extra file appears, hash differs or tar is corrupt THEN verify SHALL exit 1 and name the failed relative file without printing its contents.
9. WHEN any backup operation prints status THEN output SHALL omit environment variables, API keys, transcript text, notes and model responses.
10. WHEN two backup processes target the same project concurrently THEN one SHALL fail before touching volumes and the other SHALL retain a consistent snapshot.

**Independent test:** Create disposable Docker volumes containing SQLite/WAL and marker files,
run backup and verification, then corrupt/remove/add archive files and prove each validation
failure before live volumes change.

### S2: Restore without mixing or losing the current snapshot (P1)

**Acceptance Criteria**

11. WHEN restore starts THEN it SHALL validate all manifest hashes and tar contents before the first volume write.
12. WHEN the project has running containers THEN restore SHALL exit 1 without stopping them or writing either volume.
13. WHEN both destination volumes are empty THEN restore SHALL extract both matched archives, set contents to runtime UID/GID 1000, open SQLite with foreign keys enabled, and pass `PRAGMA foreign_key_check` before exit 0.
14. IF either destination volume has any data and no exact project-name `REPLACE` value is supplied THEN restore SHALL exit 1 and leave both volumes unchanged.
15. WHEN exact `REPLACE=<project>` is supplied for nonempty destinations THEN restore SHALL first create and validate a safety snapshot of both current volumes; if this fails, it SHALL write neither replacement archive.
16. WHEN replacement proceeds THEN it SHALL clear and restore both volumes as a single guarded operation; if either extraction or database validation fails, it SHALL report failure and retain the safety snapshot path for operator recovery.
17. IF restored application data has unsupported/missing structure or SQLite references fail validation THEN restore SHALL exit 1 and SHALL NOT print transcript or note content.
18. WHEN restore succeeds THEN output SHALL state the project, validated snapshot path and next command `make docker-up`, without automatically starting services.
19. WHEN an archive belongs to another Compose project and replacement was not explicitly requested for the destination project THEN restore SHALL refuse it before writes.
20. WHEN the Docker guide documents backup/restore THEN it SHALL explain stopping Compose, archive sensitivity, manifest verification, empty-volume restore and explicit replace recovery.

**Independent test:** Restore valid archives into disposable empty volumes and compare their bytes;
attempt unsafe nonempty restore without confirmation; replace a populated fixture and verify the
safety snapshot permits recovery after an injected extraction failure.

## Out of scope

| Excluded | Why |
| --- | --- |
| Cloud, scheduled, encrypted or off-host backup | No provider, destination or key lifecycle was specified. |
| Live consistent snapshots | Requires coordinated per-service snapshot APIs and is a separate architecture. |
| Migrating host-development `.data` into Docker volumes | Existing guide documents explicit stopped-writer import separately. |
| Restoring into a new project name or merging one volume | These change credentials/network/configuration and break matched state assumptions. |
| Automated pruning/retention policy | Backup destination capacity and owner retention preferences are unknown. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Snapshot location | Local `.data/backups/` in current working directory, already ignored by Git; owner may pass another destination. | No external storage destination was authorized. | y — user delegated. |
| Project identity | Use the existing `DOCKER_PROJECT_NAME` and matched Compose volumes. | The current launcher already scopes all containers and volumes to that setting. | y — user delegated. |
| Restore precondition | Empty volumes by default; replace requires automatic safety snapshot and exact project name. | Avoid accidental mixing/deletion. | y — user delegated. |

**Open questions:** none - local-only destination and restore safeguards were delegated.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| backup command | output, defaults, flags and failure halfway | Surface; AC 1–10 |
| verify command | summary and nonzero failure conditions | Surface; AC 7–9 |
| restore command | empty/replacement behavior and exit result | Surface; AC 11–19 |
| Compose services | stopped-state requirement | Landing 3; AC 1, 12 |
| data collection | archive names, ordering, duplicates and required content | Landing 1; AC 2–8 |
| destructive restore | exact confirmation and recovery snapshot | Landing 2; AC 14–17 |
| backup document | English run steps, privacy and next action | AC 20 |
| screen/API/webhook | n/a - feature exposes only local commands and documentation |

## Sources

- Owner approved the scope and delegated plan decisions for all ten proposals on 2026-10-09.
- Existing Compose volumes and launcher behavior in [compose.yaml](../../../compose.yaml),
  [scripts/docker.py](../../../scripts/docker.py), and [docs/docker.md](../../../docs/docker.md).
- AD-010/011/016/017/019 in [project state](../../STATE.md); stopped-writer requirements in
  [running-all-services.md](../../../docs/running-all-services.md).
