# Protect unsaved reading notes during navigation

Status: plan for task 2 of 10 approved by the owner on 2026-10-08 for the planning sequence.
Profile: `light` (repository default). This approval authorizes advancing review to task 3 and
does not authorize implementation.

## Problem

An owner can edit personal notes in `ReadingTools`, and a browser close or reload triggers a
native unsaved-change warning. Internal controls do not use that warning: Back to library, the
Library or Channels navigation, the Margin wordmark, Lock library, and opening another video can
clear the selected reader while the draft exists only in component state. The notes field is
unmounted and its edits are lost. No frequency or impact measurements were supplied.

The owner will see an explicit choice before an in-app action leaves the edited reading. A failed
save leaves the draft available for retry or discard.

## Flow

Reuse the current library session, note update callback, existing API error handling and native
browser unload warning.

1. Note edits in `services/channel-library/web/reading-tools.tsx` (exists) update a draft held by
   `services/channel-library/web/main.tsx` (exists) alongside the selected reading. The saved value
   remains `detail.video.reading.notes`; polling updates saved server state without replacing a
   dirty draft.
2. A request to leave through an in-app control in `main.tsx` (exists) checks whether draft text
   differs from the saved value. A clean or absent draft carries on immediately.
3. A dirty draft opens an accessible leave-confirmation dialog in `main.tsx` (exists) with save,
   discard and continue-reading actions. Stay, Escape or backdrop dismissal clears only the dialog.
4. Save calls the existing authenticated `PATCH /api/v1/videos/:videoId/reading` route (exists).
   The existing 10,000-code-point validation and partial reading update persist the notes. Only a
   successful response executes the original pending navigation; an error preserves the draft
   and dialog for retry or discard.
5. Discard makes no API request, releases the pending navigation and clears the draft when the
   reading is left. Opening another reading starts with that video's saved notes.
6. Explicit Lock library uses the same dialog. A 401 from an in-flight request uses the current
   session-expiry behavior: clear the owner session and private draft immediately.
7. The existing `beforeunload` warning in `ReadingTools` continues to protect reloads and tab or
   window closes; the new dialog covers only in-app navigation.

The user stays in the same single-owner session and SQLite model. The draft is transient browser
memory; only the existing explicit Save notes action or the dialog's Save and leave action writes
it to the server.

## Impact

| Front | What changes |
| --- | --- |
| UI state | The in-progress notes draft moves to the existing `App` reader owner so it survives `ReadingTools` state transitions, background polling and rendering the leave dialog. It is still not persisted until a save succeeds. |
| navigation | Existing in-app actions that leave or replace the selected reader wait for a save/discard/stay decision when notes are dirty. The same actions remain immediate when the draft is clean. |
| API and storage | Reuse the existing authenticated partial PATCH, 10,000-code-point limit and SQLite reading state; no new route, payload, schema or migration. |
| error handling | A failed save retains the current reader, current destination intent, draft and visible API error so the owner can retry, discard or stay. |
| authorization | Explicit lock is guarded while the session is valid. Session expiry or 401 clears the session and draft under the existing security behavior; no note draft moves to another unlocked session. |
| browser lifecycle | Existing native warning for reload/window close remains. No custom guarantee is made for a browser terminating without firing its unload event. |
| project constraints | Conforms to AD-009, AD-013 and AD-015–AD-018; notes remain owner content, protected API data and absent from telemetry. |

## Relations

None - no stored-data shape change. A draft is temporary UI state associated with the selected
video ID; persisted `Video.reading.notes` remains the source of truth after a successful save.

## Surface

None - nothing consumed outside. No API route, response or persistent entity changes.

## Landing

None - no one-way door. The dialog is reversible UI behavior and reuses the existing note API and
storage shape. Its exact English labels are included in the criteria so the confirmation is
reviewable and testable.

## Criteria

### S1: Keep the current draft until the owner resolves it (P1)

**Acceptance Criteria**

1. WHEN the notes text changes from the selected video's saved notes THEN the reader SHALL mark the draft unsaved; when it equals the saved notes again the reader SHALL mark it clean.
2. WHILE a dirty draft exists THEN edits SHALL remain visible across the existing five-second detail refresh and changes to favorite or read state for that video.
3. WHEN a dirty draft exists and the owner activates `Back to library`, `Library`, `Channels`, the Margin wordmark, `Lock library`, or another `Read <title>` control THEN the reader SHALL keep the current video selected and show one leave-confirmation dialog before changing view, locking or opening another video.
4. WHEN the leave-confirmation dialog opens THEN it SHALL have accessible name `Unsaved notes`, describe that the current note edits are not saved, and offer buttons named `Save and leave`, `Discard notes` and `Keep reading`.
5. WHEN the leave-confirmation dialog is open THEN it SHALL expose `role=dialog`, `aria-modal=true`, and a valid accessible label and description, keep keyboard focus within the dialog, and initially focus `Keep reading`.
6. WHEN `Keep reading` is activated, Escape is pressed or the dialog is dismissed by clicking its backdrop THEN the reader SHALL close the dialog, keep the same video selected and leave the draft unchanged.
7. WHEN `Discard notes` is activated THEN the reader SHALL send no notes PATCH, discard the current draft, and perform exactly the one pending destination action.
8. WHEN `Save and leave` is activated for a valid draft THEN the reader SHALL send one authenticated partial PATCH containing only `{ notes: <current draft> }` to the selected video and perform the pending action only after a successful response.
9. WHILE a leave-save request is pending THEN the dialog SHALL disable its three action buttons and prevent a second save or a second destination action.
10. WHEN the leave-save request succeeds THEN the reader SHALL close the dialog, use the returned notes as the saved value, clear draft state and perform exactly the pending action once.
11. IF the leave-save request fails with a non-401 network or API error THEN the reader SHALL keep the same video selected, keep the dialog and draft, expose the error with `role=alert`, and allow retry, discard or keep-reading.
12. IF the current draft exceeds 10,000 Unicode code points THEN the dialog SHALL disable `Save and leave` and state that notes must be 10,000 code points or fewer; `Discard notes` and `Keep reading` SHALL remain available.
13. WHEN notes are successfully saved by the existing `Save notes` button THEN the parent draft SHALL become clean and subsequent in-app navigation SHALL proceed without a confirmation dialog.

**Independent test:** Edit notes, trigger each in-app departure action and verify the dialog, then
exercise stay/Escape, discard, successful save and failed-save retry. Confirm backend rows and
favorite/read state against the fixture's real SQLite database.

### S2: Keep existing session and browser safety (P1)

**Acceptance Criteria**

14. IF the existing note update receives 401 while attempting to save a leave draft THEN the reader SHALL immediately clear the session, displayed private content and draft, returning to the access screen without saving to another session.
15. WHEN an owner explicitly locks from a dirty reader and discards the draft THEN the reader SHALL lock immediately and clear the discarded private draft.
16. WHEN the owner reloads or closes the current tab/window with a dirty draft THEN the existing native `beforeunload` warning SHALL remain active; when the draft is clean it SHALL be inactive.
17. WHEN a clean reader navigates, opens another video, changes view or locks THEN the action SHALL proceed immediately without an unsaved-notes dialog.
18. WHEN note-save navigation fails or is discarded THEN the immutable Original, Enrichment, favorites and read state SHALL retain their existing values except for notes after an explicitly successful save.
19. WHEN the owner uses the leave dialog with keyboard navigation at a 390-pixel viewport THEN all three choices SHALL be reachable and operable without horizontal page overflow.

**Independent test:** In the real browser fixture, expire the session during a save, lock with a
dirty draft, navigate a clean reader and verify the browser unload handler remains scoped to dirty
notes. Use keyboard controls at a 390-pixel viewport.

## Out of scope

| Excluded | Why |
| --- | --- |
| Autosaving notes on each keystroke | Changes when durable private content is written and introduces request ordering/retry behavior. |
| Keeping notes drafts across reloads, browser sessions or owner keys | Would persist private content outside the existing explicit Save action and requires a separate lifecycle/security decision. |
| Warning when switching reader tabs or performing favorite/read actions | Those actions keep the same reader and draft mounted; their partial updates already leave notes untouched. |
| A browser-provided custom unload dialog or guaranteed recovery from process termination | Browsers control native unload wording and can terminate without a reliable callback. |
| Dirty guards for unsaved channel or URL forms | They are separate drafts with different submit and failure semantics. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Choice order and default focus | `Save and leave`, `Discard notes`, then `Keep reading`; initially focus `Keep reading`. | Preserve the intuitive action order and make the no-loss option easiest to activate by keyboard. | n |
| Escape and backdrop behavior | Both mean keep reading and close only the dialog. | Dismissing a confirmation must not silently discard the user's draft or complete navigation. | n |
| Explicit session lock with a dirty draft | Ask for the same three choices; 401 session expiry clears draft immediately. | The owner can safely save/discard while authorized, but an expired key cannot be used to preserve the draft across sessions. | n |

**Open questions:** none blocking this draft - the visible choices and defaults are explicit and
can be changed during plan review.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| Reader screen | empty state | n/a - departure guard exists only while a video reader with editable notes is open |
| Reader screen | loading state | AC 9; save-pending disables dialog controls and destination actions |
| Reader screen | error state | AC 11; preserve the editor and dialog while showing the save error |
| Reader screen | unauthorized state | AC 14; clear private draft and use existing access screen |
| Reader screen | density and ordering | AC 4–5; concise labeled dialog with three explicit actions |
| Reader screen | destructive-action confirmation | AC 3–7; discard is explicit, named and never the default focus |
| Reader screen | keyboard and viewport access | AC 5, 6, 19 |
| Reader screen | clean/dirty state | AC 1–2, 13, 17 |
| Internal navigation controls | destination behavior | AC 3, 7–10, 15, 17 |
| Internal navigation controls | duplicate activation while saving | AC 9–10 |
| Browser document lifecycle | reload/close warning | AC 16 |
| Existing `PATCH /api/v1/videos/:videoId/reading` | request authorization and shape | existing - bearer auth and `{ notes }` partial update, AC 8, 14 |
| Existing `PATCH /api/v1/videos/:videoId/reading` | success/failure result | AC 10–12, 14; existing response and error envelope |
| API versioning and rate limit | API contract | n/a - no API contract changes; existing mutation limit remains in force |
| Document/copy | dialog instructions and next action | AC 4; explain the edits are unsaved and offer save, discard or keep reading |
| Command/scheduled task | output, flags, exit codes and partial failure | n/a - this feature adds no command or scheduled task |

## Sources

- Owner approval of task 1 and request to submit tasks individually, 2026-10-07.
- [Active project decisions](../../STATE.md), especially AD-009, AD-013 and AD-015–AD-018.
- Existing draft, unload handler and save behavior in
  [ReadingTools](../../../services/channel-library/web/reading-tools.tsx); internal navigation,
  reader selection, polling and session handling in
  [App](../../../services/channel-library/web/main.tsx); current browser coverage in
  [reading.spec.ts](../../../services/channel-library/browser/reading.spec.ts).
