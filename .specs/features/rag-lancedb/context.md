# RAG-native LanceDB Ingestion Context

**Gathered:** 2026-08-26
**Spec:** `.specs/features/rag-lancedb/spec.md`
**Status:** Approved through the specification approval on 2026-08-26

---

## Feature Boundary

This feature implements IMP-10 on top of the verified durable transcript store. It accepts a
completed durable transcript job, snapshots its verified JSON without repeating transcription,
chunks and embeds it locally, publishes one active document version to LanceDB, and exposes
authenticated hybrid retrieval with complete source provenance. It does not generate an answer or
call an LLM during ingestion/search.

The production boundary remains one Fastify service, one process, one Railway replica, and one
mounted Volume. A second Railway service cannot share the approved service-local Volume, so the
"separate ingestion service" described as a possible backlog outcome is implemented as a separate
application subsystem and worker inside the existing service.

---

## Confirmed Inputs

- The user approved Railway Volume/LanceDB as the RAG platform and wants to avoid additional paid
  model/API calls.
- The durable feature publishes verified immutable transcript JSON/PDF bundles under
  `/data/transcripts`; `/data/lancedb` is already reserved.
- Railway IaC already constrains the service to one replica and one 1024 MB Volume.
- The public transcript source contract contains the video/source metadata, full text, ordered
  segments, and timestamp precision needed for chunk provenance.
- The same owner-managed Bearer credential protects every expensive/content-bearing route.
- Transcript bundles expire after seven days; a RAG materialization must therefore own an
  independent lifecycle after it safely snapshots an eligible source.

---

## Recommended Product Decisions

### API and lifecycle

- Add four protected operations: submit ingestion, inspect ingestion, search, and delete document.
- Accept only a completed, unexpired durable `jobId`. Under the transcript artifact lock, copy the
  verified JSON into RAG staging before returning HTTP 202 so later transcript expiry cannot break
  accepted work.
- Persist `queued`, `processing`, `completed`, and `failed` ingestion states. Run exactly one FIFO
  ingestion worker and one document update at a time.
- Keep a published RAG document until explicit DELETE or atomic replacement. Do not apply the
  seven-day transcript TTL to the derived knowledge base and do not use a sliding RAG TTL.
- Retain terminal ingestion metadata for 24 hours and its expired tombstone for another 24 hours;
  this does not expire the independently published document.
- A cache hit reuses a retained completed ingestion resource; after that resource and tombstone are
  gone, it creates a fresh completed `hit` resource while preserving document/version identity.
  This keeps the returned status link valid without extending document retention.

### Retrieval

- Use local multilingual embeddings plus LanceDB full-text search and reciprocal-rank fusion.
  Automotive queries often combine Portuguese semantics with exact model, engine, year, and unit
  tokens, so both signals are part of the product contract.
- Return retrieved chunks and provenance only. The caller's existing agent remains responsible for
  answer generation, citations, and conversation behavior.
- Keep one active version per logical source. A replacement is built and verified before one atomic
  publication boundary; readers observe either the complete old version or the complete new one.

### Capacity and deletion

- Keep the approved 1 GB Volume initially. Reject new ingestion misses before shared free space
  falls below 128 MiB, while hit/join/status/search/delete remain available.
- Logical deletion is immediate for future search. LanceDB fragments and operator backups may
  retain old blocks until maintenance/backup retention removes them; secure erase is not promised.
- Do not create a database, object store, second Railway service, remote embedding credential, or
  additional paid provider.

---

## Proposed Technical Baseline (Design May Refine Internals)

- `@lancedb/lancedb@0.37.1` in local embedded mode under `/data/lancedb`.
- `@huggingface/transformers@4.2.0` with a pinned Transformers.js-compatible
  `multilingual-e5-small` ONNX int8 model, 384-dimensional normalized vectors, and the required
  `query:` / `passage:` prefixes.
- The exact model revision and every downloaded model file are pinned and SHA-256 verified during
  image build. Runtime model downloads and remote model access are disabled.
- A versioned token-aware chunk policy keeps each embedding input at or below 320 model tokens,
  including its prefix, and uses at most 48 tokens of deterministic preceding context.
- LanceDB stores chunk text, explicit vectors, active document/version identity, and enough
  repeated provenance to validate, retrieve, replace, and delete without another store.
- Search uses vector and Portuguese FTS candidates, reciprocal-rank fusion, and stable deterministic
  tie-breaking. Approximate-nearest-neighbor indexing is deferred until measured scale requires it.

These are implementable defaults, not permission to silently change the public requirements. Any
incompatible model/schema/dimension change requires a new physical index and an evaluated migration.

---

## Agent's Discretion

- Exact TypeScript class/file names, dependency-injection seams, private manifest fields, and lock
  implementation.
- Exact LanceDB table/index API calls, provided publication remains atomic and normal search never
  excludes recently committed rows.
- Batch scheduling and cooperative yielding within the fixed single-encoder/single-writer limits.
- Maintenance cadence for safe compaction and non-destructive index optimization.
- Fixture wording and fictional automotive values, provided the evaluation matrix and thresholds
  in the specification are met without representing fixtures as real-world vehicle advice.

---

## Declined / Undiscussed Gray Areas -> Assumptions

| Gray area | Assumption | Rationale |
| --------- | ---------- | --------- |
| Separate deployment service | Separate in-process subsystem, not a second Railway service | Railway Volumes are service-local and the approved design has no shared database/object store. |
| RAG retention | Persistent until DELETE or replacement | A seven/30-day automatic TTL would silently erase the owner's long-lived knowledge base. |
| Search mode | Hybrid vector + BM25/RRF | Exact automotive codes and semantic Portuguese paraphrases require complementary signals. |
| Version history | Exactly one active version per logical source | Retaining queryable history adds API/storage complexity without a stated user need. |
| Volume growth | Keep 1 GB and enforce a 128 MiB reserve | Avoids an unapproved infrastructure cost change while failing before the shared Volume is exhausted. |
| Readiness | RAG initialization/degradation makes `/ready` false; `/health` and transcript routes remain callable | Operators need a truthful whole-service readiness signal while existing handlers retain their own contracts. |
| Physical erasure | Immediate logical removal only | Embedded database versions/fragments and Railway backups cannot guarantee instant physical wipe. |

**Open questions:** none blocking. The user approved the specification and all defaults above on
2026-08-26; internal implementation choices remain subject to Design approval.

---

## Specific References

- User approval: Volume/LanceDB, subagents, implementation tools, and three execution batches.
- Execute test-correction authorization: a genuine mechanical test bug may be corrected without a
  new pause only when the specification outcome remains identical. Requirement/design changes,
  weakened/removed/skipped assertions, and remote actions remain excluded.
- Durable source contract: `.specs/features/durable-transcript-jobs/spec.md`.
- Production backlog: `.specs/features/railway-production-deploy/improvements.md` (IMP-10).
- LanceDB local/hybrid/FTS documentation and Transformers.js offline/model documentation were
  reviewed during discovery; exact URLs and pinned artifacts will be recorded in Design.

---

## Deferred Ideas

- Agent answer generation, prompt orchestration, reranking with an LLM, and conversational memory.
- Multiple replicas, distributed ingestion, LanceDB Cloud, Postgres/pgvector, or object storage.
- Automatic ingestion of every completed transcript, bulk import, crawling, and private videos.
- ANN indexes before the corpus size and measured latency justify them.
- Secure-erase/compliance workflows and automatic Railway backup lifecycle management.
- Queryable historical document versions and user/tenant-specific authorization.
