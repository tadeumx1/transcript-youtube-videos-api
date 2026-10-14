# Reading workflow and integration validation

This work adds favorites, read/unread state, personal notes, Markdown export and reading filters.
Use [Run all services](running-all-services.md) for the startup commands.

## Set up without a YouTube key

```sh
npm run library:setup
npm --prefix services/channel-library run validate:live -- preflight
```

Setup generates missing distinct owner tokens and connects `TRANSCRIPT_API_KEY` to the root
`API_ACCESS_KEY`, copies the root OpenCode key when present, and selects `YOUTUBE_DISCOVERY_MODE=rss`
when no YouTube key exists. It prints only added variable names. Existing values are not replaced;
if you deliberately configured different upstream credentials, fix that mapping yourself. Both env
files remain ignored by Git. Enter the **library** owner key in the access screen.

RSS uses the public channel feed and needs no Google API key. Prefer a
`https://www.youtube.com/channel/UC…` URL when a handle page is inaccessible. The feed has a limited
recent window with no pagination; it cannot recover every publication after long downtime or bursts.
The Data API option remains available with `YOUTUBE_DISCOVERY_MODE=data_api` and a key.

## Use the reading features

Open a video, toggle **Add favorite** or **Mark as read**, and use **Personal notes** / **Save notes**.
Notes are limited to 10000 Unicode code points. Drafts survive polling and failed saves; navigate
away only after saving. Notes and flags belong to the single library owner and do not modify the
original transcript or editorial output. **Download Markdown** creates a file containing the title,
video link, available source/editorial sections and personal notes. Content is escaped as text.

In the library, combine **Filter favorites** and **Filter reading state** with channel/status/search.
Changing a filter resets pagination. **Clear filters** on an empty result resets every filter.
State persists in SQLite through restarts; locking clears the browser session, not saved state.

Schema 2 migrates existing video metadata and preserves originals and results. Keep a backup of the
stopped service's database before upgrading; the old schema-1 binary cannot open the upgraded store.

## Separate live provider probes from local tests

Preflight checks configuration only. It is not provider authentication or network validation.
Run discovery against the default public Google Developers channel, or set `VALIDATION_CHANNEL_URL`:

```sh
npm --prefix services/channel-library run validate:live -- discovery
```

Start the actual transcript API, choose one public video, then request one job:

```sh
VALIDATION_VIDEO_ID=YOUR_VIDEO_ID npm --prefix services/channel-library run validate:live -- transcript
```

`YOUR_VIDEO_ID` must be an actual 11-character ID. The probe polls for at most two minutes and
writes a successful source only to ignored `services/channel-library/.data/validation/source.json`.
Each HTTP request also has a timeout. Source jobs may continue on the transcript API after the
probe's deadline; the probe does not cancel or delete them. Audio fallback can use provider quota.

To make one bounded OpenCode request:

```sh
npm --prefix services/channel-library run validate:live -- llm
```

The LLM probe uses the saved transcript, limited to 12000 code points. Without that artifact it
uses a fixed, explicitly labeled smoke sample; that result proves only LLM adapter connectivity,
not end-to-end video enrichment. For longer saved sources use the normal library worker, which
chunks the full transcript. Probe output reports stage/status/counts, never source text or keys.
Exit codes: **0 passed**, **1 failed validation/provider result**, **2 blocked by missing setup,
selection, credentials or network**. A blocked probe is never counted as a live success.

## Automated local proof

```sh
npm run check:all
npm run test:library:http
npm audit
npm --prefix services/channel-library audit
```

The HTTP proof starts both real application assemblies on temporary ports/storage. It uses controlled
external provider fixtures, then asserts source/enrichment persistence, restart and deduplication.
The reading browser suite uses Chromium against an actual library API and SQLite database.
Neither local proof establishes actual YouTube/OpenCode availability.

## Interactive Playwright CLI review

The installed Playwright package supplies the `playwright-cli` skill at
`services/channel-library/node_modules/playwright-core/lib/tools/skills/playwright-cli/SKILL.md`.
From the repository root, build the reader, then start the isolated fixture app in a terminal:

```sh
npm --prefix services/channel-library run build
cd services/channel-library
node --import tsx test/serve-browser-fixture.ts
```

This is explicitly controlled fixture content, not a fetched YouTube transcript. It uses a temporary
SQLite database, does not call providers, and deletes the fixture database on Ctrl+C. The fixture
access key printed by that command is not a real owner credential.

In another terminal at the repository root:

```sh
npm --prefix services/channel-library exec -- playwright cli -s=reading-review open http://127.0.0.1:4180
npm --prefix services/channel-library exec -- playwright cli -s=reading-review snapshot
```

Use element refs from the current snapshot with `fill`, `click`, `select` and `press` (never guess
refs). Unlock with the fixture key; open **Fixture reading story**; toggle favorite/read; save notes;
download Markdown; return to the library and combine/clear filters. Reload and unlock again to
check persistence. Resize to 360×800, inspect overflow and operate the controls using the keyboard.
Capture snapshots after state changes and inspect `console` for errors. Save screenshots/traces under
ignored `output/playwright/`, then close only this named browser session and stop the fixture server.

The environment must permit local listeners, Chromium and CLI daemon processes. If it rejects
`listen`/daemon startup with EPERM, browser verification is blocked; unit assertions are not a substitute.
Network access is separately required for live probes and registry audits.

## Task tracking

The 15 obligations and their current statuses live in
[the lean checks](../.specs/features/library-reading-workflow/checks.md). Historical specs remain intact.
