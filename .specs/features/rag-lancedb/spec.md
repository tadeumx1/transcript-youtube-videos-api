# RAG-native LanceDB Ingestion Specification

**Status:** Approved on 2026-08-26

## Problem Statement

The API can durably produce verified transcript JSON/PDF artifacts, but an automotive agent still
cannot retrieve grounded source passages without an operator manually chunking, embedding, and
indexing those artifacts. The system needs a local, reproducible RAG ingestion and retrieval
contract that never repeats transcription, never consumes another paid model API, preserves source
provenance, and remains safe on the approved single Railway Volume.

## Goals

- [ ] Ingest a completed durable transcript asynchronously without YouTube, media, Muse, PDF, or LLM calls.
- [ ] Produce deterministic, token-bounded chunks with exact text coverage and timestamp provenance.
- [ ] Generate pinned multilingual embeddings entirely inside the application image at runtime.
- [ ] Publish idempotent, atomic document versions to local LanceDB.
- [ ] Expose authenticated hybrid retrieval suitable for Portuguese Brazilian automotive questions.
- [ ] Provide explicit deletion, recovery, capacity, readiness, metrics, and privacy behavior.
- [ ] Gate the implementation with unit, integration, container, restart, and real offline retrieval evaluation.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| LLM answer generation or agent orchestration | This feature returns grounded retrieval results; the user's agent composes answers. |
| Re-transcription, YouTube access, media extraction, Muse, or PDF rendering during RAG work | The verified durable JSON is the only ingestion source. |
| Automatic ingestion of every transcript | Explicit submission bounds CPU/disk use and makes knowledge-base membership intentional. |
| Paid/remote embeddings, rerankers, LanceDB Cloud, or another database | The approved goal is local operation without new API spend. |
| A second Railway service or multiple replicas | The approved Volume is service-local and supports one writer/replica. |
| Queryable historical versions | Exactly one complete active version per logical source is sufficient and bounded. |
| Automatic RAG document TTL | Knowledge remains until explicit deletion or replacement; source-artifact TTL is independent. |
| Secure physical erasure from database fragments/backups | DELETE guarantees logical search removal; storage maintenance/backup retention is operational. |
| Private/restricted video access, crawling, bulk import, OCR, or PDF parsing | Sources are existing completed public-video transcript jobs. |
| Model fine-tuning or factual automotive evaluation | The evaluation measures retrieval behavior on authored fixtures, not truth of vehicle claims. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Deployment boundary | RAG subsystem and worker inside the existing Fastify service | A separate Railway service cannot share the approved Volume. | yes, approved with spec on 2026-08-26 |
| Vector store | Embedded LanceDB under `RAG_DATA_ROOT`, production `/data/lancedb` | User approved Volume/LanceDB and no new provider spend. | yes, approved before and with spec |
| Embeddings | Pinned multilingual E5-compatible 384-dimension ONNX int8 model, packaged in image and offline at runtime | Supports Portuguese locally and makes output versionable/reproducible. | yes, approved with spec on 2026-08-26 |
| Retrieval | Hybrid cosine vector + Portuguese BM25 combined by reciprocal-rank fusion | Covers semantic paraphrases and exact automotive codes/units. | yes, approved with spec on 2026-08-26 |
| Ingestion API | Explicit async ingestion by completed durable `jobId` | Bounds work and guarantees no retranscription. | yes, approved with spec on 2026-08-26 |
| Document lifecycle | Persist until explicit DELETE or atomic replacement | An automatic short TTL would erase a long-lived knowledge base. | yes, approved with spec on 2026-08-26 |
| Version history | One active version per logical source | Prevents duplicate/outdated passages and bounds storage. | yes, approved with spec on 2026-08-26 |
| Volume | Keep 1024 MB, reserve at least 128 MiB free | Avoids an unapproved cost change and protects transcript storage from exhaustion. | yes, approved with spec on 2026-08-26 |
| Public API | Four protected operations under `/v1/rag`; OpenAPI `1.2.0` | Additive surface with the existing Bearer and error envelope. | yes, approved with spec on 2026-08-26 |
| Retrieval limits | query 1-1000 Unicode code points; `topK` default 5, range 1-20 | Bounds tokenizer/search work while supporting normal questions. | yes, approved with spec on 2026-08-26 |

**Open questions:** none blocking. The user explicitly approved this specification on 2026-08-26;
exact components, schemas, pinned hashes, and migration mechanics are frozen in Design.

---

## User Stories

### P1: Submit a verified transcript for local ingestion ⭐ MVP

**User Story**: As the knowledge-base owner, I want to submit a completed transcript job once so
that it becomes retrievable without downloading or transcribing the video again.

**Why P1**: The durable artifact is the trusted boundary between expensive transcription and local
RAG processing.

**Acceptance Criteria**:

1. **ING-01** WHEN an authenticated client posts exactly `{ "jobId": "<uuid>" }` to `POST /v1/rag/ingestions` for a completed, unexpired job THEN the system SHALL return HTTP 202 with `Location`, `Retry-After: 2`, and a resource containing exactly `ingestionId`, `documentId`, `status`, `disposition`, `createdAt`, `updatedAt`, `expiresAt`, and relative status/document links.
2. **ING-02** WHEN a new ingestion miss is accepted THEN the system SHALL verify the source manifest/checksum and atomically snapshot only its transcript JSON under the source artifact lock before persisting `queued` and responding.
3. **ING-03** WHEN an ingestion begins or recovers THEN it SHALL read only that verified local snapshot and SHALL make zero calls to YouTube, caption/media providers, Muse/OpenCode, PDF rendering, an LLM, a remote model registry, or another network dependency.
4. **ING-04** WHEN a retained ingestion is read through `GET /v1/rag/ingestions/{ingestionId}` THEN the system SHALL return HTTP 200 with `queued`, `processing`, `completed`, or `failed`, its timestamps, document link, and only an allowlisted fixed public failure code/message when failed.
5. **ING-05** WHEN the source job is queued/processing, failed, unknown, expired, or storage-corrupt/unavailable THEN submission SHALL reuse respectively `JOB_NOT_COMPLETED`, `JOB_FAILED`, `JOB_NOT_FOUND`, `JOB_EXPIRED`, or `JOB_STORAGE_UNAVAILABLE` and SHALL create no ingestion, snapshot, chunk, or vector.
6. **ING-06** WHEN an ingestion record is unknown THEN status SHALL return HTTP 404 `RAG_INGESTION_NOT_FOUND`; WHEN its 24-hour terminal retention elapsed but its 24-hour tombstone remains THEN status SHALL return HTTP 410 `RAG_INGESTION_EXPIRED`.
7. **ING-07** WHEN application startup finishes THEN exactly one FIFO RAG worker SHALL reconcile persisted work and become eligible to claim queued ingestions before RAG readiness becomes true.
8. **ING-08** WHEN shutdown begins THEN readiness SHALL become false, new RAG claims SHALL stop, active local embedding SHALL abort at a batch boundary, and queued/processing state plus its source snapshot SHALL remain recoverable.

**Independent Test**: Use a real temporary durable/RAG filesystem and fake local encoder/index to
exercise source states, atomic snapshot failure, exact responses, FIFO processing, zero forbidden
calls, shutdown, and restart recovery.

---

### P1: Deduplicate and atomically version documents ⭐ MVP

**User Story**: As the knowledge-base owner, I want repeat ingestion to be idempotent and updates to
replace old content atomically so that retrieval never contains duplicated or partial versions.

**Why P1**: RAG quality and storage safety depend on exactly one complete active view per source.

**Acceptance Criteria**:

1. **VER-01** WHEN identities are calculated THEN `documentId` SHALL be a SHA-256 identity derived from the source cache identity and RAG schema, while `versionId` SHALL include transcript checksum, chunk-policy version, embedding model fingerprint, and index-schema version without exposing any hash preimage.
2. **VER-02** WHEN concurrent submissions have the same document/version identity THEN exactly one SHALL persist new work with `miss`, every other caller SHALL receive the same ingestion/document IDs with `joined`, and exactly one chunk/embed/publication execution SHALL be eligible.
3. **VER-03** WHEN the requested version is already active THEN submission SHALL return HTTP 202 with `hit`, preserve the existing document/version identity, return the retained completed ingestion resource when it still exists or create a new completed hit resource when it expired, and SHALL perform zero source snapshot, chunking, embedding, or index mutation.
4. **VER-04** WHILE another version of the same document is queued or processing, WHEN an update is submitted THEN the system SHALL return HTTP 409 `RAG_DOCUMENT_UPDATE_IN_PROGRESS` with `Retry-After: 2` and SHALL not replace or queue duplicate work.
5. **VER-05** WHEN a transcript or versioned policy changes THEN the system SHALL fully build and validate the replacement before publication and SHALL keep the prior complete version searchable until the replacement commits.
6. **VER-06** WHEN replacement publication commits THEN all new chunks SHALL become active and every old chunk for that document SHALL become inactive in one reader-visible boundary; searches SHALL observe the complete old version or complete new version, never partial/mixed versions.
7. **VER-07** IF snapshot, chunking, embedding, validation, or publication fails THEN the ingestion SHALL become failed with an allowlisted reason, staging SHALL never be searchable, and any prior active version SHALL remain unchanged.
8. **VER-08** WHEN startup finds queued, processing, or staging work THEN it SHALL retry only deterministic local work from the verified snapshot, collapse duplicate ownership deterministically, and SHALL never infer success from incomplete publication.

**Independent Test**: Race identical/different submissions, inject a failure at every boundary,
restart from every persisted state, and issue concurrent searches proving single work, stable IDs,
old-or-new visibility, and preserved prior versions.

---

### P1: Produce deterministic chunks and offline embeddings ⭐ MVP

**User Story**: As an automotive agent developer, I want reproducible chunks with precise source
links so that retrieved context can be cited and reindexed safely.

**Why P1**: Omitted text, model truncation, or invented timestamp precision makes retrieval unsafe.

**Acceptance Criteria**:

1. **CHUNK-01** WHEN a transcript is chunked THEN a named/versioned deterministic policy SHALL preserve its exact source string as ordered non-overlapping core spans whose concatenation byte-for-byte reconstructs `Transcript.text`.
2. **CHUNK-02** WHEN chunk boundaries are selected THEN the policy SHALL prefer ordered segment boundaries, split oversized spans only at deterministic Unicode-safe boundaries, and never reorder or discard non-empty source characters.
3. **CHUNK-03** WHEN a chunk embedding input is formed THEN `passage: ` plus overlap and core text SHALL contain at most 320 tokens under the pinned tokenizer, prior context overlap SHALL contain at most 48 tokens, and model truncation SHALL never be relied upon.
4. **CHUNK-04** WHEN a chunk is persisted THEN it SHALL include a deterministic checksum/ID, ordinal/count, exact core character offsets, overlap offsets, covered segment range, nullable start/end seconds, and original `timestampPrecision` without synthesizing finer timestamps.
5. **CHUNK-05** WHEN source provenance is persisted THEN every chunk SHALL retain `videoId`, `sourceUrl`, transcript source, language, `isGenerated`, `extractedAt`, source job/artifact/cache identity, transcript checksum, and schema/chunk/model versions needed to audit the materialization.
6. **CHUNK-06** IF the source exceeds 5,000,000 Unicode code points or produces more than 5,000 chunks THEN ingestion SHALL fail with allowlisted `RAG_SOURCE_TOO_LARGE` before publication and SHALL not activate partial vectors.
7. **EMB-01** WHEN the service builds or starts THEN model repository/revision/dtype/dimension and every required artifact SHA-256 SHALL match a checked-in manifest; a mismatch or missing artifact SHALL fail closed without download fallback.
8. **EMB-02** WHEN runtime initializes or encodes THEN remote-model access SHALL be disabled, the encoder SHALL use exactly `query: ` and `passage: ` prefixes with mean pooling and L2 normalization, and no API key or network credential SHALL be required.
9. **EMB-03** WHEN an embedding is accepted THEN it SHALL contain exactly 384 finite float values with norm within the designed tolerance and the current model fingerprint; invalid output SHALL fail the ingestion/search closed.
10. **EMB-04** WHILE ingestion runs THEN one local encoder permit SHALL process batches of at most 8 and yield between batches so bounded authenticated searches can run without a second model instance.

**Independent Test**: Snapshot chunk IDs/offsets for multilingual, empty, whitespace, 319/320/321,
511/512/513-token, huge-segment, emoji, accents, and coarse-Muse fixtures; verify exact coverage,
overlap, prefixes, dimensions/norms, determinism, abort behavior, and offline model enforcement.

---

### P1: Retrieve automotive passages with hybrid search ⭐ MVP

**User Story**: As an automotive AI agent, I want relevant Portuguese passages plus complete
provenance so that I can ground an answer without receiving another model-generated answer.

**Why P1**: Semantic similarity alone can miss exact engine/model/year tokens, while lexical search
alone can miss paraphrases.

**Acceptance Criteria**:

1. **SEARCH-01** WHEN an authenticated client posts a strict body containing `query`, optional `topK`, and optional `documentIds` to `POST /v1/rag/search` THEN the system SHALL validate the trimmed query as 1-1000 Unicode code points, `topK` as integer 1-20 default 5, and at most 50 unique SHA-256 document IDs before encoder/index access.
2. **SEARCH-02** WHEN a valid search executes THEN it SHALL combine normalized-vector similarity and Portuguese full-text candidates with reciprocal-rank fusion, consider at most 100 fused candidates, and return at most `topK` active chunks.
3. **SEARCH-03** WHEN results have equal fused rank/score THEN ordering SHALL use deterministic document, version, and chunk-ordinal tie-breakers; repeated searches over unchanged data SHALL return identical result IDs/order.
4. **SEARCH-04** WHEN search succeeds THEN HTTP 200 SHALL return `results` only, with each item containing rank, finite score, chunk/document/version IDs, text, core/segment/timestamp ranges, and the source provenance defined by CHUNK-05, and SHALL not echo the query or expose vectors/internal paths.
5. **SEARCH-05** WHEN no active document matches, a document filter is unknown/deleted, or the index is empty THEN a valid search SHALL return HTTP 200 with `results: []` without revealing which filtered ID was absent.
6. **SEARCH-06** WHEN four searches already hold the configured search capacity THEN another valid search SHALL return HTTP 429 `RAG_SEARCH_CAPACITY_EXCEEDED` with `Retry-After: 5` before encoding/index access.
7. **SEARCH-07** IF the model, schema, dimension, index, or RAG storage is unavailable/incompatible/corrupt THEN search SHALL fail closed with sanitized HTTP 503 `RAG_MODEL_UNAVAILABLE` or `RAG_STORAGE_UNAVAILABLE` and SHALL never silently rebuild, migrate, download, or fall back to remote search.
8. **SEARCH-08** WHEN ingestion and search compete for the encoder THEN admitted searches SHALL run between bounded ingestion batches without interrupting an in-flight batch or permitting unbounded search starvation of the FIFO worker.

**Independent Test**: Exercise schema/bounds/auth before dependencies, exact empty/filter behavior,
hybrid ranking/ties, four-way capacity, search/ingestion scheduling, corrupt fingerprints, response
provenance, redaction, and unchanged repeated result order against real LanceDB where relevant.

---

### P1: Delete and operate the local RAG store safely ⭐ MVP

**User Story**: As the API owner, I want explicit lifecycle and bounded storage behavior so that RAG
does not exhaust the shared Volume or retain searchable content after deletion.

**Why P1**: The embedded index shares finite durable storage with transcript jobs and has no external
operator enforcing lifecycle.

**Acceptance Criteria**:

1. **LIFE-01** WHEN an authenticated client deletes a strict SHA-256 `documentId` through `DELETE /v1/rag/documents/{documentId}` THEN the system SHALL return HTTP 204 for an existing active document and SHALL make all its chunks immediately absent from later vector, lexical, and hybrid searches.
2. **LIFE-02** WHEN DELETE targets an unknown/already-deleted document THEN it SHALL return HTTP 404 `RAG_DOCUMENT_NOT_FOUND` without revealing index internals; malformed IDs SHALL fail validation before storage access.
3. **LIFE-03** WHEN DELETE races ingestion, replacement, search, or maintenance THEN the document publication lock/read boundary SHALL prevent resurrection or partial results; the delete SHALL observe/produce one serializable outcome.
4. **LIFE-04** WHEN a RAG document is deleted or replaced THEN source job records and transcript/PDF artifacts SHALL remain unchanged; WHEN the original artifact expires THEN an active RAG document and its stored provenance SHALL remain searchable.
5. **LIFE-05** WHEN logical deletion completes THEN documentation SHALL state that old database fragments and Railway backups may retain blocks until compaction/retention removes them and SHALL not promise immediate physical secure erase.
6. **LIFE-06** WHEN RAG terminal metadata reaches 24 hours THEN it SHALL be replaced by a content-free 24-hour tombstone and then removed, while completed document lifecycle remains independent and non-sliding.
7. **CAP-01** WHEN a new ingestion miss would begin THEN the system SHALL verify at least 134,217,728 bytes remain free under the shared mount; otherwise it SHALL return HTTP 507 `RAG_STORAGE_CAPACITY_EXCEEDED` before snapshot/work, while hit, joined, status, search, and delete remain callable.
8. **CAP-02** WHEN 25 queued RAG ingestions already exist THEN a new miss SHALL return HTTP 429 `RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED` with `Retry-After: 30` before snapshot/record creation, while hit and joined submissions SHALL still return HTTP 202.

**Independent Test**: Race deletion with every document state, expire the source independently,
drive terminal retention/tombstones with a fake clock, inject disk thresholds, and prove immediate
logical absence plus continued hit/join/status/search/delete behavior at each capacity boundary.

---

### P2: Publish production contracts and retrieval evidence

**User Story**: As the operator, I want truthful health, bounded telemetry, executable API docs, and
an offline retrieval gate so that the local RAG service is deployable and measurable.

**Why P2**: Native dependencies, a packaged model, and persistent indexes need stronger evidence
than mocked unit tests.

**Acceptance Criteria**:

1. **OPS-01** WHEN configuration loads THEN `RAG_DATA_ROOT` (default `.data/lancedb`), queue/search limits, source/chunk limits, batch size, terminal TTLs, sweep interval, and 128 MiB free-space reserve SHALL use documented strict bounds and sanitized variable-name-only errors.
2. **OPS-02** WHEN Railway IaC is inspected THEN it SHALL preserve one service/replica and the existing 1024 MB Volume, declare `RAG_DATA_ROOT=/data/lancedb`, package the pinned model in the Docker image, and add no service, database, bucket, remote-model secret, or public RAG credential.
3. **OPS-03** WHEN startup completes THEN `/ready` SHALL return 200 only after transcript storage, LanceDB schema/fingerprint validation, local model warmup, reconciliation, and both workers are ready; `/health` SHALL remain public/network-free.
4. **OPS-04** IF the RAG store/model/worker degrades THEN `/ready` SHALL return the existing exact 503 body, RAG content operations SHALL fail with fixed sanitized errors, and `/health` plus existing transcript/job handlers SHALL remain callable under their existing contracts.
5. **OPS-05** WHEN metrics are rendered THEN they SHALL expose fixed-label ingestion disposition/state/duration/failure, active documents/chunks, index/storage health, search count/duration/result-count/capacity, and maintenance outcomes without query, text, vectors, URLs, IDs, language, paths, credentials, model input, or external messages.
6. **OPS-06** WHEN logs, public errors, or persisted failures cover RAG THEN they SHALL use fixed allowlisted events/outcomes/reasons and SHALL exclude query/result/chunk/transcript/vector content, video/document/job/cache IDs, URLs, filesystem/model paths, credentials, stacks, provider bodies, and nested causes.
7. **OPS-07** WHEN OpenAPI is generated THEN additive version `1.2.0` SHALL describe all four RAG operations, strict request/response schemas, Bearer security, headers, statuses, and error codes while retaining route/schema/security parity for every existing operation.
8. **OPS-08** WHEN the real offline retrieval evaluation runs THEN one authored/versioned Portuguese Brazilian automotive fixture SHALL contain at least 12 documents and 48 qrel questions covering exact codes, semantic paraphrases, model/year/fuel disambiguation, accents/typos, and numbers/units.
9. **OPS-09** WHEN that evaluation completes without network or credentials THEN hybrid retrieval SHALL achieve Recall@5 >= 0.90, MRR@10 >= 0.80, nDCG@10 >= 0.85, exact/numeric Recall@3 >= 0.95, semantic Recall@5 >= 0.85, accents/typos Recall@5 >= 0.80, and zero wrong model/year top-1 results in the disambiguation subset.
10. **OPS-10** WHEN the validation gate runs THEN it SHALL include unit/integration suites, real LanceDB restart/delete/replacement tests, pinned-model golden-vector checks, three-run deterministic retrieval IDs/ranks, runtime network denial, Linux container smoke/build, OpenAPI parity, dependency audit, and the repository's existing quality/mutation gates.

**Independent Test**: Parse config/OpenAPI/IaC, inject every readiness/telemetry failure, inspect
labels and sanitized output, then run the real packaged model and LanceDB evaluation offline inside
the production Linux image.

---

## Edge Cases

- **EDGE-01** IF authentication is missing/invalid or `API_ACCESS_KEY` is unconfigured THEN the existing auth error SHALL occur before parsing a RAG body/ID or accessing jobs, snapshots, model, index, or filesystem.
- **EDGE-02** IF a source artifact expires while submission holds its artifact lock THEN submission SHALL either complete one verified atomic snapshot or return the post-expiry source error, never enqueue a dangling reference.
- **EDGE-03** IF a process dies after staging/vector generation but before active publication THEN restart SHALL keep staging invisible and safely retry local work or fail without retranscription.
- **EDGE-04** IF a process dies after atomic publication but before marking ingestion completed THEN restart SHALL verify the active version and complete metadata without rebuilding vectors.
- **EDGE-05** IF a replacement contains fewer chunks than the old version THEN publication SHALL remove every surplus old chunk from all search modes in the same visibility boundary.
- **EDGE-06** IF a chunk contains no usable non-whitespace embedding input THEN it SHALL remain covered by exact core offsets but SHALL be deterministically attached to adjacent usable content or fail the all-empty document with `RAG_SOURCE_UNAVAILABLE`, never create NaN/empty vectors.
- **EDGE-07** IF a stored model/index fingerprint differs from the running schema/model/dimension THEN startup/search SHALL fail closed and preserve files for an explicit evaluated migration.
- **EDGE-08** IF index optimization/compaction runs THEN it SHALL serialize with mutations, preserve active search results, avoid unsafe deletion without a successful backup policy, and never use a search mode that omits newly committed rows.
- **EDGE-09** IF disk capacity becomes insufficient after admission THEN the ingestion SHALL fail sanitized, preserve any prior version, remove bounded staging when safe, and make readiness reflect storage degradation.
- **EDGE-10** IF timestamps are missing or coarse (including Muse block precision) THEN results SHALL return nullable/coarse provenance exactly and SHALL not interpolate or claim segment-level precision.

---

## Implicit Dimensions Sweep

| Dimension | Resolution / requirement coverage |
| --------- | --------------------------------- |
| Input validation and bounds | Strict bodies/IDs and query/topK/filter/source/chunk/queue/search/batch/free-space bounds in ING-01, SEARCH-01, CHUNK-06, CAP-01/02, OPS-01, EDGE-01. |
| Failure and partial failure | Snapshot-before-acceptance, invisible staging, prior-version preservation, fixed errors, crash boundaries in ING-02/05, VER-05/07/08, SEARCH-07, EDGE-02/03/04/09. |
| Idempotency and duplicates | Versioned IDs, miss/joined/hit, one update, one active version in VER-01 through VER-06. |
| Authentication and rate limits | Existing Bearer runs first; one owner token makes per-user quota N/A; bounded queue/search/encoder in EDGE-01, CAP-02, SEARCH-06, EMB-04. |
| Concurrency and ordering | FIFO single worker/writer, per-document publication lock, bounded search, old-or-new read boundary in ING-07/08, VER-02/04/06, SEARCH-08, LIFE-03. |
| Lifecycle and retention | Independent persistent document, explicit DELETE/replacement, terminal metadata/tombstone, source independence, logical/physical deletion distinction in LIFE-01 through LIFE-06. |
| Observability and privacy | Fixed low-cardinality metrics, content/identifier-free logs/errors, readiness boundaries in OPS-03 through OPS-06. |
| External dependency degradation | No runtime network/provider; model/LanceDB fingerprint failures fail closed without mutation/fallback in ING-03, EMB-01/02, SEARCH-07, OPS-04, EDGE-07. |
| State-transition integrity | Persist-before-response/claim, guarded replacement/delete, restart reconciliation, shutdown recovery in ING-02/07/08, VER-05 through VER-08, LIFE-03, EDGE-03/04. |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| ING-01 | Submit verified transcript | T18, T20 | In Progress |
| ING-02 | Submit verified transcript | T10, T13, T18 | In Progress |
| ING-03 | Submit verified transcript | T10-T11, T17 | In Progress |
| ING-04 | Submit verified transcript | T2, T13, T18, T20 | In Progress |
| ING-05 | Submit verified transcript | T10-T11, T18, T20 | In Progress |
| ING-06 | Submit verified transcript | T2, T13, T18, T20 | In Progress |
| ING-07 | Submit verified transcript | T13, T17-T18, T21-T22 | In Progress |
| ING-08 | Submit verified transcript | T7, T9, T17-T18, T21-T22 | In Progress |
| VER-01 | Idempotent atomic versions | T2, T13, T18 | In Progress |
| VER-02 | Idempotent atomic versions | T13, T18 | In Progress |
| VER-03 | Idempotent atomic versions | T13, T18 | In Progress |
| VER-04 | Idempotent atomic versions | T13, T18, T20 | In Progress |
| VER-05 | Idempotent atomic versions | T15, T17 | In Progress |
| VER-06 | Idempotent atomic versions | T8, T15-T17 | In Progress |
| VER-07 | Idempotent atomic versions | T15, T17 | In Progress |
| VER-08 | Idempotent atomic versions | T13, T17-T18 | In Progress |
| CHUNK-01 | Deterministic chunks/embeddings | T6, T17 | In Progress |
| CHUNK-02 | Deterministic chunks/embeddings | T6, T17 | In Progress |
| CHUNK-03 | Deterministic chunks/embeddings | T6, T14, T17 | In Progress |
| CHUNK-04 | Deterministic chunks/embeddings | T2, T6, T15 | In Progress |
| CHUNK-05 | Deterministic chunks/embeddings | T2, T6, T15 | In Progress |
| CHUNK-06 | Deterministic chunks/embeddings | T3, T6, T17 | In Progress |
| EMB-01 | Deterministic chunks/embeddings | T1, T4, T5, T14, T24 | In Progress |
| EMB-02 | Deterministic chunks/embeddings | T5, T14, T24 | In Progress |
| EMB-03 | Deterministic chunks/embeddings | T4, T14, T17 | In Progress |
| EMB-04 | Deterministic chunks/embeddings | T3, T7, T17 | In Progress |
| SEARCH-01 | Hybrid retrieval | T16, T20 | In Progress |
| SEARCH-02 | Hybrid retrieval | T15-T16 | In Progress |
| SEARCH-03 | Hybrid retrieval | T15-T16 | In Progress |
| SEARCH-04 | Hybrid retrieval | T16, T20 | In Progress |
| SEARCH-05 | Hybrid retrieval | T15-T16 | In Progress |
| SEARCH-06 | Hybrid retrieval | T3, T9, T16, T20 | In Progress |
| SEARCH-07 | Hybrid retrieval | T4, T12, T14-T16, T18, T21 | In Progress |
| SEARCH-08 | Hybrid retrieval | T7, T9, T16-T17 | In Progress |
| LIFE-01 | Delete/operate safely | T15, T18, T20 | In Progress |
| LIFE-02 | Delete/operate safely | T15, T18, T20 | In Progress |
| LIFE-03 | Delete/operate safely | T8, T15, T17-T18 | In Progress |
| LIFE-04 | Delete/operate safely | T15, T18 | In Progress |
| LIFE-05 | Delete/operate safely | Specify | Proposed |
| LIFE-06 | Delete/operate safely | T13, T18, T20 | In Progress |
| CAP-01 | Delete/operate safely | T3, T13, T18, T26 | In Progress |
| CAP-02 | Delete/operate safely | T3, T13, T18, T26 | In Progress |
| OPS-01 | Production/evaluation | T3, T27 | In Progress |
| OPS-02 | Production/evaluation | Specify | Proposed |
| OPS-03 | Production/evaluation | T18, T21-T22, T27 | In Progress |
| OPS-04 | Production/evaluation | T18, T21-T22, T27 | In Progress |
| OPS-05 | Production/evaluation | Specify | Proposed |
| OPS-06 | Production/evaluation | T2, T12, T16, T19-T21, T27 | In Progress |
| OPS-07 | Production/evaluation | Specify | Proposed |
| OPS-08 | Production/evaluation | Specify | Proposed |
| OPS-09 | Production/evaluation | Specify | Proposed |
| OPS-10 | Production/evaluation | T1, T5, T24, T25, T27 | In Progress |
| EDGE-01 | Authentication order | Specify | Proposed |
| EDGE-02 | Source-expiry race | T10-T11, T18 | In Progress |
| EDGE-03 | Pre-publication crash | T13, T17 | In Progress |
| EDGE-04 | Post-publication crash | T13, T17 | In Progress |
| EDGE-05 | Smaller replacement | T15, T17 | In Progress |
| EDGE-06 | Empty/whitespace source | T6, T17 | In Progress |
| EDGE-07 | Fingerprint mismatch | T4, T12, T14-T15 | In Progress |
| EDGE-08 | Maintenance visibility | T8, T15, T17 | In Progress |
| EDGE-09 | Post-admission capacity | T13, T17-T18 | In Progress |
| EDGE-10 | Coarse/missing timestamps | T6, T15-T17 | In Progress |
