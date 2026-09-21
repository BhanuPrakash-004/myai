# P06 — Folder explorer, direct capture and note workspace

Implemented on 2026-09-19; final undo integration review on 2026-09-20. P06.01–P06.07 code is complete. **Rendered browser acceptance remains pending:** the browser runtime connected, but selection reported “No browser is available” and discovery returned an empty list. Live OpenRouter compatibility remains P05.11. These are separate from the successful service/build checks below.

## Delivered behavior

| Task | Implementation | Behavior |
| --- | --- | --- |
| P06.01 | storage/knowledge.ts; api/folders | Persistent root/nested/empty folders; rename/move; explicit ordering; added and historical aliases; collision/cycle protection. Note IDs and previous routes survive folder moves. Only empty folders without note-history references can be deleted; database references also protect retained operations. |
| P06.02 | knowledge/explorer.tsx; layout/sidebar.tsx; knowledge/workspace.tsx | App navigation and explorer share the sidebar. Every folder, including root, has a visible + with note/subfolder/import actions. Desktop note/chat panes and smaller-screen switching reuse the existing chat implementation. |
| P06.03 | knowledge/capture.tsx; knowledge/shared.tsx | Selected destination, title/body, Markdown/code preview, browser-local draft recovery and explicit “Improve with AI?” choice. No saves the supplied body unchanged through the canonical service without calling an AI provider. |
| P06.04 | storage/improvements.ts; api/improvements; capture.tsx | Durable original and proposal, side-by-side original/editable proposal, change list/uncertainties and rendered preview. Apply & Save atomically writes the note/version/source links/indexing enqueue. Reject, close, cancellation and provider failure preserve the original. Save original closes the proposal through the same guarded transaction. |
| P06.05 | note detail API/workspace; improvement service | Visible provenance, original sources, note version and per-stage processing state. Saved receipts link to /notes/{stable-id}. Missing projection handlers remain pending with their real reason. The model is asked to improve wording/organization without adding facts; owner review is still required. |
| P06.06 | workspace.tsx; capture.tsx; storage/knowledge.ts | Edit, move, importance, archive, trash, restore, source/history review, latest-operation undo and historical-content restore. Historical restore creates a new version with historical source links. A stale edit receives 409, retains the draft, fetches current content and requires explicit review/rebase before saving. Stale AI proposals must be rejected before rebasing. |
| P06.07 | explorer/workspace/capture; ui/dialog.tsx | Visible controls, long-name truncation with titles, root/empty/error/loading states, native keyboard-operable controls, modal Escape/focus restoration, scrollable forms and mobile pane switching. Behavior is implemented; rendered accessibility/viewport acceptance has not been claimed. |

The canonical note page remains authenticated and server-rendered with current text. The editor then uses private owner APIs. The old path-based reader and misleading permanent-delete dialog were replaced. Existing knowledge-path aliases continue redirecting to stable note IDs.

## Storage and consistency

No migration or new production dependency was required. Existing folders, folder_aliases, operations, improvement_proposals, note/version/source and processing tables provide the persistence.

Improvement generation records the immutable request/original before contacting OpenRouter. A completed proposal does not itself create or edit a note. Application locks the proposal, validates its state, executes the canonical expectedVersion write, links the original, queues current-version indexing and marks the proposal applied in one transaction. Repeating the same application key/input returns the existing receipt. A rejected or already-applied proposal cannot be reused to overwrite content.

Browser drafts use a versioned localStorage key per note or new-note destination. Closing the dialog preserves the draft and reviewed proposal; successful save removes it. Storage failures are visible. This is same-browser recovery, not cross-device synchronization or a backup. Source text for a requested AI proposal is additionally retained in its server operation. Interrupted inference is not guaranteed exactly-once billing; the owner may explicitly request another proposal after a failure.

Imports now accept a stable destination folder ID. Markdown bodies and original uploaded bytes remain unchanged; ZIP subfolders are nested under that destination. Existing paths cause a conflict instead of an overwrite.

Notes in archive/trash stay out of retrieval. Deleting a folder referenced by note history is refused so undo cannot point at a removed folder. Historical aliases are retained, not silently recycled for another folder.

## Validation

- Four focused PostgreSQL integration scenarios passed in `tests/integration/workspace.test.ts`: folder ordering/aliases/cycles/deletion; proposal source preservation, rejection and idempotent apply; competing edits and historical-source restore/undo; exact folder-scoped import/replay.
- Final production build passed, including TypeScript and all generated routes. ESLint passed for the changed code; a full lint run also passed before the final small navigation/focus edits.
- The authenticated HTTP suite passed all 10 scenarios on 2026-09-19, including canonical save/edit/move/export, source/status/history reads, unavailable improvement without mutation, owner access and process restart persistence. On 2026-09-20 the focused undo HTTP regression also passed: the workspace uses POST /api/operations/{id}/undo, restores the original source, returns the same receipt on retry and rejects obsolete history. The final production build and targeted lint passed after that correction.
- No live OpenRouter call was made or reported successful. Structured-provider fixtures are used only in the integration tests, never as runtime fallback data.
- Browser runtime discovery found no browser. SC01/SC02/SC06/SC14 rendered interaction acceptance is still open; no screenshot or visual verification is claimed.

The checks used isolated synthetic databases and uploads. No owner data was reset, imported or removed. Docker configuration remains the validated P05 web/API + worker + PostgreSQL layout; P06 was checked through the production Next build and real HTTP server, not another complete Docker image rehearsal.

## Next session

Next implementation is P07.01, explicit chat modes. Preserve these P06 contracts when introducing chat tools: use stable folder/note IDs, retain original sources, preview targeted edits, apply expectedVersion and idempotency controls, and show actual indexing state. Full chunk/embedding/graph projection handlers remain P08/P09.

When a browser becomes available, exercise root/nested +, exact save and canonical receipt, close/reload draft recovery, AI preview/reject/apply with compatible OpenRouter credentials, concurrent-edit review, folder moves/aliases, trash/restore/history/undo, keyboard focus and narrow-screen pane switching. Retain the separate P05.11 live compatibility record.
