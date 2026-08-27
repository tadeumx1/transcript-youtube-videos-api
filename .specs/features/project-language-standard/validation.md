# Project Language Standard Validation — PASS

**Date**: 2026-08-27  
**Spec sources**: `.specs/STATE.md` AD-013 and the user requirement that the README and code use English, with Portuguese limited to transcription and RAG  
**Diff range**: `217147e^..217147e`  
**Verifier**: independent sub-agent (author != verifier)  
**Result**: PASS

## Scope and task completion

This adaptive change has no separate `spec.md` or `tasks.md`. The validation uses only AD-013 and
the user requirement as its contract. All six files in the diff were inspected:

- `.specs/STATE.md`
- `README.md`
- `docs/runbooks/youtube-datacenter-blocking.md`
- `test/unit/durable-jobs-readme-contract.test.ts`
- `test/unit/rag-readme-contract.test.ts`
- `test/unit/youtube-blocking-runbook-contract.test.ts`

The diff is 472 insertions and 469 deletions. `git diff --check 217147e^..217147e` passed.

## Spec-anchored acceptance criteria

| Contract criterion | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| The README uses English | All README technical prose, headings, placeholders, and operational guidance are English | `README.md:1`, `README.md:10`, `README.md:53`, `README.md:193`, `README.md:253`, `README.md:341`, `README.md:388`, `README.md:515`; `test/unit/durable-jobs-readme-contract.test.ts:15` with exact English assertions at `test/unit/durable-jobs-readme-contract.test.ts:55`; `test/unit/rag-readme-contract.test.ts:22` with exact English section/assertion boundaries at `test/unit/rag-readme-contract.test.ts:25` and `test/unit/rag-readme-contract.test.ts:126` | PASS |
| Code and operational documentation use English | Identifiers, comments, technical messages, test names/descriptions, and runbook prose are English | AD-013 at `.specs/STATE.md:109`; English technical messages at `src/http/app.ts:102` and `src/domain/rag.ts:352`; English changed test descriptions at `test/unit/durable-jobs-readme-contract.test.ts:16`, `test/unit/rag-readme-contract.test.ts:23`, and `test/unit/youtube-blocking-runbook-contract.test.ts:8`; English runbook headings/prose at `docs/runbooks/youtube-datacenter-blocking.md:1`, `docs/runbooks/youtube-datacenter-blocking.md:11`, and `docs/runbooks/youtube-datacenter-blocking.md:108` | PASS |
| Portuguese is limited to transcription and RAG | Every remaining Portuguese string is a transcription prompt or rendered transcription value, or PT-BR RAG corpus/query/behavioral fixture | Transcription prompt at `src/infrastructure/audio/muse-audio-transcriber.ts:15`; rendered transcription labels at `src/infrastructure/pdf/transcript-pdf.ts:103`; transcript rendering fixture at `test/unit/transcript-pdf.test.ts:20`; PT-BR RAG corpus and query at `test/evaluation/rag-retrieval.test.ts:100` and `test/evaluation/rag-retrieval.test.ts:152`; RAG smoke fixture at `scripts/rag-container-smoke.mjs:106` | PASS |

**Spec-anchored check**: 3/3 criteria matched the contract. No spec-precision gaps.

## Repository language audit

The audit covered the complete `src`, `test`, and `scripts` inventories plus `README.md` and
`docs/runbooks/youtube-datacenter-blocking.md`. Accented-character and curated Portuguese-word scans
found no Portuguese in the README or runbook. Manual review treated English words such as `audio`
and `video` as English, not false Portuguese matches.

The files with remaining Portuguese were classified as follows:

| Allowed domain | Files and representative evidence |
| --- | --- |
| Transcription prompts and Muse response content | `src/infrastructure/audio/muse-audio-transcriber.ts:15`, `test/unit/muse-audio-transcriber.test.ts:33`, `test/unit/hybrid-transcript-service.test.ts:33` |
| Rendered transcription/PDF content and transcript fixtures | `src/infrastructure/pdf/transcript-pdf.ts:103`, `test/unit/transcript-pdf.test.ts:20`, `test/unit/transcript-artifact-coordinator.test.ts:33`, `test/integration/http-app.test.ts:37`, `test/integration/artifact-snapshot-lock.test.ts:23` |
| PT-BR RAG corpora, queries, and behavioral fixtures | `test/evaluation/rag-retrieval.test.ts:100`, `scripts/rag-container-smoke.mjs:106`, `test/unit/rag-chunker.test.ts:106`, `test/unit/rag-search-service.test.ts:214`, `test/integration/lancedb-rag-index.test.ts:119`, `test/integration/rag-routes.test.ts:68`, `test/integration/rag-search-service.test.ts:47`, `test/integration/rag-http-app.test.ts:35`, `test/integration/rag-lifecycle-independence.test.ts:61`, `test/integration/rag-repository-recovery.test.ts:31`, `test/integration/durable-rag-source.test.ts:35` |

No Portuguese technical identifier, comment, log/error message, or test description remained outside
those categories.

## Gate check

- **Command**: `npm run check`
- **Result**: PASS
- **Lint**: 104 files checked, 0 errors
- **Typecheck**: passed
- **Tests**: 59 files passed; 740 passed, 0 failed, 0 skipped
- **Build**: passed
- **Test count before feature**: 740
- **Test count after feature**: 740
- **Delta**: 0; no tests were removed
- **Integrity review**: changed contracts retained their existing test cases and translated exact
  assertions to the English outcomes. No assertion was weakened or disabled.

The previous-commit worktree exposed all 740 tests. Its model-cache symlink caused one environmental
`git check-ignore` failure after the count was established; this does not affect the current clean
gate or the unchanged count.

## Discrimination sensor

All mutations ran only in detached temporary git worktrees. The real tree was never mutated.

| Mutation | File:line | Focused command and observed failure | Killed? |
| --- | --- | --- | --- |
| English `### Durable jobs` heading changed to Portuguese | `README.md:193` | `npm test -- --run test/unit/durable-jobs-readme-contract.test.ts`; assertion at `test/unit/durable-jobs-readme-contract.test.ts:23` failed because the required section was absent | Killed |
| English fixed-TTL sentence changed to Portuguese | `README.md:244` | Same focused command; exact assertion at `test/unit/durable-jobs-readme-contract.test.ts:55` failed | Killed |
| English caption-retrieval heading changed to Portuguese | `docs/runbooks/youtube-datacenter-blocking.md:36` | `npm test -- --run test/unit/youtube-blocking-runbook-contract.test.ts`; ordered-stage assertion at `test/unit/youtube-blocking-runbook-contract.test.ts:22` failed | Killed |

**Sensor depth**: lightweight, 3 targeted mutations  
**Result**: 3/3 killed, 0 survived — PASS

Both temporary worktrees were removed. `git status --porcelain=v1` on the real tree was empty before
the sensor and empty after cleanup.

## Code quality and scope

| Principle | Result | Evidence |
| --- | --- | --- |
| Minimum change and no scope creep | PASS | The six-file diff is limited to AD-013, translation of README/runbook prose, and matching contract assertions; `git diff --name-status 217147e^..217147e` lists no implementation behavior changes |
| Surgical and pattern-consistent | PASS | Existing documentation structure and test organization are preserved at `README.md:141`, `docs/runbooks/youtube-datacenter-blocking.md:11`, and `test/unit/rag-readme-contract.test.ts:22` |
| Test integrity | PASS | 740 tests before and after; no skips; exact contract assertions remain at `test/unit/durable-jobs-readme-contract.test.ts:55` and `test/unit/youtube-blocking-runbook-contract.test.ts:22` |
| Spec-anchored outcomes | PASS | English outcomes match AD-013 at `.specs/STATE.md:111` and the user requirement |
| Every changed test remains claimed | PASS | The three changed suites directly protect README or runbook content at `test/unit/durable-jobs-readme-contract.test.ts:15`, `test/unit/rag-readme-contract.test.ts:22`, and `test/unit/youtube-blocking-runbook-contract.test.ts:7` |
| Project quality guidance | PASS | The documented full gate at `README.md:548` was executed; TLC coding principles were applied |

## UAT and gaps

Interactive UAT was not applicable to this repository-language documentation change. Automated
contracts, a complete repository audit, and the discrimination sensor cover the observable outcome.

No gaps, surviving mutants, spec deviations, or lessons-layer signals were found.

## Summary

**Overall**: PASS. The commit `217147e` satisfies AD-013 and the user requirement. README,
operational documentation, technical code text, and tests are English. Remaining Portuguese is
confined to the approved transcription and PT-BR RAG domains. The full gate passed 740/740, and all
3 sensor mutations were killed.
