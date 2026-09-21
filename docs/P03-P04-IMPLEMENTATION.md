# P03 / P04 implementation record

Date: 2026-09-19. Scope: complete the application's PostgreSQL cutover and private single-owner access. Next task: **P05.01**.

This records implemented behavior, not completion of the full second-brain product. The canonical specification is [general.txt](../general.txt); the task ledger is [TODO.md](../TODO.md).

## P03 task record

| Tasks | Files | Result and acceptance evidence |
| --- | --- | --- |
| P03.01–02 | src/lib/storage/knowledge.ts, access.ts, client.ts; migrations/0002_hesitant_lethal_legion.sql and 0003_canonical_guards.sql | Validated stable-ID create/edit/move/archive/trash/restore/merge/undo. Complete body, immutable version, original sources, receipt and indexing enqueue commit together. Idempotency replay, payload collision, expected-version conflicts and concurrent edits verified against PostgreSQL. |
| P03.03 | src/lib/storage/knowledge.ts; existing notes search-vector schema | Synchronous current-active keyword search, descendant/exact-folder scope and literal technical-token matching. Tests exercise C++, Map.Entry and changed/archived content exclusion. This is lexical retrieval, not semantic RAG. |
| P03.04 | src/app/api/knowledge/, notes/, folders/, search/; src/app/(private)/knowledge/ and notes/; src/components/knowledge/ | All existing knowledge views and editor read canonical PostgreSQL. Stable-ID detail pages and old-path aliases survive rename/restart without vault files. Editor sends expectedVersion and retains conflict errors. Basic folder + note/subfolder capture exists; full workspace remains P06. |
| P03.05 | src/lib/storage/chat.ts, settings.ts, study.ts; private pages and corresponding API routes | Chats, settings, dashboard, LeetCode metadata, reading sessions and quizzes use PostgreSQL. Saved conversation context is bounded and excludes failed/incomplete turns. Quiz grading uses stored keys, membership and current source versions; reading feedback is not presented as quiz accuracy. |
| P03.06 | storage/imports.ts, legacy.ts; api/import/, import/chatgpt/, export/, chat/, operations/ | Markdown/ZIP import preserves full UTF-8 bodies and original upload bytes; batch conflict rolls back all notes. Export reads committed active notes and includes a manifest. Manual/AI/import/merge/undo note writes use the canonical service. Pasted chat import preserves supplied text; remote shared-page scraping and automatic distillation are not implemented. |
| P03.07 | storage/attachments.ts; api/attachments/; scripts/attachments.ts | Generated keys, staged/ready/failed states, SHA-256 checks, replayable finalization and explicit reconciliation. Tests cover rename-before-commit interruption, missing bytes and orphan cleanup while retaining tracked files. |
| P03.08 | Dockerfile, docker-compose.yml, .env.example; real HTTP and disposable Docker rehearsal | Fresh migration/start, local owner provisioning, exact-content save/read/export, image/container recreation, restart and PostgreSQL snapshot rollback verified on synthetic data. No old mock-data migration was required. See rehearsal limits below. |
| P03.09 | Removed legacy db/vault/store/memory/vector runtime modules; package.json, config.ts | No runtime SQLite/Turso/Qdrant branch or dual write remains. Removed @libsql/client. better-sqlite3 remains only in the optional local legacy inventory/import reader. Existing mock vault/data and backups were not deleted. |

There are now 39 typed application tables plus Graphile's own schema. Existing migration files 0000/0001 were preserved. New migrations add note routes, reading sessions/items, persistent login throttling and structural/current-version guards.

Note body/version/source records live in PostgreSQL. Original uploaded bytes live in DATA_DIR, mounted on the attachments volume. Markdown ZIPs are derived exports. Secrets remain server environment values; preference APIs neither return nor accept an OpenRouter key.

Undo creates a new version instead of rewriting history. A changed note rejects an obsolete undo request. Merge requires explicit target versions and owner-approved content; it preserves source links and archives source notes. Default retrieval excludes archived/trash content. Deliberate detail/history/lifecycle interfaces can read inactive content.

## P04 task record

| Task | Files | Result and acceptance evidence |
| --- | --- | --- |
| P04.01 | src/lib/auth/server.ts, config.ts; auth schema/guards | Better Auth 1.7.5 with Drizzle/PostgreSQL sessions. Public signup disabled; session creation verifies the installed owner. Database constraints and serialized provisioning enforce one owner. |
| P04.02 | src/lib/auth/owner.ts; scripts/owner.ts | Local create/recover commands with hidden interactive password prompts or protected JSON stdin. Concurrent setup permits one owner. Recovery changes that owner's credential and revokes all sessions without email delivery. No HTTP recovery/setup endpoint exists. |
| P04.03 | src/lib/http.ts; storage/access.ts; auth/page.ts; all personal route handlers and private server pages | Every personal API, stream, attachment/export download and server-rendered private page checks the owner. Domain services require owner or explicit local maintenance scope. No environment/header auth bypass. Proxy redirects are not the access authority. |
| P04.04 | auth/config.ts, server.ts, owner.ts; api/auth/[...all]/route.ts | HttpOnly SameSite=Lax sessions, Secure on HTTPS, seven-day expiry, database revocation, exact-origin unsafe requests and database-backed 10-attempt/minute login limit. Public configuration requires HTTPS; local HTTP remains supported. Forwarded client-IP headers cannot bypass the global limiter. |
| P04.05 | src/app/sign-in/; src/components/layout/session-controls.tsx; src/lib/client-api.ts; src/proxy.ts | Sign-in/out, validated return destination, expired-session overlay and reauthentication without discarding an open draft. Anonymous access, expiry, recovery, sign-out, CSRF, downloads and second-owner rejection verified through actual HTTP requests. |

The password CLI is an administrator capability that requires deployment/database access. It must not be exposed as a web endpoint. Changing the owner password revokes existing sessions. Reuse a strong stable BETTER_AUTH_SECRET across web restarts; keep it outside images/source control.

## Validation performed

Validation was limited to affected correctness, privacy and deployment behavior.

| Check | Outcome |
| --- | --- |
| npm test | 4 passed: configuration/access guards and explicit unavailable-provider behavior |
| npm run test:db | 25 passed: 12 storage foundation checks plus 13 canonical-service/auth scenarios |
| Focused canonical suite after final correctness changes | 13 passed, including completed-history context, duplicate completion, failed-turn save rejection, punctuation-safe technical search and undo after folder rename |
| npm run test:http | 9 passed against a real built Next server and temporary PostgreSQL database |
| npm run typecheck | Passed |
| npm run lint | Passed, no errors or warnings |
| npm run build and Docker production build | Passed; frontend/API and maintenance images built successfully |
| npm audit --omit=dev | Zero reported production vulnerabilities at validation time |
| Disposable Compose rehearsal | Passed fresh startup, maintenance provisioning, sign-in, save, exact ZIP export, recreation/restart and snapshot rollback |

The HTTP suite checks private API/page boundaries, public signup/recovery rejection, unsafe origins, real cookies, capture/edit conflicts, path redirects, search/export, settings/dashboard/study/chat, attachment/import access, restart persistence, session expiry/recovery/sign-out and the shared login limiter. HTTPS cookie attributes are checked using the real auth handler configured for an HTTPS origin; an external TLS reverse proxy was not deployed.

The Docker rehearsal used a separate myai-p04-check project on localhost:3301 with synthetic credentials and a single synthetic note. It saved an exact Markdown body, rebuilt/recreated the web container, compared downloaded ZIP bytes, took a PostgreSQL custom-format snapshot, changed the note, stopped the web service, restored the snapshot and verified the original body/version/source links/session. Restart again retained the restored data. This exercises database rollback with the matching application, not arbitrary old-image/schema downgrades or the future complete attachment/graph backup workflow.

## Deliberate boundaries and next session

- **Next: P05.01.** Implement the typed OpenRouter client, capability/model validation and durable background task runner. Chat currently uses the compatible OpenRouter adapter. Model/secret settings cannot authorize arbitrary provider URLs.
- Index jobs and freshness guards exist; actual chunk/embedding/graph handlers are not running. Reindex requests report unavailable rather than fake success. Search is current keyword search.
- OpenRouter was not called with a live key. No generation, embeddings, rerank or graph factual-accuracy result is claimed.
- Full explorer/chat layout, improvement prompt/diff, mode chooser, history/undo UI and typed AI tools remain P06/P07. Basic capture must not be mistaken for that complete experience.
- Study persistence and trusted grading are complete for the existing flows; question quality, grounded feedback, recall scheduling and graph-supported learning remain P10.
- Export covers active Markdown notes only and explicitly rejects more than 10,000 notes or 50 MB. General import currently accepts Markdown/ZIP with size/count/path validation. Full backup, rich formats and automated restore remain P11.
- A failed or interrupted chat turn is retained as failed/cancelled (a process crash may leave it running); it does not create a generated note. Durable resumable-turn recovery remains P05/P07.
- Public HTTPS proxy rehearsal, broader release hardening, accessibility/browser workspace acceptance and final license selection remain later tasks. No visual browser acceptance or zero-hallucination claim was made.
- Before real-data upgrades, back up PostgreSQL and attachment bytes together, preserve the matching application image and validate restore. Do not run a legacy SQLite image as though it can read new PostgreSQL writes.
