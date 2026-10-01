# Local services security verification

**Verdict**: PASS
**Profile**: light
**Diff range**: `78bbe80..b9db1322b63c709eab57fdc1aeaba31de74f8f40`
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

All four checks were independently exercised at the feature HEAD. No product, test, dependency,
or historical specification files were modified by the verifier. Verification used Node
24.18.1 and npm 11.16.0 on Linux, on 2026-10-01.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Root full audit has zero known vulnerabilities | `npm audit` exited 0 and printed `found 0 vulnerabilities`; no production-only filter | `.specs/features/local-services-security/checks.md:12` fixes the expected count at zero; `docs/running-all-services.md:265` supplies the full command. Patched resolutions are present at `package-lock.json:2641` (adm-zip 0.6.1) and `package-lock.json:3386` (Fastify 5.12.5). The independently executed audit settles the zero-count assertion. | PASS |
| C2 | Library full audit has zero known vulnerabilities | `npm --prefix services/channel-library audit` exited 0 and printed `found 0 vulnerabilities`; no production-only filter | `.specs/features/local-services-security/checks.md:15` fixes the expected count at zero; `docs/running-all-services.md:266` supplies the full command. `services/channel-library/package.json:24` pins Fastify 5.12.5. The independently executed audit settles the zero-count assertion. | PASS |
| C3 | Both complete checks pass, preserving tests and exact inference/ZIP contracts | `npm run check:all` exited 0 with 740 root tests, 69 library backend tests and 17 browser tests; both lint, typecheck and build targets passed. The verbose dependency proof separately exited 0 with 4 tests. | `package.json:21` and `package.json:23` compose the root checks; `services/channel-library/package.json:19` includes browser tests. `test/unit/rag-dependency-contract.test.ts:59`: `expect(lockfile.packages['node_modules/adm-zip']?.version).toBe('0.6.1')`; `test/unit/rag-dependency-contract.test.ts:31`: `expect(manifest.dependencies['@huggingface/transformers']).toBe('4.2.0')`. The diff changes only the two exact ZIP values in tests, with no removed or skipped behavior cases. | PASS |
| C4 | Complete local guide and working simultaneous development/compiled services | `OPENCODE_API_KEY='' YOUTUBE_API_KEY='' python3 /tmp/local-services-smoke.py` exited 0. Fresh development APIs on 3000/3100 and Vite on 5173 passed the guide's actual executable smoke block. Fresh compiled APIs then passed the same assertions using 3100 for reader/API access. RAG readiness reached 200 in both modes. | `docs/running-all-services.md:175`: `assert.equal(response.status, 200)` for both health endpoints; line 176 asserts `{ status: 'ok' }`; line 180 asserts the reader root element; line 183 asserts unauthenticated 401; line 184 asserts `UNAUTHORIZED`; line 188 asserts authenticated 200; line 189 asserts an `items` array. Guide sections were compared with real scripts/configuration as recorded below. | PASS |

## Proof execution details

The full check command was executed with credential variables removed from the test environment:

```sh
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u HF_TOKEN -u HUGGING_FACE_HUB_TOKEN -u OPENCODE_API_KEY -u OPENAI_API_KEY -u YOUTUBE_API_KEY npm run check:all
```

Output was captured at `/tmp/local-services-verifier-check-all.log`: root 59 files / 740 tests,
library 2 files / 69 tests, and Chromium 17 tests; 826 passed, none failed or skipped. Root lint
checked 122 files and library lint checked 18 files. Both typechecks and builds exited 0.
The temporary log is supplementary; the counts and executed commands are recorded here.

The initial verifier invocation set `OPENCODE_API_KEY=''` rather than removing it. The existing
offline evaluation guard at `test/evaluation/rag-retrieval.test.ts:777` requires credential
variables to be undefined; that invocation failed before the two evaluation cases, with 738
passing and 2 skipped. The complete target was rerun successfully with the environment above.
No assertion or implementation changed to obtain the passing result.

The named proof was run with the same credential-free environment:

```sh
npm test -- --reporter=verbose test/unit/rag-dependency-contract.test.ts
```

All four names appeared individually as passing, and were located using `rg -n` with their bodies:

- `pins the approved production dependency versions exactly` — `test/unit/rag-dependency-contract.test.ts:26`.
- `forces LanceDB to share the approved Transformers tree` — `test/unit/rag-dependency-contract.test.ts:37`.
- `loads the patched native image and inference runtimes` — `test/unit/rag-dependency-contract.test.ts:73`.
- `keeps only local CPU retrieval packages and stable offline scripts` — `test/unit/rag-dependency-contract.test.ts:84`.

The existing smoke orchestration script was read before use; only its fresh independent execution
is evidence. It creates temporary transcript, RAG and library storage, exports distinct fixture
owner tokens with the matching upstream token, explicitly empties both provider keys, and uses
the existing local model directory. It executes the exact development commands from the guide:

```sh
npm run dev
npm run library:dev:api
npm --prefix services/channel-library run dev:web -- --port 5173 --strictPort
```

It extracts the guide's JavaScript smoke block and runs it through the documented
`node --env-file-if-exists=services/channel-library/.env --input-type=module` command. The library
environment file was absent; exported fixture values supplied its configuration, as supported by
the guide. It stops those processes, runs `npm start` and
`npm --prefix services/channel-library start`, and repeats the assertions on the compiled origin.
All processes exited, all three ports were confirmed released, and temporary data was removed.
Cleanup used SIGTERM; the documented SIGINT handlers were inspected in both server entrypoints.
No channel was registered and no provider operation was requested.

`OPENCODE_API_KEY='' YOUTUBE_API_KEY='' npm run rag:model:fetch` also exited 0 with
`Pinned RAG model reused and verified`. Both build commands were executed by the full check target.

## Documentation and existing constraints

| Guide section | Independent comparison |
| --- | --- |
| Prerequisites and two installs, `docs/running-all-services.md:18` | Node floor matches `services/channel-library/package.json:7`; separate manifests/lockfiles and native SQLite are real. The documented SQLite assertion at guide line 50 uses a real in-memory query. Installs were not repeated in this verifier run; existing installed native packages were exercised by full tests and both live startups. |
| Two env files and key mapping, `docs/running-all-services.md:63` | Env loading is explicit in `package.json:10`, `package.json:12`, `services/channel-library/package.json:10` and `services/channel-library/package.json:12`. Keys, upstream origin and scheduler defaults match `services/channel-library/api/config.ts:40`. Root authentication fails closed at `src/http/app.ts:181`; library authentication does so at `services/channel-library/api/app.ts:58`. |
| Model preparation, `docs/running-all-services.md:113` | `package.json:13` resolves the fetch command; `scripts/fetch-rag-model.mjs:71` checks bytes/checksum. Local reuse verification passed, and real startup readiness reached 200. |
| Three development terminals, `docs/running-all-services.md:132` | Scripts match both package manifests; `services/channel-library/vite.config.ts:7` targets port 3100. All three real processes ran concurrently and the proxy transmitted authentication correctly. |
| Compiled mode, `docs/running-all-services.md:203` | Build/start scripts match both manifests; compiled static serving is assembled at `services/channel-library/api/server.ts:13`. Actual HTML and authenticated/unauthenticated API requests passed at port 3100. |
| Shutdown and persistence, `docs/running-all-services.md:218` | Signal handlers exist at `src/server.ts:21` and `services/channel-library/api/server.ts:50`; library close waits for its worker at `services/channel-library/api/app.ts:168`. Defaults match `src/config.ts:62`, `src/config.ts:164`, `src/config.ts:165` and `services/channel-library/api/config.ts:41`. SQLite is opened at `services/channel-library/api/store.ts:20`. Recovery/scheduling exists at `services/channel-library/api/worker.ts:53`; persisted originals are read separately at `services/channel-library/api/store.ts:143`. |
| Troubleshooting and quality checks, `docs/running-all-services.md:237` | Port/proxy/key/model explanations match the inspected configuration and entrypoints. `/health` and readiness are separate at `src/http/app.ts:301`; library health is public at `services/channel-library/api/app.ts:88`. Full quality/audit commands were run successfully. |

The `Swept` rows were reread against these existing constraints. Authorization is present at both
HTTP boundaries; concurrency is proven by the three real listeners; storage paths remain separate;
existing lifecycle and schema/model/fingerprint files are absent from the feature diff. Response
logging at `src/http/app.ts:220` uses method, route, status and duration; library worker errors are
bounded at `services/channel-library/api/server.ts:26`. Both live health boundaries were exercised.
Validation, dependency-failure and existing behavioral claims are supported by the complete suite
and full audits. Approved `n/a` rows require no new behavior.

## Level, sampling and profile limits

Proofs reach the claimed boundaries: actual registry audits cover both complete dependency trees;
the full suites cover existing behavior; real development and compiled processes cover service
assembly and HTTP/proxy behavior. No named proof was missing or matched zero tests.

This is the approved **light** profile. No faults were injected and the author's Coverage join
was read rather than independently recomputed. No Test policy section or explicitly binding UI
source is declared. No interface layout changed, so a human visual acceptance walk is inapplicable.
Audits are a current registry observation, not a guarantee about future advisories. Live YouTube,
OpenCode, media fallback, alternative operating systems and fresh compiler-based installation were
not exercised; they are outside these local fixture proofs. The provided environment's installed
SQLite/native runtimes were exercised directly. No gap was found in C1-C4.

## Gate

`python3 .agents/skills/tlc-spec-lean/scripts/validate_verification.py local-services-security`
— exit 0; 0 errors, 0 warnings across `local-services-security`.
