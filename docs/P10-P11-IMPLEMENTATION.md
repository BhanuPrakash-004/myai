# P10/P11 implementation — 2026-09-21

## Practice and revision

`/quiz` and `/review` share `PracticePanel` and the authenticated `/api/study` service. Folder selection is real and nested, with optional topic search and a selected-note link from the reader/LeetCode view. Formats are MCQ, self-rated recall, short answer, explanation, code completion, debugging and predict-output. Code is displayed, never executed. Due, folder, weak, random, interview and exam modes use the same persisted cards and attempts. Interview selects explanation/code formats; exams defer answers, feedback and scores until completion. Recent sessions can be resumed.

Generation retrieves bounded current passages, creates one atomic card per selected passage, validates a verbatim supporting quote and valid MCQ options, then requests a separate structured support/atomicity/ambiguity judgment. Unsupported drafts are rejected; no generic questions are mixed into personal knowledge. Fingerprints deduplicate identical questions against the same source version. Cards retain chunk/note/version, quote, criteria, answer, explanation, model and generator version. Regeneration links to the old card and preserves history. This is evidence checking by models, not a mathematical guarantee of factual correctness.

Answer keys and rubrics stay server-side until submission/reveal. MCQ uses persisted UUID option IDs; session membership and sequence are enforced. Duplicate submissions do not add attempts or points. Free responses use a stored rubric and return correct/partial/incorrect/uncertain; inconsistent rubric judgments become uncertain. A one-character explanation cannot be accepted. Uncertain assessments do not schedule recall until the owner supplies an assessment. Corrections require the current attempt revision and a reason; original grading and raw recall history are retained. Revealed non-recall answers count as assisted, not unaided correct. Recall cards explicitly require reveal before self-rating outside exam mode.

Study writes serialize through a nonblocking PostgreSQL advisory lock for this single-owner application. A concurrent action returns retryable `STUDY_BUSY` instead of exhausting pool connections. Completed action receipts are idempotent; process interruption rolls back unpublished results. Model billing is not exactly-once: a crash after a model response but before database publication can repeat inference. Provider failures preserve the typed answer in the current UI; only accepted attempts affect learning. Current source checks happen again after external model calls.

### Scheduler: `myai-calendar-v1`

The deterministic scheduler is a transparent conservative calendar algorithm, **not FSRS**, a retention estimator, or a claim of optimal learning intervals. Only accepted recall outcomes alter schedules. Opening/searching/marking a note important has no effect on failures.

| Rating | Next interval | Recall record |
| --- | --- | --- |
| Again / wrong (0) | 10 minutes elapsed time | One lapse, streak resets |
| Hard / partial (1) | At least 1 day, half previous interval rounded down | Streak increases; latest rating remains weak |
| Good (2) | 1 day after reset, 6 days on second success, then double | Streak increases |
| Easy (3) | At least 3 days, then triple previous interval | Streak increases |

Intervals cap at 365 days. Calendar reviews are due at 09:00 in the session's saved IANA timezone; PostgreSQL handles date/DST conversion. Settings defaults to UTC, with an editable validated timezone. Raw events retain algorithm, rating, original timestamp, timezone and ordinal. Corrections replay recalls in their original order/time with the latest assessment for that attempt, preserving later reviews. Weak cards use the latest accepted rating (0/1), rather than every historical failure. Source changes or trash immediately exclude stale cards from new sessions and reject further grading against that version; history remains readable.

## Imports, portability and recovery

Import UI is shared by Settings and each folder's + action. It previews every target and offers skip, separate copy, or explicit append/merge. Merge requires the previewed current version and preserves the original body in a new note version. Unchanged source hashes deduplicate even with a different upload key; explicit copy creates a separate note. Per-file outcomes and receipts are persisted. Bounded batches commit atomically, so a failure cannot leave only some notes saved; retries reuse the stored upload and receipt. The UI reports preview/processing/completed outcomes, not a fictional percentage or streaming per-file commit.

Supported inputs: UTF-8 `.md`, `.txt`, `.java`, `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.c`, `.cpp`, `.h`, `.cs`, `.go`, `.rs`, `.sql`, `.sh`, `.css`, `.html`, `.json`, `.yaml`, `.yml`, singly or in ZIP. Code receives a safe Markdown fence; exact original text and original upload bytes are retained separately. JSON is imported as source text/code, not interpreted as a ChatGPT conversation archive. The legacy pasted-conversation endpoint continues saving full text through the canonical note/source service; PDF/OCR/Office/structured conversation extraction is not advertised.

Limits: 10 MB compressed upload, 200 content files, 500 total ZIP entries, 1 MB per entry, 20 MB expanded. Validation rejects traversal, absolute/reserved paths, links/special files, invalid UTF-8, NUL/binary content, encryption/unsupported compression, checksum/size mismatches and duplicate/case/normalized folder collisions. DEFLATE has an actual output bound even when headers lie. Paths never extract to disk. Folder names use canonical slugs and original paths remain in provenance. Moved-folder aliases cannot redirect an import outside its selected destination.

Document ZIP export uses a repeatable-read database snapshot and works without a `vault` directory. It includes current Markdown, stable local IDs, folders, lifecycle/provenance, full source text/links, graph evidence and an attachment inventory. Active-only and include-archive/trash options are visible in Settings. Limit: 10,000 notes / 50 MB uncompressed document and manifest content. It does not include all note versions, credentials, learning state or attachment bytes; importing it creates new local identities. Full backup is a separate operation.

No automatic Markdown mirror or filesystem watcher is retained. PostgreSQL is canonical; external Markdown changes require previewed explicit import. Full backup/restore and guarded permanent deletion are documented in [RECOVERY.md](RECOVERY.md).

## Files and deployment

- Practice: `src/lib/study/contracts.ts`, `src/lib/storage/practice.ts`, `/api/study`, `practice-panel.tsx`; dashboard weak/review counts use accepted current learning records. Old review/quiz APIs retain compatibility for old sessions; the old quiz API refuses new practice sessions.
- Portability: `imports.ts`, `export.ts`, `import-panel.tsx`, authenticated import/export routes.
- Recovery: `compose.recovery.yml`, `scripts/recovery.ts`, `scripts/recovery/recovery.sh`, `recovery-validate.ts`, `purge.ts`, storage recovery/purge services. Maintenance image includes validation and purge commands.
- Migrations: `0009_practice.sql` (study metadata, grading and fingerprints), `0010_attachment_purge.sql` (original-upload tombstones). Apply with `npm run db:migrate` or the Compose migration service before starting matching web/worker code. There are 41 application tables and 11 SQL migrations; no new production library was added.

## Validation and limits

Focused production-service PostgreSQL checks cover saved option IDs, wrong/partial/one-character answers, ordering, duplicate keys, reveal behavior, uncertainty/corrections, DST, reproducible replay, stale sources/regeneration, exam secrecy, source-preserving imports, duplicate hashes, conflicts, export without a mirror, unsafe inputs, trash retention, shared archive erasure, and full fresh-database restore. Additional checks and their final outcomes are recorded in TODO.md.

The provider fixtures are synthetic. No claim is made of measured live-model educational quality or perfect factual accuracy. Subsequent P12 work verified live four-task OpenRouter compatibility, container/HTTPS execution and bounded Chromium desktop/mobile workflows. See [P12 evidence](P12-RELEASE.md) for exact models, results and the remaining public-host/live-UI acceptance gates.
