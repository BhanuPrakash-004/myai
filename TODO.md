# MyAI implementation ledger

Updated: 2026-09-21. P01–P11 implemented, including P05.11 live task compatibility. P12 deployment/hardening/CI/documentation work is implemented and the local container/HTTPS/desktop/mobile rehearsal passed. Remaining acceptance gates: P12.04 public host, P12.06 broader UI acceptance, P12.08 license, P12.09 committed-checkout/full live matrix. See docs/P12-RELEASE.md.

Read [general.txt](general.txt) first. It is the authoritative product and architecture specification. Read [AGENTS.md](AGENTS.md) and the relevant installed Next.js guides before changing framework code.

This ledger replaces the old checklist. The exact previous checklist is preserved at [docs/archive/TODO-legacy-2026-09-18.md](docs/archive/TODO-legacy-2026-09-18.md). Its checked phases are historical claims, not acceptance evidence for this plan. [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) preserves the earlier audit; the latest product decisions are in general.txt.

## Product in one paragraph

A private, single-owner, self-hosted second brain with a folder explorer and adjacent AI chat. The owner uses a folder's + to add text, optionally improves it with AI, or sends /java class explanation to generate and automatically save an explanation in Java. Complete readable notes, original sources, versions and evidence-linked graph relationships power scoped RAG, search, revision and practice. OpenRouter supplies all AI. Other people deploy their own separate installations.

## Target and boundaries

- Retain Next.js, React, TypeScript, Tailwind and reusable Markdown/UI components.
- Use PostgreSQL + pgvector as the one canonical database, with PostgreSQL keyword search and relational graph tables.
- Drizzle/pg, Zod, Better Auth and Graphile Worker are installed/pinned. Storage, migrations, transactional enqueue and route/auth integration are implemented; durable worker runtime is implemented; production chunk, embedding and graph handlers are implemented in P08/P09.
- Use one server-side OpenRouter client for chat, structured improvement/extraction, embeddings and native reranking.
- Store complete Markdown in PostgreSQL. Exports/optional file mirrors are derived; they are not required for read/search/chat.
- Deploy web + worker + PostgreSQL using Docker Compose, with persistent database and attachment storage.
- Do not add multi-user workspaces, billing, a separate graph/vector server, or a second permanent database backend.
- Owner clarification: current vault/project data is disposable mock data. Default to an empty database; optional legacy note import must not become a release prerequisite.
- The UI target is a VS Code-like folder/document workspace with an adjacent AI tool panel. /java, /dsa, /os and /java/syntax are owner-created scopes; AI changes use typed tools with target IDs/version checks.
- Latest saved version is not the same as latest real-world fact. Require source dates/refresh for time-sensitive claims, source-backed citations and abstention; do not promise zero hallucinations.
- Ask mode is read-only. Generate & Save is write-authorized. A folder slash request defaults to Generate & Save unless the owner explicitly chooses another mode.
- Declining direct-entry improvement preserves the supplied body and performs no generation/improvement call. Background indexing is separate and visibly configurable.
- Core release includes folder capture, saved generation, modification, graph-backed retrieval, revision, private access and recoverable deployment. Rich editors, browser extensions and every possible upload format are later work.

## How to use this ledger

A checkbox means the task's behavior was implemented and its acceptance check passed. A module, screenshot, mock response or successful copied-rule evaluation does not count as completed integration.

Work in phase order unless an explicit dependency below allows independent work. Keep each change small enough to review. Preserve the workspace's existing uncommitted changes; do not reset the repository.

For every completed task, record:
1. Task ID and date.
2. Changed file paths and resulting behavior.
3. Actual validation command/scenario and outcome.
4. Remaining limitation, migration requirement or skipped external check.
5. The next uncompleted task ID.

Tests must exercise production services/repositories. Use temporary databases and synthetic sources; never run destructive fixtures against the personal vault. Add tests for meaningful failure modes and invariants, not mirrors of implementation.

No OpenRouter key is required for manual capture, documentation or deterministic mocked tests. Four live task checks passed with the exact model combination recorded in docs/P12-RELEASE.md; do not put keys in this file. Connection compatibility does not establish factual/retrieval quality.

## Verified current implementation (historical details retained below)

| Area | Implemented now | Still pending |
| --- | --- | --- |
| Canonical knowledge | PostgreSQL service, full bodies/sources/versions, atomic jobs/receipts, replay/conflicts, move/lifecycle/merge/undo; desktop/mobile save/edit verified | Broader live diff/conflict/undo browser acceptance |
| Current retrieval | Unified current-source passage retrieval, keyword + pgvector fusion, scoped rerank, optional evidence-linked graph expansion | Live model quality and large-library performance calibration |
| Application persistence | Knowledge/editor/search, chat/history, settings, dashboard, LeetCode, reading, practice and recall scheduling use PostgreSQL | Live evidence-quality evaluation |
| Folders | Nested/root/empty folders, aliases, moves/cycle protection, folder + capture; desktop/mobile creation verified | Large-tree and assistive-technology acceptance |
| AI | Typed OpenRouter client, live four-task compatibility, explicit embedding response aliases, shared budgets/concurrency, partial-response protection | Representative live retrieval/educational-quality evaluation |
| Study | Source-checked cards, seven formats, bounded grading, owner correction, durable sessions and timezone-aware recall scheduling | Live educational-quality calibration and browser acceptance |
| Authentication | Better Auth, one owner, local provisioning/recovery, private APIs/pages/downloads, origin checks, limiter, real local TLS proxy/cookie rehearsal | Public DNS/ACME and remote-network acceptance |
| Storage | 41 typed application tables, 11 migrations, pgvector, attachment integrity, portable exports and rehearsed full backup/restore | Public deployment/upgrade acceptance (P12) |
| Legacy | Runtime SQLite/Turso/Qdrant removed; optional read-only SQLite inventory and canonical note import retained | No requirement to import mock data |
| Deployment | Standalone frontend/API, matching worker/maintenance, persistent volumes, readiness, Caddy HTTPS path and CI | Public-host release, license and remaining P12 acceptance gates |

Read [docs/P05-IMPLEMENTATION.md](docs/P05-IMPLEMENTATION.md) for the current AI/worker implementation, validation and limitations. [docs/P03-P04-IMPLEMENTATION.md](docs/P03-P04-IMPLEMENTATION.md) records the storage/auth cutover. [docs/P01-P02-IMPLEMENTATION.md](docs/P01-P02-IMPLEMENTATION.md) is the historical foundation record. [README.md](README.md) contains current setup and recovery commands.

Key paths: src/lib/storage/, src/lib/auth/, src/lib/http.ts, src/app/(private)/, src/app/api/, migrations/, scripts/owner.ts, scripts/attachments.ts and tests/. No application route reads the old vault or SQLite store.

### Historical pre-P01 baseline (superseded by the implementation record)

| Check | Date | Observed result |
| --- | --- | --- |
| Local TypeScript: .\node_modules\.bin\tsc.cmd --noEmit --incremental false | 2026-09-18 | FAIL: six undefined useTurso references in src/lib/vector/pending.ts |
| npm run eval | 2026-09-18 | PASS: 104 cases; mostly copied decision rules, not a full production-engine test |
| npm run eval:retrieval | 2026-09-18 | PASS: 34 offline checks; not live embeddings/rerank/grounded-answer validation |
| Production build | 2026-09-17 | FAIL after bundling, on the same TypeScript references; not rerun during the documentation update |
| Lint | 2026-09-17 | FAIL: 38 errors, 17 warnings; not rerun during the documentation update |
| Isolated actual-service duplicate probe | 2026-09-17 | Same fact saved twice led to two generation calls, CREATE twice, overwritten content and version 1 |
| Isolated actual-service quiz probe | 2026-09-17 | A one-character answer was accepted; repeated submission produced score 3 for one question |
| Isolated HTTP/storage probe | 2026-09-17 | Anonymous personal routes returned 200; with file mirror disabled, API save/read worked while direct note page and export returned 404 |

These are the pre-repair findings. P01 now covers the duplicate/quiz defects with committed production-service regressions, and P02 tests real PostgreSQL migrations. Live OpenRouter, authenticated public deployment and complete workspace/RAG workflows are still unverified.

## P00 — Specification and audit handoff

- [x] P00.01 Record the owner's single-user product scope, folder + capture and slash-generated-answer autosave in general.txt.
- [x] P00.02 Select one target architecture and document readable content, provenance, graph, RAG, study and deployment invariants.
- [x] P00.03 Verify official OpenRouter embedding/rerank API availability and identify native reranking as supported.
- [x] P00.04 Preserve the legacy TODO and replace its inaccurate completion ledger with this ordered plan.
- [x] P00.05 Mark older requirements/recommendations as historical and record verified baseline versus planned work.

Exit check: general.txt, this ledger and legacy-document notices agree. No application feature is marked implemented by this documentation pass.

## P01 — Stop current data corruption and restore a trustworthy baseline

Dependencies: P00. Completed; do not expand legacy adapters further.

- [x] P01.01 Add a minimal production-service test harness with temporary storage and an injected/stub AI provider. Reproduce duplicate IGNORE falling into CREATE in both processMessageMemory and persistDecision, and the quiz partial-answer/repeated-attempt bugs. Verify the tests fail before fixes.
- [x] P01.02 Repair the six undefined useTurso references in src/lib/vector/pending.ts after checking intended backend selection. Typecheck must pass without suppressions or deleting the affected behavior.
- [x] P01.03 Make IGNORE/read-only outcomes terminal; protect an existing note from CREATE upsert replacement. Replaying a duplicate must neither regenerate nor reset its version.
- [x] P01.04 Grade current quizzes from stored question/answer data, validate session membership and deduplicate submissions. Remove substring acceptance/client-supplied truth; assert score never exceeds question count. Preserve a migration path for untrusted legacy totals.
- [x] P01.05 Remove silent in-memory production database fallback; fail with actionable diagnostics. Correct legacy schema migration ordering so an older DB missing status migrates before its index is created.
- [x] P01.06 Fix current lint/build errors without blanket disables. Run lint, nonincremental typecheck, build and the actual-service regressions; keep existing evaluation scripts clearly labelled for their limited coverage.

- [x] P01.07 Remove canned offline answers, fake fallback quiz material, invented fallback-note sections, obsolete seeding and unused starter assets. AI failure stays visible; notes retain supplied facts.
- [x] P01.08 Make direct note pages and Markdown ZIP export read canonical DB content with the file mirror disabled. Preserve full bodies, include a manifest and reject oversized/incomplete exports explicitly. Verify across container restart/recreation.

Exit check: known corruption is blocked, the app builds, and failures are caught by tests against real code. Public owner authentication remains P04.

## P02 — PostgreSQL foundation, schema and migration tooling

Dependencies: P01. Develop against a fresh isolated PostgreSQL/pgvector database.

- [x] P02.01 Read installed Next.js guides and verify/pin compatible Drizzle, pg, Zod, Better Auth, Graphile Worker and PostgreSQL/pgvector versions. Add schema/config validation and a tracked .env.example containing placeholders.
- [x] P02.02 Add reproducible development/test PostgreSQL setup and explicit versioned migration commands. Verify a fresh DB and an upgrade path; never mutate schema implicitly from a page request.
- [x] P02.03 Define notes, folders/aliases, immutable versions, sources/attachments, operations/proposals, conversations/messages/citations and installation/settings schema. Enforce foreign keys, uniqueness, sibling slugs, folder-cycle checks and one installation owner.
- [x] P02.04 Define chunk/profile/vector, graph/evidence and study/quiz schemas from general.txt. Keep provenance, owner review, lifecycle and processing state separate. Review dimensionality/index constraints for the selected embedding profile.
- [x] P02.05 Install Graphile's job schema and application processing state; prove a note transaction can enqueue a job atomically. A rolled-back note must leave neither a successful operation nor a runnable orphan job.
- [x] P02.06 Make fresh initialization the default for the owner's disposable mock data. Provide optional read-only SQLite/Markdown inventory with note hashes, conflicts, missing-content warnings and historical table counts; never read/export credential values. Remote Turso requires an explicit local export.
- [x] P02.07 Implement opt-in, rerunnable legacy note import with source/path mapping, full body hashes, original creation timestamps, provenance, initial versions, operation receipts and atomic indexing enqueue. Preserve conflicting DB/file copies separately and label origins migrated_unknown; do not import mock data automatically.
- [x] P02.08 Test fresh/upgrade migrations, checksum drift, note/job rollback, folder and owner constraints, edit races, stale graph/vector exclusion and optional import on isolated PostgreSQL databases. Compare source hashes/timestamps/rerun behavior and unchanged source SQLite. Inventory the five existing mock Markdown files without importing them.

Exit check: one explicit schema, real PostgreSQL invariant/transaction tests and a non-destructive optional inventory/import path exist. SQL and typed schema agree; creating tables does not complete application feature migration.

## P03 — One canonical knowledge service and complete persistence cutover

Dependencies: P02. This phase adapts all existing read/write surfaces before legacy runtime removal.

- [x] P03.01 Implement repositories/domain services with validated inputs and stable IDs. Centralize create, update, move, archive, trash, restore and explicit merge; no route performs independent content writes.
- [x] P03.02 Commit complete body, version, sources, operation result and indexing enqueue in one transaction. Add idempotency keys and expectedVersion conflict handling. Enforce lifecycle filters consistently.
- [x] P03.03 Add synchronous current-content keyword indexing. Preserve exact technical tokens through appropriate lexical matching; never wait for embeddings to make saved text searchable.
- [x] P03.04 Migrate knowledge tree/detail/editor/API, recent/important lists and search reads to the repository. DB-only content must open after a restart without vault files. Redirect old paths through stable aliases.
- [x] P03.05 Move chat history, settings, dashboard, LeetCode, review and quiz runtime persistence to PostgreSQL. Start empty for initial mock data; never treat old aggregate scores as valid recall evidence.
- [x] P03.06 Move imports, exports, AI writes, manual edits and merge/undo through the same service. Import complete content; derive file mirrors from committed data.
- [x] P03.07 Implement attachment staging/finalization/reconciliation, generated storage keys and DB metadata. Test interrupted work and orphan cleanup without deleting referenced files.
- [x] P03.08 Rehearse a fresh application cutover, restart and rollback. No mock-data preservation is required. If real owner data is later selected for migration, first verify its backup and source manifest.
- [x] P03.09 After all surfaces pass PostgreSQL integration checks, remove SQLite/Turso/Qdrant runtime branches and obsolete configuration/dependencies. Retain migration readers as needed; do not delete original data or backups.

Exit check: all application reads/writes share one authority; current note content, sources and versions survive restart, conflict and rollback tests. No permanent dual writes.

## P04 — Private single-owner access

Dependencies: P03; complete before making any deployment publicly reachable.

- [x] P04.01 Integrate Better Auth with the selected database adapter/session storage. Disable public signup and enforce one provisioned owner in backend invariants.
- [x] P04.02 Provide a local owner-provisioning and password-recovery command or unclaimable secret setup flow. Concurrent setup and a second signup must fail safely. Do not require email delivery for recovery.
- [x] P04.03 Require the owner session in every personal route, API, server action, stream, download and settings operation; enforce access in services where appropriate. Proxy/page redirects alone are insufficient.
- [x] P04.04 Configure secure cookies, session expiry/revocation, same-origin/CSRF protection and login throttling. Validate actual HTTP versus HTTPS deployment configuration.
- [x] P04.05 Add sign-in/sign-out/session-expired UI and protected redirect recovery. Check anonymous access, expired sessions, unsafe-origin writes, archive downloads and second-owner creation.

Exit check: SC13 passes with real HTTP tests; a single-user installation is still private online.

## P05 — OpenRouter client and durable background processing

Dependencies: P03 and P04. Mocked checks can run without an API key.

- [x] P05.01 Implement a typed server-only OpenRouter client for /chat/completions, /embeddings and /rerank. Validate environment/settings, keep keys out of browser bundles/responses/logs and remove arbitrary provider URL tests.
- [x] P05.02 Add independently configurable chat, structured, embedding and rerank model IDs plus embedding dimensions. Validate task capability and provider requirements; model names in general.txt are examples, not guaranteed account availability.
- [x] P05.03 Implement streaming completion with explicit final/partial/error status, timeout/cancel and usage capture. Do not save a truncated response as a finished note.
- [x] P05.04 Add JSON-schema requests with local Zod validation for improvements, graph extraction and study generation. Supported structured output is not a guarantee of factual correctness.
- [x] P05.05 Implement batch embeddings with recorded profile/model/dimensions and vector validation. Reject mismatched profiles; never substitute hash vectors as semantic embeddings.
- [x] P05.06 Implement native rerank request/result mapping, score/index validation and deterministic ordering/fallback. Pass only scoped candidates; preserve source IDs through reranking.
- [x] P05.07 Run Graphile tasks with transaction-safe enqueue, bounded retries/backoff, concurrency and version checks. Record per-stage pending/processing/ready/failed/stale status, heartbeat and actionable errors.
- [x] P05.08 Add the task registry, idempotent stage contract and retry/rebuild commands. Test worker termination, double delivery and obsolete-version guards with deterministic handlers. Actual chunk/embedding handlers are completed in P08; graph handlers in P09.
- [x] P05.09 Add owner settings for model IDs, AI indexing/rerank toggles, usage/budgets and connection checks. Prefer environment-managed secrets; encrypt any editable stored key using an independent deployment secret.
- [x] P05.10 Test authentication/credit errors, rate limits, transient failures, malformed output, cancellation and unavailable AI. Manual saves and lexical retrieval must still work.
- [x] P05.11 With the owner's supplied key, run an opt-in live smoke check for generation, structured output, embeddings and rerank. Record exact models/dimensions/date and observed failures; keep secrets and private notes out of fixtures.

Exit check: mocked reliability tests pass and live compatibility is separately documented. An unavailable live key does not justify faking embeddings or reporting live checks as passed.

## P06 — Folder explorer and direct capture

Dependencies: P03, P04 and P05's improvement client.

- [x] P06.01 Build persistent nested folder CRUD with root, empty folders, ordering, aliases and cycle/name-collision handling. Moves/renames preserve note IDs, citations and backlinks.
- [x] P06.02 Adapt the existing sidebar into an explorer plus app navigation and adjacent chat panel. Add a visible + beside each folder with Add note, Add subfolder and Import actions carrying that folder ID.
- [x] P06.03 Implement direct capture with title/body, Markdown/code preview, selected destination and recoverable draft. Ask Improve with AI? Choosing No saves the supplied body unchanged without generation.
- [x] P06.04 Choosing Yes preserves the original, requests an improvement proposal and shows an editable diff/preview. Apply & Save commits the proposal; reject/save original/cancel/failure cannot destroy the original draft.
- [x] P06.05 Keep improvement distinct from adding unrequested facts. Record provenance and source linkage; source preservation, note save and indexing status must be visible.
- [x] P06.06 Add note detail/edit/move/importance/archive/trash/restore and history/undo UI. Show version conflicts and allow a reviewed resolution rather than silently replacing a newer edit.
- [x] P06.07 Handle root/nested + actions, long names, empty/error/loading states, keyboard actions, focus restoration and mobile drawer/pane switching. Avoid hover-only controls.

Exit check: SC01, SC02 and the direct-edit parts of SC06/SC14 must pass in a browser and survive process restart. A saved receipt opens the canonical note. **Implementation is complete; browser acceptance remains pending because the browser runtime reported no available browser.** Synthetic service checks cover improvement/source preservation; live model compatibility remains P05.11. See [P06 evidence](docs/P06-IMPLEMENTATION.md).

## P07 — Explicit chat modes, slash generation and saved history

Dependencies: P05 and P06; scoped RAG answer quality completes in P08/P09.

- [x] P07.01 Add clear Ask, Generate & Save, Save As Written and Improve & Save actions/modes. Ordinary Ask does not mutate knowledge. Remove automatic memory writes from read-only chat.
- [x] P07.02 Implement slash picker/parser with stable server-resolved folder IDs, nested slugs and aliases. /java alone selects scope; unknown folders offer inline creation; ambiguous matches require selection.
- [x] P07.03 Make /java class explanation default to Generate & Save, including question-shaped prompts. An explicit Ask mode overrides generation intent. Document reserved commands and legacy /knowledge and /imp migration.
- [x] P07.04 Use a durable operation ID and preserve the input prompt/source. Stream the answer and commit the exact finalized answer, note, provenance, assistant message, operation result and indexing enqueue before emitting Saved.
- [x] P07.05 Display destination/title/open-note link and indexing state in a save receipt. Do not ask a second improvement/save confirmation for a successful slash generation.
- [x] P07.06 Handle cancellation, truncated stream, disconnected browser and server restart with recoverable operation status. Retry must deduplicate DB effects; acknowledge that an interrupted external inference may need to run again.
- [x] P07.07 Add typed AI tools for folder/note reads, scoped evidence search, create, targeted propose/apply edit, move and trash/restore. Save As Written and Improve/Modify use note ID, expectedVersion and a visible change set. Retrieved text cannot grant tool permissions; similar topics never authorize unrelated overwrites.
- [x] P07.08 Add conversation list, create/rename/archive/delete, reload recovery, stored message ordering and scope. Load trusted history server-side; reject client-controlled system roles and arbitrary hidden context.
- [x] P07.09 Add explicit Save this answer from Ask and contextual note selection. Keep answer citations, saved note sources and original chat links stable when folders move.

Exit check: SC03–SC06, including repeated prompts/request keys, explicit Ask with folder scope and saved-response reload, are covered by focused service/HTTP checks. Browser interaction and live-provider acceptance remain unverified because no browser connection or configured OpenRouter key was available. See [P07 evidence](docs/P07-IMPLEMENTATION.md).

## P08 — One reliable retrieval and grounded-answer pipeline

Dependencies: P03, P05 and P07.

- [x] P08.01 Replace competing search/context paths with one typed retrieval service used by chat, search and study. Apply current-version/lifecycle/folder scope filters at every stage.
- [x] P08.02 Implement heading-aware chunking with overlap and code/list preservation, offsets, hashes, version and token budgets. Connect the durable chunk/embedding handlers and test interrupted reindexing. Long notes must retain searchable late paragraphs.
- [x] P08.03 Combine PostgreSQL lexical ranking/exact-token matching and pgvector similarity using a documented fusion method. Begin with measured exact scans if sufficient; add ANN indexes when justified by library size/performance.
- [x] P08.04 Use active embedding profiles consistently; batch/retry reindex without mixing vector spaces. Exclude stale/deleted chunks and keep current full-text/direct-context fallback available.
- [x] P08.05 Rerank bounded scoped candidates through OpenRouter, select a diverse evidence set, and pass actual passage text plus stable citation IDs into generation. FTS-only results must still populate the prompt.
- [x] P08.06 Render clickable citations to exact note/chunk/version evidence. Validate returned citation IDs against supplied evidence and evaluate factual support separately; ID validity alone is insufficient.
- [x] P08.07 Treat retrieved content as untrusted data, preserve conflicting sources/origins and abstain when evidence is missing. Distinguish personal-library answers from explicitly requested general generation.
- [x] P08.08 Handle broad folder summaries with explicit coverage/aggregation rather than claiming a few top hits summarize the entire folder. Support quoted syntax, filters, pagination and relevant snippets in search UI.
- [x] P08.09 Create actual-pipeline fixtures for code tokens, paraphrases, non-developer subjects, long notes, conflicting facts, empty evidence and folder leakage. Record recall@k, citation support, latency and observed usage; compare with a keyword-only baseline.

Exit check: current-source, scope, fallback, citation/claim handling and recovery checks pass with real repositories and mocked providers. Controlled recall/support results and limitations are recorded in docs/P08-P09-IMPLEMENTATION.md; live model quality and browser acceptance remain separate.

## P09 — Evidence-linked knowledge graph

Dependencies: P08 and P05's structured extraction. Graph support is part of the core release.

- [x] P09.01 Implement note, concept, topic and source identities with typed relationships and deterministic folder/note/source links. Prevent dangling endpoints and duplicate edges.
- [x] P09.02 Connect a durable graph-extraction handler and extract proposed concepts/relations from current chunks using validated structured outputs. Persist exact supporting source/chunk/version/offsets, model/extractor version and provenance; test interrupted/replayed extraction.
- [x] P09.03 Resolve scoped concepts/aliases conservatively; distinguish different meanings of the same label. Preserve conflicting relations and owner corrections; never equate confidence with truth.
- [x] P09.04 Keep curated relationships separate from rebuildable AI projections. On edit/trash/rebuild, invalidate stale evidence and prevent older tasks from replacing newer results.
- [x] P09.05 Add bounded graph expansion to retrieval with scope/current-version checks, deduplication and limits. Retrieve supporting passages; a relation alone is not factual evidence.
- [x] P09.06 Add a focused graph neighborhood and accessible relationship list with source inspection, proposed/curated state, correction/merge and removal controls. Avoid an unreadable whole-vault visualization.
- [x] P09.07 Evaluate prerequisite/multi-note questions and ambiguous/conflicting concepts against the P08 baseline. Keep graph candidate expansion configurable where it harms measured retrieval.

Exit check: SC09 source invalidation, curated-history retention and reviewed bridge expansion pass in production-service fixtures. The bridge fixture improves expected-source coverage with no stale or out-of-scope evidence. This is not a general live-model quality claim.

## P10 — Revision, practice and trustworthy learning records

Dependencies: P08 and P09.

- [x] P10.01 Generate atomic study cards/questions from selected current evidence with source versions and server-side answer keys/rubrics. Separate generic starter content from personal knowledge.
- [x] P10.02 Implement MCQ and self-rated recall first. Persist question/option IDs and attempts; verify session membership and submission idempotency; derive bounded session scores from accepted attempts.
- [x] P10.03 Add short-answer/explanation, code completion/debugging and predict-output formats with suitable rubrics, source feedback and uncertain-grade/owner-correction handling. Do not execute arbitrary code on the app server.
- [x] P10.04 Implement a documented deterministic spaced-review scheduler with algorithm version, raw recall events and timezone-aware due dates. Search/view events and importance cannot increase failure counts.
- [x] P10.05 Add due cards, topic/folder practice, weak areas, random/interview/exam sessions and feedback/next-review views. Reuse the same source/study model for optional LeetCode presentation.
- [x] P10.06 Mark cards stale when source content changes or is trashed; offer regeneration with history retained. Practice answers do not become knowledge without an explicit save action.
- [x] P10.07 Test wrong/partial answers, duplicate/out-of-order submissions, reveal behavior, rubric uncertainty, source changes, day/timezone boundaries and reproducible scheduling.

Exit check: SC10 passes; the previous one-character acceptance and score-above-total bugs cannot recur.

## P11 — Portable data, imports, export and recovery

Dependencies: P03, P06 and P10 for complete learning-state backups.

- [x] P11.01 Complete text/Markdown/code and Markdown ZIP import into a chosen folder. Preserve original source/full extracted text and item progress; validate supported extensions explicitly.
- [x] P11.02 Implement source-hash/operation deduplication and visible skip/create/merge choices. Test nested paths, filename collisions, unsafe ZIP paths, decompression limits, unsupported types and interrupted imports.
- [x] P11.03 Export canonical DB notes as folders/Markdown with stable IDs, provenance/relations and attachment/graph manifests. Export must work with the optional file mirror disabled.
- [x] P11.04 If retaining the existing Markdown mirror feature, make it a derived projection with observable retry/rebuild. External edits go through explicit import/conflict handling.
- [x] P11.05 Provide full database + attachment backup/restore and validation commands, with encryption-secret recovery documented separately. A note ZIP must not be described as a complete installation backup.
- [x] P11.06 Restore into a fresh instance and verify notes/versions, curated graph, conversations, attempts/schedules, owner access and attachments. Test trash retention, final deletion and removal of associated derived/private data.
- [x] P11.07 Clearly label unsupported formats in UI and docs. Preserve or disable legacy ChatGPT import until it follows the same safe full-content source pipeline.

Exit check: SC11/SC12 pass, and an owner can recover the installation without its original file mirror.

## P12 — Deployable, accessible open-source release

Dependencies: P01–P11. Packaging groundwork can be developed earlier; release acceptance depends on all core scenarios.

- [x] P12.01 Package Next standalone web and the matching worker/migration artifacts. Use a pinned PostgreSQL/pgvector image and persistent named DB/files volumes; no public DB port.
- [x] P12.02 Provide validated Docker Compose commands for first setup, serialized migrations, owner provisioning, startup, upgrade and rollback. Test non-root container/volume permissions and worker restart behavior.
- [x] P12.03 Add liveness, DB readiness, worker heartbeat and visible degraded AI/index state. Manual-note readiness cannot require an OpenRouter key.
- [ ] P12.04 Document and test one HTTPS deployment path with streaming-compatible proxy/timeouts, app origin, session cookies and remote browser access. Managed hosting instructions must account for separate worker/durable files.
- [x] P12.05 Enforce request/upload/time/concurrency limits, secret redaction and private download protection. Safely render untrusted Markdown/links and serve attachment MIME types without script execution. Exclude .env files, local DB/vault/backups and secrets from container/build contexts; allow a sanitized tracked .env.example.
- [ ] P12.06 Complete keyboard/mobile/accessibility checks across sidebar, chat, editor, diff, dialogs, graph/list and review. Verify long Markdown/code, empty/loading/failure, reconnect and recovery states.
- [x] P12.07 Add CI for typecheck, lint, build, real-service tests, fresh/upgrade migrations, PostgreSQL integration and critical browser flows. Keep opt-in live AI evaluation separate.
- [ ] P12.08 Replace scaffold README with actual setup, model configuration, screenshots, architecture, backup/restore, troubleshooting and upgrade instructions. Add contribution/security guidance and synthetic demo data; use the owner's chosen open-source license.
- [ ] P12.09 Rehearse from a clean checkout without a key, then with configured OpenRouter models. Verify persisted data after restart/upgrade, backup restoration and SC01–SC15; record exact commands/environment/results.
- [x] P12.10 Remove obsolete flags/docs/dead runtime paths, review dependency/runtime packaging and record remaining limitations. Publish/claim supported capabilities only after their acceptance evidence exists.

P12 acceptance remaining (do not treat these as missing core architecture):
- P12.04: Caddy configuration and local real-TLS cookies/origin/SSE verified; public DNS/ACME/external-network access needs the owner's actual host/domain.
- P12.06: Chromium desktop/mobile capture/edit/search/chat/graph/review checks passed, including unavailable-AI draft preservation, safe long Markdown, Escape/focus return, mobile overflow and serious/critical automated accessibility checks on search/graph/review/chat. Full live improvement/diff, populated learning flows, reconnect and assistive-technology acceptance remain to be completed.
- P12.08: README/screenshots/contribution/security/demo work supplied; LICENSE awaits the owner's selection.
- P12.09: clean container build/fresh volumes and separate live model checks supplied. A committed clean-checkout run and the complete SC01–SC15 live/browser matrix remain a release gate.

Exit check: SC15 plus every core acceptance scenario passes. “Dockerfile exists” is not evidence of a deployable release.

## Acceptance traceability

The complete scenario definitions are in general.txt, section 17.

| Scenario | Main task groups |
| --- | --- |
| SC01: exact direct save | P03, P06 |
| SC02: improvement preview/original preservation | P05, P06 |
| SC03: slash generation and same-answer autosave | P05, P07 |
| SC04: read-only scoped Ask with evidence | P07, P08 |
| SC05: idempotency and no unrelated overwrite | P01, P03, P07, P10 |
| SC06: conflicts, moves and stable links | P03, P06, P07 |
| SC07: interrupted workers/providers and current fallback | P05, P08 |
| SC08: accurate scoped retrieval and abstention | P08, P09 |
| SC09: evidence-linked graph invalidation | P09 |
| SC10: grading and actual recall scheduling | P01, P10 |
| SC11: full-content safe import | P11 |
| SC12: DB-only read/export and full restore | P03, P11 |
| SC13: anonymous/second-owner access denied | P04 |
| SC14: responsive accessible recovery states | P06, P07, P12 |
| SC15: documented fresh deployment/upgrade | P12 |

## Later additions — not required to finish the core release

These still follow the same canonical-source, auth, versioning and indexing rules.

- [ ] L01 PDF import with page-aware extraction, evidence references and failure reporting.
- [ ] L02 Web-page snapshot import with safe URL/redirect handling and preserved retrieval time/source.
- [ ] L03 ChatGPT/export import through the canonical pipeline, with role/conversation provenance.
- [ ] L04 OCR/image and audio transcription support via verified OpenRouter-capable endpoints/models where available; revisit scope if a required capability is unavailable.
- [ ] L05 Rich text editing, bidirectional Obsidian sync with conflict handling, optional browser/VS Code capture clients.
- [ ] L06 Advanced scheduling and question formats after measured learning feedback.
- [ ] L07 Managed-hosting deployment variants and large-library performance tuning supported by benchmarks.

Do not delay reliable core saving and retrieval to implement these additions.

## Completed-session record

### 2026-09-18 — Specification and implementation handoff

Completed P00.01–P00.05.

Changed general.txt and TODO.md; preserved the previous TODO under docs/archive/; added historical-status notices to info.txt and ARCHITECTURE_REVIEW.md. No application source changes were made in this documentation pass.

Inspected current implementation and verified official OpenRouter embeddings/native rerank capabilities. Re-ran the TypeScript and two existing evaluation commands; results and limitations are recorded above. Did not claim live model access, PostgreSQL migration or a successful deploy.

At that time the next task was P01.01. It is now completed; see the implementation session below.

### 2026-09-18 — P01 correctness and P02 storage foundation

Completed P01.01–P01.08 and P02.01–P02.08. The owner's latest clarification makes existing mock-data preservation optional. That scope change is reflected in P02.06–P02.08; it is not a claim that historical chats, settings or every Turso record were migrated.

Initial real-service regressions reproduced seven failures; all now pass. Validation: 15 service/config/HTTP tests, 12 PostgreSQL integration tests, nonincremental typecheck, lint, Next production build, 104 legacy memory cases and 34 offline retrieval checks. Drizzle reports no schema drift; the patched dependency set reported zero npm advisories. Built and started both Docker images; HTTP, persistent note read after restart/recreation, direct DB-only page and exact Markdown export checks passed. The runtime is non-root and contains no copied environment files. Details are in docs/P01-P02-IMPLEMENTATION.md.

Changed paths and deployment details are in the implementation report. Existing uncommitted work was preserved. No OpenRouter credential, live-model evaluation, full RAG claim, authenticated public endpoint or completed VS Code workspace is asserted.

At that time the next task was P03.01. P03/P04 are now completed in the session below. Future retrieval must use current_chunks/current_embeddings/current_graph_edges with explicit scope; evidence quotation existence is not semantic truth.

### 2026-09-19 — P03 persistence cutover and P04 private owner access

Completed P03.01–P03.09 and P04.01–P04.05. Every existing application surface now uses PostgreSQL; private APIs, pages, streams and downloads require the single owner. Canonical writes preserve full bodies, original sources, immutable versions, idempotent receipts and atomic index jobs. Conflicts cannot silently overwrite newer edits. Attachments have staged recovery; imports/export do not depend on the mock vault.

Changed storage/domain modules, migrations 0002/0003, auth/http guards, all private routes/pages, capture/editor/chat/study/settings integration, Docker/env setup and local owner/reconciliation commands. Removed legacy runtime SQLite/Turso/Qdrant branches; retained only the optional SQLite maintenance reader. Full file map and per-task evidence: [docs/P03-P04-IMPLEMENTATION.md](docs/P03-P04-IMPLEMENTATION.md).

Validation passed: 4 configuration/guard tests, 25 PostgreSQL tests, 9 real HTTP scenarios, typecheck, lint, production build and Docker builds. Re-ran only the 13 affected canonical scenarios after fixing persisted chat context/completion handling, question punctuation and undo after folder rename. Disposable Docker rehearsal passed owner provisioning/login, exact note/export bytes, image/container recreation, restart and PostgreSQL snapshot rollback. No private data or real owner credentials were used. Production npm audit reported zero vulnerabilities at check time.

Migration impact: fresh databases start empty; explicit migrations upgrade the P02 schema. Original mock files remain untouched. PostgreSQL and attachment named volumes persist runtime data. Snapshot rollback was rehearsed with the matching current application and synthetic data; full backup automation and arbitrary schema/image downgrade support are not claimed.

Limitations: no live OpenRouter key/call; no embeddings, rerank, graph extraction handlers or measured semantic retrieval. Current chat uses keyword evidence. Full explorer/chat/improvement workflows remain P06/P07; recall scheduling remains P10. Actual public HTTPS proxy and browser accessibility acceptance remain P12. Existing HTTP tests verify HTTPS cookie configuration, not an external TLS deployment.

At that time the next task was P05.01. The implementation session below completes P05.01–P05.10; live compatibility remains separate.

### 2026-09-19 — P05 OpenRouter and worker implementation

Completed P05.01–P05.10. P05.11 remains unchecked: the server has no configured OpenRouter API key or chat/structured model, so live compatibility was not claimed. The user repeated P05; this session did not infer authorization to implement P06 as well.

Added a typed fixed-endpoint client, independent model settings, strict structured contracts, complete-stream enforcement, validated embedding profiles, native scoped rerank/fallback, atomic usage admission, owner-visible allowances/usage/status and synthetic connection checks. Added a deployable Graphile worker with heartbeat, bounded retries, version/configuration fences, idempotent publishing, crash recovery and retry/rebuild controls. Chat/quiz now use this client. Actual chunk/embedding and graph handlers remain P08/P09.

Changed paths, migration 0004, commands, invariants and evidence: [docs/P05-IMPLEMENTATION.md](docs/P05-IMPLEMENTATION.md). Validation passed: 12 client/config tests, 31 PostgreSQL scenarios across the suite and focused corrections, 9 real HTTP scenarios, typecheck, lint and production build. Drizzle reports no schema drift. The worker fixture was killed in a separate process to verify recovery and exactly-once database publication, not exactly-once provider billing.

Docker deployment rehearsal passed: migration completed, PostgreSQL/web/worker became healthy, a synthetic note reached the queue with the correct pending HANDLER_NOT_IMPLEMENTED state, and worker restart preserved its version/stages with a fresh live heartbeat. No user data was reset. No live provider, complete graph/RAG accuracy or finished workspace claim is made.

Remaining acceptance: **P05.11** with the owner's configured key/models. Next implementation: **P06.01**. Projection handlers must use the P05 prepare/publish contract and must never mark missing/failed/stale work ready.

### 2026-09-19–20 — P06 explorer, direct capture and note workspace

Implemented P06.01–P06.07: nested folder management/order/aliases, visible root/nested + actions, scoped Markdown/ZIP imports, persistent browser drafts, Markdown/code previews, durable original/proposed improvement review, canonical save receipts, note editing/move/importance/archive/trash/restore, source/history inspection, guarded undo/content restore and reviewed version-conflict resolution. The sidebar now contains the explorer; the note workspace includes an adjacent chat pane and mobile pane controls. Dialogs use native modal behavior with Escape/focus restoration. Original sources and derived-index status are visible; missing index handlers are never shown as ready.

No database migration or production dependency was needed. The existing canonical storage and improvement_proposals/operations tables are used. Updated implementation map, focused validation results and limitations: [docs/P06-IMPLEMENTATION.md](docs/P06-IMPLEMENTATION.md). Live OpenRouter calls remain unverified without credentials. Browser connection discovery returned no available browsers, so browser/visual acceptance is explicitly pending rather than reported as passed.

Validation: four focused PostgreSQL scenarios and ten authenticated HTTP/restart scenarios passed. Final review corrected the undo button to use the dedicated operation endpoint; its focused HTTP regression, production build/TypeScript and targeted lint passed on 2026-09-20.

Next implementation: **P07.01**. Retain P05.11 live compatibility and P06 browser acceptance as separate open checks. Do not implement fake indexing to make the status look complete; full chunk/embedding/graph handlers remain P08/P09.

### 2026-09-20 — P07 explicit chat, recovery, history and typed tools

Implemented P07.01–P07.09. Added Ask/Generate & Save/Save As Written/Improve & Save modes; stable-ID slash scope and aliases; inline nested folder creation; explicit target/version selection; atomic exact generated saves and receipts; durable operation IDs/checkpoints/attempt tokens/cancel/status/retry; server-owned conversation history with create/rename/archive/restore/delete and pagination; reviewed typed note tools; Save this answer; stable note/version evidence and original-chat links. Rejected or stale proposals cannot overwrite notes. Improvement history recovers an already committed receipt even if final message reconciliation was interrupted.

Migration 0005_chat_lifecycle.sql adds a conversation deletion marker. Deleting hides conversation history while retaining messages needed by saved-note provenance; it is not a secure data purge. Existing migrations are unchanged and no production dependency was added. Required upgrade command remains npm run db:migrate, or the Compose one-shot migration service.

Validation: seven focused P07 PostgreSQL scenarios across initial and targeted runs, the earlier canonical chat regression, 12 storage/migration scenarios, and 12 authenticated HTTP/restart scenarios passed. Build/TypeScript, ESLint and Drizzle schema consistency passed. Full live OpenRouter quality and browser interaction are not claimed; the browser runtime again reported no available browser. Detailed contracts, limits and file map: [docs/P07-IMPLEMENTATION.md](docs/P07-IMPLEMENTATION.md).

Next implementation: **P08.01**, unified retrieval and production chunk/embedding handlers. Preserve server-authorized tool targets, original source linkage, expected versions, stable citations and operation fencing. P05.11 and P06/P07 browser/live acceptance remain separate open checks.

### 2026-09-20 — P08 unified retrieval and P09 evidence-linked graph

Implemented P08.01–P08.09 and P09.01–P09.07. Added production chunk/embedding/graph handlers, durable inference staging, complete-profile activation, one scoped retrieval service, exact pgvector + lexical rank fusion, bounded rerank/graph expansion, current-text fallback, exact-version evidence pages, checked Ask citations/claim support, explicit summary coverage, search filters/pagination and graph review/alias/merge controls. Original content and curated graph history remain authoritative and version-linked.

Migrations: 0006_retrieval_graph.sql, 0007_retrieval_indexes.sql and 0008_projection_cache.sql. Run npm run db:migrate (or Compose migration service), deploy matching web/worker and rebuild existing notes. No new production dependency was added. A credential in .env.example was moved to ignored local configuration and the template was cleared.

Validation: 25 initial PostgreSQL retrieval/storage/worker checks passed; the added conflict/folder-move case and interrupted retry case passed in a focused run. Twelve existing HTTP scenarios and the added evidence/graph/empty-Ask HTTP scenario passed across full and targeted runs. Final production build/TypeScript, full plus targeted lint, Drizzle schema consistency and git diff whitespace checks passed. Focused study grading/review and exact-token regressions also passed after the final retrieval adjustment. Synthetic recall@2 was 2/3 keyword versus 3/3 hybrid; reviewed graph bridge expected-source recall@8 was 1/2 versus 2/2. These use controlled provider fixtures and do not establish live model quality. Browser discovery returned no connections. Live OpenRouter compatibility remains P05.11.

File map, exact contracts, measured fixtures, deployment commands and limitations: [docs/P08-P09-IMPLEMENTATION.md](docs/P08-P09-IMPLEMENTATION.md). Next implementation: **P10.01**. Do not mark live factual accuracy, browser acceptance or a finished public release as passed from these results.

### Template for the next completed session

- Date / completed task IDs:
- Resulting behavior:
- Changed paths:
- Validation commands and results:
- Migration/data impact:
- Limitations and unrun checks:
- Next exact task ID:


### 2026-09-21 — P10 revision and P11 portability/recovery

Completed P10.01–P10.07 and P11.01–P11.07. Practice now uses current source passages, stored option IDs/keys/rubrics, seven formats, reveal-aware and uncertain grading, versioned owner corrections, deterministic timezone-aware scheduling, resumable due/folder/weak/random/interview/exam sessions and stale-card regeneration. The reader and LeetCode notes link to the same practice flow. No practice result writes knowledge implicitly.

Imports now preview supported UTF-8 text/code/Markdown/ZIP files, show per-file outcomes, and offer deduplicated skip, separate copy or version-checked append/merge. Original bytes/full extracted text are preserved. Archive paths, collisions, compression output, sizes and encodings are checked. Bounded batches commit atomically and retries recover their receipts. Document export reads a consistent DB snapshot, includes source/graph/attachment manifests and can include archive/trash. No Markdown mirror is retained.

Added cross-platform Compose recovery orchestration, checksum-verified PostgreSQL/attachment bundles, fresh-only restore, migration/data/owner validation and guarded local permanent deletion after 30 days in trash. Shared upload tombstones remove original ZIP bytes containing purged information while preserving other notes and immutable source records. Full restore was rehearsed in isolated databases with owner password verification, graph/chat/history/learning counts and attachment integrity.

Migration requirement: apply 0009_practice.sql and 0010_attachment_purge.sql before running matching web/worker code. Maintenance image includes validation/purge scripts; recovery uses compose.recovery.yml. No new production dependency. Details: [P10/P11 implementation](docs/P10-P11-IMPLEMENTATION.md), [recovery runbook](docs/RECOVERY.md).

Cleanup: removed obsolete fix.md, unused copied-rule evaluation modules and the five explicitly disposable mock vault notes. Preserved deployment secrets, legacy SQLite files, dependencies, migration history, historical requirements and the existing staged changes. Git is intentionally not reset or committed.

Validation: seven focused study/portability scenarios (including actual PostgreSQL+attachment restore), canonical/storage regression scenarios, production HTTP privacy/workflow checks, typecheck/lint/build and no Drizzle schema drift. See the final session report for exact results. Synthetic model fixtures do not prove live model accuracy; browser interaction acceptance remains open.

Next implementation: **P12.01**, continuing release packaging/HTTPS/upgrade/accessibility acceptance. Keep P05.11 live-model compatibility as a separate open task.

Final validation evidence (2026-09-21):
- `node --import tsx --test tests/integration/study-portability.test.ts`: 7/7 production-service scenarios passed, including same-key concurrent generation and an actual PostgreSQL/attachment restore.
- Canonical/storage regressions: 24 existing scenarios passed on the first run; an old folder-error wording assertion was corrected and its focused rerun passed. The migration-upgrade rerun passed with all 11 migrations.
- Production HTTP: 13 existing privacy/workflow scenarios passed; the new P10/P11 scenario passed in isolation after resetting its fixture credentials/throttle. No application authentication exception was added.
- Production Next build/TypeScript and lint passed; Drizzle reported no schema drift; recovery Compose configuration and Git whitespace checks passed.
- Live provider quality and visual browser acceptance were not run. The next phase remains P12.01.

### 2026-09-21 — P12 deployment, workflow verification and documentation

Completed P12.01–P12.03, P12.05, P12.07 and P12.10, plus P05.11. Implemented the local portions of P12.04/P12.06/P12.08/P12.09 without checking off their remaining release gates.

Changed Dockerfile/Compose packaging, `compose.https.yml`, `deploy/Caddyfile`, `scripts/setup-env.mjs`, `/api/ready`, bounded request reads, shared AI admission, safe Markdown, navigation/focus/contrast and deterministic note-history timestamps. Removed the obsolete explorer import branch. Added `scripts/release-check.mjs`, browser/CI workflows, opt-in isolated live checks, README, contribution/security guidance, synthetic import content and a real synthetic screenshot. Exact paths/behavior and commands are in docs/P12-RELEASE.md.

Validation passed: fresh Docker web/maintenance builds with no key/secrets; isolated first setup and owner provisioning; no-key note/idempotency/search and attachment persistence; worker restart/indexing; migration rerun and container recreation; real Caddy TLS/cookies/origin/SSE; UID 1000 and image secret-file exclusion; liveness 200 versus readiness 503 with PostgreSQL stopped. Final Chromium desktop/mobile workflows both passed, including AI failure draft preservation, long Markdown safety, save/edit/chat/navigation, focus return and bounded automated accessibility checks. Production HTTP: 14/14. Focused storage/worker/portability: 25/25 including actual backup/restore. Subsequent OpenRouter/worker regression run: 16/16. Types, lint, builds, combined Compose config and whitespace checks passed. Temporary release fixtures were removed and the test database container stopped; no owner data or git staging was changed.

Live models passed at 2026-09-21 13:29:20 UTC: chat `nvidia/nemotron-3-ultra-550b-a55b:free`, structured `openai/gpt-4.1-mini`, embedding `openai/text-embedding-3-small` (1536), rerank `nvidia/llama-nemotron-rerank-vl-1b-v2:free`. The original free structured/embedding choices failed; an explicit upstream OpenAI model-name alias bug was fixed. Private `.env.local` remains unchanged. Model compatibility is not a live accuracy benchmark.

No new migration: use all eleven existing migrations through 0010. Next open task by ledger order: **P12.04**, public-host DNS/ACME/remote access acceptance. Also open: P12.06 broader live diff/practice/reconnect/assistive-technology flows; P12.08 owner's license choice; P12.09 committed-checkout/full SC matrix. Do not claim a published release or perfect factual/retrieval accuracy. Do not repeat completed deterministic checks without a relevant change or failure.
Final correction-audit follow-up: each raw recall/correction event now also stores its grading revision, feedback and assessment snapshot. The focused rubric/correction check and final production build passed after this change.
