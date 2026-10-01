# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Assert every resource-cleanup conjunct directly, including removal of caller-owned AbortSignal listeners.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `process-runner` · harmful: 0
- features: production-runtime-hardening
- evidence: PROC-04 (process-runner)
- last seen: 2026-08-26T20:38:32Z

### L-002 - Process-runner mutation tests must remove each cleanup action independently and fail on retained listeners.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `process-runner` · harmful: 0
- features: production-runtime-hardening
- evidence: M10 (process-runner)
- last seen: 2026-08-26T20:38:32Z

### L-003 - Assert that source and container gate steps omit failure-tolerating controls such as continue-on-error.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `ci` · harmful: 0
- features: production-runtime-hardening
- evidence: CI-05 (ci)
- last seen: 2026-08-26T20:38:32Z

### L-004 - CI contract mutation tests must fail when a required gate is made non-blocking.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ci` · harmful: 0
- features: production-runtime-hardening
- evidence: M12 (ci)
- last seen: 2026-08-26T20:38:33Z

### L-005 - Assert that every diagnostic command which can return user content explicitly discards its response body.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `runbook` · harmful: 0
- features: production-runtime-hardening
- evidence: OPS-02 (runbook)
- last seen: 2026-08-26T20:38:33Z

### L-006 - Runbook contract tests must fail when a transcript diagnostic stops suppressing response output.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `runbook` · harmful: 0
- features: production-runtime-hardening
- evidence: M9 (runbook)
- last seen: 2026-08-26T20:38:33Z

### L-007 - Assert prohibited external calls in every recovery branch, not only complete and missing branches
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `jobs` · harmful: 0
- features: durable-transcript-jobs
- evidence: M09 (jobs)
- last seen: 2026-08-26T23:27:05Z

### L-008 - Assert lifecycle metrics through real state transitions, not only metric wrapper methods
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `observability` · harmful: 0
- features: durable-transcript-jobs
- evidence: M17 (observability)
- last seen: 2026-08-26T23:27:05Z

### L-009 - Test cache-hit decision ordering at full capacity, not only join and miss ordering
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `cache` · harmful: 0
- features: durable-transcript-jobs
- evidence: M18 (cache)
- last seen: 2026-08-26T23:27:05Z

### L-010 - Treat cleanup, quarantine, and rollback as observable persistence outcomes with real-filesystem assertions
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `storage` · harmful: 0
- features: durable-transcript-jobs
- evidence: WORK-07/STORE-03/CACHE-04 (storage)
- last seen: 2026-08-26T23:27:05Z

### L-011 - Normalize strict manifest validation failures into corruption before mapping operational storage errors
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `storage` · harmful: 0
- features: durable-transcript-jobs
- evidence: STORE-03/CACHE-04 (storage)
- last seen: 2026-08-26T23:59:01Z

### L-012 - Track post-rename publication state so pointer failures remove only the newly published bundle
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `storage` · harmful: 0
- features: durable-transcript-jobs
- evidence: CACHE-07 (storage)
- last seen: 2026-08-26T23:59:01Z

### L-013 - Prove derived-data lifecycle independence end to end by byte-comparing retained source artifacts and querying derived data after source expiry.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `rag-lifecycle` · harmful: 0
- features: rag-lancedb
- evidence: LIFE-04 (rag-lifecycle)
- last seen: 2026-08-27T05:42:25Z

### L-014 - Drive readiness tests through real post-start component failures instead of only substituting a pre-degraded coordinator.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `readiness` · harmful: 0
- features: rag-lancedb
- evidence: OPS-04 (readiness)
- last seen: 2026-08-27T05:42:26Z

### L-015 - Verify telemetry through production operations and scraped metrics instead of invoking registry methods directly.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `observability` · harmful: 0
- features: rag-lancedb
- evidence: OPS-05 (observability)
- last seen: 2026-08-27T05:42:26Z

### L-016 - Run model-dependent gates from a clean checkout that fetches and verifies ignored immutable assets before testing.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `ci` · harmful: 0
- features: rag-lancedb
- evidence: OPS-10 (ci)
- last seen: 2026-08-27T05:42:26Z

### L-017 - Inject storage exhaustion after admission and assert cleanup, prior-state preservation, and readiness degradation end to end.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `storage` · harmful: 0
- features: rag-lancedb
- evidence: EDGE-09 (storage)
- last seen: 2026-08-27T05:42:26Z

### L-018 - Normalize malformed top-level provider envelopes at the same boundary as malformed content and assert both error codes.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `provider-validation` · harmful: 0
- features: channel-transcript-library
- evidence: verification.md Round 1 C30; 0eca123:services/channel-library/api/remote.ts:267 (provider-validation)
- last seen: 2026-10-01T04:11:34Z

### L-019 - Exercise production fallback logging through a failing runtime operation and assert every required event field.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `observability` · harmful: 0
- features: channel-transcript-library
- evidence: verification.md Round 1 C52; 0eca123:services/channel-library/api/server.ts:29 (observability)
- last seen: 2026-10-01T04:11:34Z

### L-020 - Use contrasting records, restart boundaries, and populated-view refresh failures to prove claims beyond the initial successful example.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `feature-proofs` · harmful: 0
- features: channel-transcript-library
- evidence: verification.md Round 1 C15 C22 C35 C42 C56 (feature-proofs)
- last seen: 2026-10-01T04:11:34Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
