# Channel Transcript Library checks

Profile: light
Plan: `.specs/features/channel-transcript-library/plan.md`

56 checks in 5 slices; 7 doors; no implementation blocker. Live credentials remain a go-live prerequisite.

## Checks

### S1

**C1** - WHEN the owner submits a valid YouTube channel URL in `/@handle`, `/channel/UC…`, or `/user/name` form THEN the library SHALL persist the resolved canonical channel and return HTTP 201. (AC 1)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C1 "`

**C2** - IF an input URL exceeds 2048 characters, names another host, contains credentials or a non-default port, or uses an unsupported path THEN the API SHALL return HTTP 400 with `INVALID_CHANNEL_URL` before an outbound request. (AC 2)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C2 "`

**C3** - IF the channel lookup returns no channel THEN the API SHALL return HTTP 404 with `CHANNEL_NOT_FOUND`. (AC 3)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C3 "`

**C4** - WHEN simultaneous submissions resolve to the same canonical channel THEN the library SHALL keep one channel record, with one HTTP 201 response and duplicate responses HTTP 409 `CHANNEL_EXISTS`. (AC 4)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C4 "`

**C5** - WHEN initial collection runs THEN the library SHALL admit the ten most recent discoverable public videos, or all available videos if fewer than ten exist. (AC 5)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C5 "`

**C6** - WHILE a channel is paused the scheduler SHALL admit zero new automatic collections for that channel. (AC 6)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C6 "`

**C7** - WHEN the owner pauses or resumes a channel THEN the library SHALL preserve all saved videos and transcripts. (AC 7)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C7 "`

### S2

**C8** - WHEN an active channel reaches its daily due slot THEN the scheduler SHALL admit one collection for that slot, defaulting to 06:00 in `America/Sao_Paulo`. (AC 8)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C8 "`

**C9** - WHEN the service starts after a missed due slot THEN the scheduler SHALL admit one catch-up collection per active channel instead of replaying every missed calendar day. (AC 9)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C9 "`

**C10** - WHEN a collection has another upload-playlist page before its saved checkpoint THEN the worker SHALL continue pagination rather than treat the first page as a complete daily result. (AC 10)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C10 "`

**C11** - IF discovery fails after storing a page THEN the library SHALL retain that page's videos without advancing the completed-discovery checkpoint. (AC 11)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C11 "`

**C12** - WHEN discovery sees a previously stored video ID THEN the library SHALL retain one video record without scheduling another completed enrichment. (AC 12)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C12 "`

**C13** - WHEN manual and scheduled collection overlap for a channel THEN the API SHALL return the existing active collection identifier without creating another active collection. (AC 13)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C13 "`

**C14** - IF one channel's discovery fails THEN the worker SHALL continue processing other due channels and expose a sanitized error on the affected channel. (AC 14)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C14 "`

**C15** - WHEN a restart interrupts a collection or processing attempt THEN the worker SHALL resume from its last durable stage and reuse a saved upstream job ID or source transcript. (AC 15)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C15 "`

**C16** - WHILE video processing is active the worker SHALL execute at most one video pipeline at a time. (AC 16)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C16 "`

**C17** - WHEN a discovery pass reaches 100 pages THEN the worker SHALL persist continuation state for a later pass rather than declare discovery complete. (AC 17)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C17 "`

### S3

**C18** - WHEN a video needs its original transcript THEN the worker SHALL use authenticated `POST /v1/jobs`, poll the returned job, and retrieve the completed transcript over HTTP. (AC 18)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C18 "`

**C19** - WHEN the worker retrieves a completed source THEN the library SHALL persist the complete original text, segments, source, language, and timestamp precision before requesting enrichment. (AC 19)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C19 "`

**C20** - WHEN the source service later expires that job THEN the library SHALL continue serving its saved original and editorial result. (AC 20)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C20 "`

**C21** - IF the source reports `VIDEO_NOT_AVAILABLE` THEN the library SHALL expose `unavailable` without requesting enrichment. (AC 21)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C21 "`

**C22** - IF a provider returns a timeout, HTTP 429, or HTTP 5xx THEN the worker SHALL schedule at most three attempts per stage using persisted retry times, honoring `Retry-After` up to one hour or delays of 60 and 300 seconds when absent. (AC 22)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C22 "`

**C23** - IF a provider rejects credentials or quota without a retryable response THEN the worker SHALL expose a terminal actionable error without a retry loop. (AC 23)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C23 "`

**C24** - WHEN source polling exceeds six hours for an attempt THEN the library SHALL expose `TRANSCRIPT_JOB_TIMEOUT` and retain its upstream job ID for an owner-requested retry. (AC 24)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C24 "`

**C25** - WHEN enrichment completes THEN the library SHALL publish only a nonempty corrected transcript, nonempty summary, and one to ten nonempty key points as one atomic result. (AC 25)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C25 "`

**C26** - WHEN the worker asks the LLM for correction THEN its instruction SHALL restrict editing to punctuation, spelling, paragraphing, and evident transcription errors while preserving names, quantities, meaning, and source language. (AC 26)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C26 "`

**C27** - WHEN the worker asks the LLM for a summary and key points THEN its instruction SHALL request Brazilian Portuguese grounded only in the supplied transcript. (AC 27)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C27 "`

**C28** - IF a transcript exceeds 12000 Unicode code points THEN the worker SHALL process ordered chunks of at most 12000 code points and reduce their summaries without dropping source chunks. (AC 28)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C28 "`

**C29** - IF a source exceeds 1000000 Unicode code points THEN the library SHALL retain the original and expose `TRANSCRIPT_TOO_LARGE` without an LLM request. (AC 29)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C29 "`

**C30** - IF an LLM response is malformed, empty, truncated, or missing a required output field THEN the library SHALL withhold the incomplete enrichment and expose `INVALID_LLM_RESPONSE`. (AC 30)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C30 "`

**C31** - WHEN the owner retries a failed enrichment with a saved original THEN the worker SHALL reuse the original without resubmitting transcription. (AC 31)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C31 "`

**C32** - WHEN an enrichment becomes ready THEN the library SHALL retain the model identifier, prompt version, and completion time alongside that result. (AC 32)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C32 "`

**C33** - IF an outbound discovery request exceeds 30 seconds or an LLM request exceeds 120 seconds THEN the worker SHALL abort that request and record a timeout for the applicable retry policy. (AC 33)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C33 "`

**C34** - WHEN transcript or model content contains HTML or instructions THEN the reader SHALL display it as text without executing markup or following embedded instructions as application commands. (AC 34)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C34 "`

### S4

**C35** - WHEN the owner opens the channel view THEN the interface SHALL show channel name, collection state, last collection time, next collection time, and pause/resume plus collect-now actions. (AC 35)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C35 "`

**C36** - WHEN the owner opens the video library THEN the interface SHALL show title, channel, publication date, thumbnail when available, and processing status ordered by publication time descending and video ID as tie-breaker. (AC 36)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C36 "`

**C37** - WHEN the owner filters videos THEN the API SHALL apply channel, processing-state, and case-insensitive title search filters with page size 20 by default and a maximum of 100. (AC 37)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C37 "`

**C38** - WHEN the owner opens a ready video THEN the reader SHALL provide Summary, Key points, Corrected transcript, and Original transcript tabs containing the corresponding saved content. (AC 38)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C38 "`

**C39** - WHEN the owner selects an original segment timestamp THEN the reader SHALL open that video at the segment's start time without representing edited prose as time-aligned captions. (AC 39)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C39 "`

**C40** - WHEN a channel or video collection is empty THEN its view SHALL show an empty-state message and a channel-registration action or a clear-filters action as applicable. (AC 40)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C40 "`

**C41** - WHILE a channel list, video list, or reader request is pending the relevant view SHALL expose a loading state. (AC 41)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C41 "`

**C42** - IF a channel list, video list, or reader request fails THEN the relevant view SHALL show an error and a retry action without replacing previously loaded content with fabricated results. (AC 42)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C42 "`

**C43** - IF a protected request returns HTTP 401 THEN the interface SHALL return to the access view and discard its in-memory owner credential. (AC 43)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C43 "`

**C44** - WHEN a video is processing, unavailable, or failed THEN the reader SHALL show its state and any saved original; failed or unavailable entries expose an owner-requested retry action. (AC 44)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C44 "`

**C45** - WHEN the reader renders at viewport widths of 360 and 1280 pixels THEN its tabs, content, and primary actions SHALL remain accessible without document-level horizontal scrolling. (AC 45)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C45 "`

**C46** - WHEN a keyboard user navigates the reader THEN the interface SHALL provide labeled inputs, visible focus, and operable tabs and actions. (AC 46)
Proof: `npm --prefix services/channel-library run test:browser -- --grep "C46 "`

### S5

**C47** - IF a protected library request lacks a valid owner Bearer credential THEN the API SHALL return HTTP 401 without reading library content or admitting work. (AC 47)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C47 "`

**C48** - IF `LIBRARY_ACCESS_KEY` is absent THEN protected library routes SHALL return HTTP 503 rather than become public. (AC 48)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C48 "`

**C49** - The web build SHALL contain no transcript-service credential, YouTube API key, or OpenCode API key; the entered library credential remains in browser memory only. (AC 49)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C49 "`

**C50** - WHEN a mutating admission route receives more than 30 requests in one minute from an authenticated owner THEN the API SHALL return HTTP 429 with `Retry-After`. (AC 50)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C50 "`

**C51** - WHEN a route fails THEN the library SHALL return the documented error envelope with a stable code and sanitized message rather than provider response bodies. (AC 51)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C51 "`

**C52** - WHEN the worker records an operational event THEN its log SHALL include stage, outcome, and elapsed time without credentials, URLs, video IDs, transcript content, or provider bodies, preserving AD-009. (AC 52)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C52 "`

**C53** - WHEN upstream credentials or required URLs are unconfigured THEN affected actions SHALL report `CONFIGURATION_REQUIRED` while already saved content remains readable. (AC 53)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C53 "`

**C54** - The repository SHALL document independent API/web startup, required environment variables, persisted storage, daily scheduling, and the requirement for an always-running worker. (AC 54)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C54 "`

**C55** - The existing transcript API SHALL retain its current HTTP signatures and pass its existing regression checks after the library application is added. (AC 55)
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C55 "`

Proof: `npm run check`

**C56** - Each documented library route returns the exact declared status and error envelope for its success, validation, authentication, conflict, throttling, and dependency-failure cases.
Proof: `npm --prefix services/channel-library test -- --reporter=verbose -t "C56 "`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `GET /health` statuses (1) | 200 C56 | - |
| `GET /api/v1/channels` statuses (3) | 200 C56 · 401 C56 · 503 C56 | - |
| `POST /api/v1/channels` statuses (8) | 201 C56 · 400 C56 · 401 C56 · 404 C56 · 409 C56 · 429 C56 · 502 C56 · 503 C56 | - |
| `PATCH /api/v1/channels/:channelId` statuses (5) | 200 C56 · 400 C56 · 401 C56 · 404 C56 · 503 C56 | - |
| `POST /api/v1/channels/:channelId/sync` statuses (7) | 202 C56 · 400 C56 · 401 C56 · 404 C56 · 409 C56 · 429 C56 · 503 C56 | - |
| `GET /api/v1/videos` statuses (4) | 200 C56 · 400 C56 · 401 C56 · 503 C56 | - |
| `GET /api/v1/videos/:videoId` statuses (5) | 200 C56 · 400 C56 · 401 C56 · 404 C56 · 503 C56 | - |
| `POST /api/v1/videos/:videoId/retry` statuses (7) | 202 C56 · 400 C56 · 401 C56 · 404 C56 · 409 C56 · 429 C56 · 503 C56 | - |
| doors (7) | separation C55 · durable data C20 · scheduling C15 · discovery C10 · LLM C25 · rendering C34 · browser C45 | - |
| entities (6) | Channel C4 · LibraryVideo C12 · SourceTranscript C19 · Enrichment C25 · CollectionRun C13 · ProcessingAttempt C15 | - |
| video states (7) | pending C5 · transcribing C18 · enriching C19 · retry_wait C22 · ready C25 · failed C30 · unavailable C21 | - |
| screens (3) | access C43 · channels C35 · library/reader C38 | - |
| startup assemblies (2) | production entry C55 · injected test entry C56 | - |
| channel URL forms (3) | handle C1 · channel ID C1 · username C1 | - |
| provider retries (3) | timeout C33 · HTTP429 C22 · HTTP5xx C22 | - |
| UI states (4) | empty C40 · loading C41 · error C42 · unauthorized C43 | - |

## Swept

- validation: C2, C17, C28, C29, C30, C33, C37
- failure modes: C11, C14, C19, C25
- idempotency: C4, C12, C13, C15, C22, C31
- authorization: C47, C48, C49, C50
- concurrency: C4, C13, C16, C28, C36
- data lifecycle: C7, C19, C20
- dependency failure: C21, C22, C23, C24, C30, C33, C53
- state transitions: C15, C18, C19, C21, C25, C31, C44
- observability: C35, C44, C51, C52

## Handoff

One builder. Existing boundary/config/test/CI files measured with `wc -c`: 63005 bytes / 4 = 15752 tokens. Estimated new API/storage/worker = 80000 bytes / 4 = 20000; UI/browser fixtures = 48000 / 4 = 12000; checks/tests/docs = 100000 / 4 = 25000; integration and verification allowance = 20000 tokens. Total estimate = 92752 tokens, below the default 150000-token budget. No delegation of build slices. A fresh independent Verifier is required after the last feature commit.

Completion: C1–C56 implemented and author proofs passed; independent verification pending.
The root regression proof passed 740 tests. The library has 54 backend tests and 12 browser tests.
Additional named tests strengthen C1, C10, C15, C16, C22, C23, C25, C30, C37, and C56 without
changing their claims or proof selectors. C49 also scans the actual production bundle; C55 boots
the compiled server and exercises health, owner auth, static HTML, and graceful shutdown.

The C36 browser locator initially matched both channel-filter options and repeated card text.
It was narrowed to the card's channel/status fields; the required visibility assertions and values
were retained. This routine test-harness correction is covered by the owner's explicit instruction
to consider required approvals granted. No criterion was weakened, skipped, or deleted.

The owner delegated remaining routine decisions and requested continuous execution. The build
remained one builder; only the mandatory independent Verifier is delegated. Live-provider calls
remain untested because the required YouTube and transcript-service keys are missing locally.
