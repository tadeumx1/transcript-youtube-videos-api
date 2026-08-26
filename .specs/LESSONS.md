# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
