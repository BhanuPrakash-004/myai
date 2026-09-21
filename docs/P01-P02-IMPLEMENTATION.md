# P01/P02 implementation record

Date: 2026-09-18. Product authority: [general.txt](../general.txt). Completion ledger: [TODO.md](../TODO.md).

## Scope and boundary

P01 repairs the existing runtime. P02 adds a tested PostgreSQL foundation. P03 will route all application reads/writes through it. Installing auth tables does not implement login; installing Graphile's schema does not implement extraction workers. The VS Code-style document/tool workspace and grounded graph/RAG experience remain P06–P09.

The owner confirmed that current project/vault data is mock data. Fresh initialization is the default. Legacy import is opt-in and limited to full notes/sources; it does not migrate credentials or manufacture historical learning events.

## P01 changes

- Both memory-engine entry points stop at IGNORE/read-only decisions. CREATE cannot overwrite an existing path through either the engine or store.
- Quiz grading looks up the stored question in its session, hides answer keys before submission, records one attempt per question and derives the score from attempts. Browser failures no longer trigger fabricated local grading.
- SQLite errors stop with actionable diagnostics instead of silently switching to an in-memory database. Old schemas gain status before the status index.
- Direct note pages and ZIP export read full canonical database content with the Markdown mirror disabled. Exports include a manifest; missing bodies and size limits fail explicitly instead of producing a misleading partial archive.
- Six undefined vector-queue references and all baseline lint/type errors were repaired. Async loading effects were adjusted with cancellation where appropriate.
- Removed the canned offline AI provider, invented fallback note sections, fabricated fallback/starter quizzes, obsolete seed script and unused Next starter SVGs. Failed AI calls remain visible; fallback note formatting preserves only supplied facts.
- Upgraded adm-zip to 0.6.1 and scoped the old migration loader's esbuild dependency to patched 0.25.12. No blanket lint or type suppressions were added.

## P02 files

| Path | Responsibility |
| --- | --- |
| src/lib/storage/schema.ts | 35 typed application tables; folders, notes, versions, sources, operations, auth, chat, graph, embeddings, study and processing |
| migrations/0000_foundation.sql | Reviewed initial DDL; vector/pgcrypto extensions |
| migrations/0001_integrity_and_freshness.sql | Hierarchy, version, quote and profile invariants; current-only retrieval views |
| src/lib/storage/config.ts | Validated configuration and redacted validation errors; fixed 1536-dimensional profile |
| src/lib/storage/client.ts | PostgreSQL/Drizzle connection and transaction lifecycle |
| src/lib/storage/migrate.ts | Serialized, transactional, checksummed migrations; explicit Graphile schema migration |
| src/lib/storage/jobs.ts | Atomic indexing enqueue and a current-version lock for future publishing workers |
| src/lib/storage/legacy.ts | Read-only optional inventory and checkpointed full-note import |
| scripts/db/ | Explicit migration/status/inventory/import commands |
| tests/legacy-regressions.test.ts | Real engine/quiz/HTTP regressions with temporary SQLite and stub/unavailable AI |
| tests/storage-config.test.ts | Configuration, failed-storage and old-schema checks |
| tests/integration/storage.test.ts | Real PostgreSQL transactions, migration upgrades and data invariants |
| Dockerfile | Standalone frontend/API runtime and separate maintenance image |
| compose.db.yml / compose.test.yml | Persistent development DB / isolated ephemeral test DB |
| docker-compose.yml | Private frontend/API + PostgreSQL + serialized migration service |

Pinned packages: Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, pg 8.23.0, Zod 4.6.5, Better Auth 1.7.5, Graphile Worker 0.17.3 and tsx 4.23.13. Graphile 0.17.3 supports the installed Node 22.14 development runtime; 0.18.0 requires a newer Node minimum. PostgreSQL uses pgvector 0.8.2 with PG17. The full deployment pins Node and PostgreSQL image digests.

## Accuracy and freshness contracts

1. A current note cannot commit without a matching immutable version/body/title/provenance snapshot.
2. Content changes require the next version. The P03 service must use expectedVersion in its update predicate; the integration test demonstrates one success and one conflict under competing edits.
3. Chunks reference an existing immutable note version and must equal their recorded substring. Offsets use Unicode code points.
4. Embeddings reference immutable model/chunker profiles; only one profile is active and dimensions are fixed to 1536. Profiles cannot be repurposed in place.
5. Graph evidence must quote its actual chunk. Any linked original source must belong to the same note version.
6. current_chunks, current_embeddings and current_graph_edges exclude obsolete/trashed evidence. Curated relationships remain stored as history when their old supporting evidence becomes stale.
7. Note changes mark older processing state and study cards stale. Future workers acquire lockCurrentNote inside the publishing transaction.
8. A note/version/source/operation and indexing job can commit or roll back together. Replaying an enqueue uses the same job key.
9. The single owner slot and question/session membership are enforced in PostgreSQL, including callers bypassing the UI.

These contracts establish consistency and evidence identity. They do not establish the factual correctness of source text, relationship extraction or generated answers. Retrieval still needs scope filters, measured keyword/vector/rerank behavior, source support evaluation and abstention in P08/P09.

“Current” means the latest active saved note version. Latest real-world information needs dated authoritative sources and explicit refresh, not merely a fresh embedding.

## Validation evidence

- Before fixes: seven of the eight initial production-service regressions failed, reproducing duplicate overwrite, client-controlled grading, wrong membership and repeated-score bugs.
- After fixes: npm test — 15 tests passed.
- npm run test:db — 12 tests passed against real PostgreSQL/pgvector, including fresh and incremental migrations, reruns, checksum drift, rollback/enqueue, owner/folder constraints, competing edits, stale evidence and optional import.
- npm run typecheck — passed, including the new database CLI sources.
- npm run lint — passed without rule suppressions.
- npm run build — Next production build passed locally.
- npm run eval — 104 legacy cases passed; this script mainly copies decision rules.
- npm run eval:retrieval — 34 offline checks passed; not a live provider/RAG evaluation.
- Drizzle generation after schema review — no schema changes detected.
- npm install/audit after the patched dependency override — zero reported vulnerabilities at verification time.
- Optional inventory — five existing mock Markdown notes, no conflicts, no automatic import.
- Docker: both the standalone frontend/API image and maintenance image built successfully. The isolated myai-p02-check stack starts with PostgreSQL health -> successful migrations -> healthy web.
- HTTP checks on localhost:3300: health, chat, knowledge and quiz pages plus knowledge/quiz APIs returned 200. A created note survived web restart and container recreation, opened through its direct page with the file mirror disabled, and exported as exact Markdown with a manifest. Missing AI produced no substitute quiz questions.
- Container checks: non-root web process; .env and .env.local absent from the image. The stack binds only to localhost and uses isolated named volumes; no existing project vault was mounted or imported.

The Windows Graphile utility emits an executable-file-detection warning while migrating its schema. No executable task loader is used by these tests. Worker execution will be tested in Linux containers when P05 handlers are implemented.

## Operational notes for the next session

Read README.md for commands. The full stack binds its web port to localhost until P04 auth. The maintenance container runs migrations explicitly before the web container. The public schema is not reset on startup. Restarting containers retains named volumes.

For database development, use compose.db.yml and .env DATABASE_URL on port 55432. Integration tests use compose.test.yml on 55433 and create/drop only their own myai_test_* databases. Test credentials are synthetic.

The optional importer deliberately retains conflicting copies in separate origin folders. Do not automatically run it for the owner's initial mock vault. In PowerShell, the documented node --import tsx commands avoid npm.ps1 double-dash forwarding differences.

P03.01 is next: implement the single PostgreSQL domain service, adapt every API/page and eliminate competing runtime authorities. Preserve the existing regression tests and use the current-only views for retrieval. A second migration system or permanent dual-write adapter is not needed.
