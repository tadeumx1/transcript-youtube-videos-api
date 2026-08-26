# Durable Transcript Jobs and Artifact Cache Context

**Gathered:** 2026-08-26
**Spec:** `.specs/features/durable-transcript-jobs/spec.md`
**Status:** Approved through the specification approval on 2026-08-26

---

## Feature Boundary

This feature implements IMP-03 and IMP-04. It adds durable asynchronous transcript jobs, an
authenticated polling/result API, persistent JSON/PDF artifacts, deduplication, fixed retention,
restart recovery, synchronous cache reuse, bounded queueing, metrics, readiness, OpenAPI, and the
Railway Volume declaration. LanceDB, embeddings, chunking, and retrieval remain in IMP-10.

---

## Implementation Decisions

### API and client lifecycle

- Keep the existing synchronous JSON and PDF endpoints compatible.
- Add four protected job operations: submit, status, transcript result, and PDF result.
- Return HTTP 202 for new, joined, and cache-hit submissions, with one polling contract and exact
  `Location`/`Retry-After` headers.
- A client disconnect after submission does not cancel durable work.
- Job cancellation, priority, per-user ownership, and an `Idempotency-Key` header remain out of
  scope. Canonical video/language identity provides the required deduplication.

### State, failure, and restart behavior

- Persist `queued`, `processing`, `completed`, and `failed` states with guarded revisions.
- Never retry a failed or uncertain external call automatically.
- On restart, a complete bundle becomes completed; a transcript-only artifact gets only its PDF;
  processing without a verified transcript becomes failed `JOB_INTERRUPTED`.
- Public/persisted failures contain only an allowlisted code and fixed message.
- The worker shares the existing application-owned execution limit and `AbortSignal` lifecycle.

### Cache identity and retention

- Compute a versioned SHA-256 key from canonical video ID and ordered canonical BCP-47 languages.
- Omitted languages equal `pt-BR`, `pt`, `en`; case is normalized; order remains meaningful;
  duplicates after normalization are invalid.
- Reuse the same producer job for active/completed equivalent submissions.
- Cache only successful transcript/PDF artifacts. Failures are never cache entries.
- Completed content expires seven days after publication without sliding access renewal.
- Failed records remain 24 hours, followed by a 24-hour tombstone that supports HTTP 410.
- Existing synchronous routes reuse verified completed content but do not join an active durable
  producer, preserving their request-owned cancellation contract.

### Persistence and Railway

- Use versioned application-owned files, not SQLite, Redis, Postgres, or object storage.
- Publish through same-filesystem temp, sync, rename, manifest, and cache-pointer ordering.
- Verify sizes/checksums; quarantine corrupt/partial data without logging content.
- Run exactly one replica and one worker against one 1024 MB Railway Volume mounted at `/data`.
- Store this feature under `/data/transcripts`; reserve `/data/lancedb` for IMP-10.
- Keep the durable queue bounded at 100 by default; evaluate hit/join before rejecting a miss.

### Agent's Discretion

- Exact TypeScript interface/file names and private versioned JSON field layout.
- Internal lock and capacity-wakeup implementation, provided it does not poll or inflate rejection
  metrics.
- Directory sharding details, bounded sweep scheduling, and failure-injection seams for tests.
- How storage health is probed locally without a network call.

### Declined / Undiscussed Gray Areas -> Assumptions

The user approved the full specification and its defaults on 2026-08-26. No listed gray area was
declined. Reversible operational values stay configurable within the spec's strict bounds.

---

## Specific References

- User approved: "Aprovo a spec de durable-transcript-jobs."
- Earlier user approval fixed the Railway Volume/LanceDB direction and use of subagents.
- The user wants to avoid additional transcription/LLM API spend; conservative recovery therefore
  takes precedence over automatic retry convenience.

---

## Deferred Ideas

- IMP-10: local multilingual embeddings, LanceDB ingestion, provenance, deletion, and retrieval
  evaluation for Brazilian vehicle questions.
- Multiple replicas or a separate ingestion service would require shared transactional/object
  storage and a new architecture decision.
