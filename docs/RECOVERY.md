# Full backup and recovery

A Markdown export is a portable reading/import artifact, **not a full backup**. The full recovery bundle contains a PostgreSQL 17 custom-format dump, all ready original attachment objects, migration inventory and SHA-256 checksums. It includes canonical notes and every version, sources, curated graph and projections, conversations, owner password hashes, settings, sessions, imports, attempts, schedules, recall events and queued jobs.

Keep bundles private. They are not encrypted by this application. Store them on an encrypted disk or encrypt them with your preferred backup tool before off-site transfer. Keep an independent copy of deployment secrets and the matching source revision/container images. Checksums detect corruption; restore only your own trusted bundles. Database archives can contain executable SQL.

## Create and verify a backup

Use the same Compose project name/environment as the running installation. Commands below run from the repository root, using `.env` for Compose. `BACKUP_DIR` defaults to `./backups` and may point at another existing protected directory.

```sh
npm run recovery -- backup before-upgrade-20260921
npm run recovery -- verify before-upgrade-20260921
docker compose up -d myai worker
```

The host command uses Docker without a shell, stops web and worker, starts/waits for the database, then runs the recovery container from `compose.recovery.yml`. It refuses remaining database clients. Stop other maintenance tools before running it. Backup refuses unfinished/failed attachments: first run `docker compose run --rm migrate node --import tsx scripts/attachments.ts` and resolve any missing/corrupt originals. Permanently purged upload tombstones are deliberately excluded from attachment bytes.

The backup starts as `BACKUP_NAME.partial` and becomes `BACKUP_NAME` only after dump, copying and checksums finish. Failed/partial backups cannot be restored as complete bundles. Keep services stopped while investigating a failure. Use a new backup name when retrying; never overwrite an existing bundle. Verification checks the archive, all checksums and every attachment's database-recorded hash/size. For large installations allow disk space for the dump plus an additional complete attachment copy.

The default bundle is owned by the recovery container's root user with private permissions. On Linux use administrator privileges to copy/archive it or explicitly transfer ownership to your backup operator after completion; do not make it world-readable.

## Restore into a fresh installation

Use the matching application revision first. Create a new Compose project/directory with a fresh PostgreSQL and attachments volume. Do **not** start `migrate`, web or worker yet. Set `.env` (`POSTGRES_PASSWORD`, `APP_URL`, `BETTER_AUTH_SECRET`, model settings/API key) and make the complete bundle available under `BACKUP_DIR`. Preserve the original independent secret if any stored encrypted credentials depend on it. This release uses environment-managed OpenRouter credentials, so the dump does not contain that API key. Changing the auth secret invalidates old sessions; owner password credentials remain in the database.

```sh
# Set COMPOSE_PROJECT_NAME to the new installation name in this environment.
npm run recovery -- restore before-upgrade-20260921
docker compose run --rm --no-deps migrate node --import tsx scripts/recovery-validate.ts
docker compose up -d --build
```

Restore refuses an existing application database or nonempty attachment/staging directories. It verifies the bundle before restoring, copies attachment objects with the application's UID/GID, restores SQL in a single transaction and clears old Graphile worker leases. The validation command checks migration hashes against this checkout, current note/version consistency, source/graph references, bounded scores, schedules, owner credentials and attachment checksums. It prints counts without private content. If restore fails, keep the instance offline; discard/recreate **only the newly allocated empty restore volumes**, then retry after resolving the error. Never remove the source installation's volumes.

Sign in, open a note and its history/source, inspect graph evidence, resume a practice session and download an attachment before exposing the restored instance. Recovery validation does not replace this owner acceptance step. Upgrades should happen only after a matching-version restore works. Do not run old application code against a newer database or edit applied migration files to force rollback; restore the previous verified bundle into fresh volumes.

The same recovery shell can run with PostgreSQL 17 client tools outside Compose, but the shipped automated workflow and rehearsal use Compose. Keep the PostgreSQL major version and pgvector version compatible with the source installation.

## Trash retention and permanent deletion

Trash is reversible and retains versions, sources and learning history. Archived/trashed content is excluded from current retrieval and its cards become stale. There is no automatic timed deletion.

After at least 30 days in trash, a local operator can remove a specific note permanently:

```sh
docker compose stop myai worker
docker compose run --rm --no-deps migrate node --import tsx scripts/purge.ts NOTE_UUID EXPECTED_VERSION --permanently-delete
docker compose up -d myai worker
```

This checks the exact ID/version and retention window, deletes versions, chunks, embeddings, associated graph evidence, cards and recall events, removes affected quiz sessions and cited/generated messages, and redacts related operation payloads. It preserves other notes and shared source records. A shared original ZIP can contain the deleted note, so its attachment bytes are removed for **all** imports from that upload; the surviving notes retain their full extracted text and source metadata. Attachment tombstones prevent an old idempotency key from resurrecting the upload. The orphan reconciliation step removes physical objects; if the process stops after the database commit, rerun `scripts/attachments.ts` to finish removal.

Copied text in unrelated notes/conversations and older external backups is not automatically discoverable or erased. Handle those copies and your backup retention separately. A new backup after purge excludes purged attachment bytes.

## Rehearsal evidence

`tests/integration/study-portability.test.ts` uses a separate `myai_test_*` database, synthetic source/model content and the production recovery shell inside the isolated PostgreSQL container. It backs up and restores into another fresh database, compares canonical/source/graph/chat/learning counts, validates attachment bytes and migrations, verifies the recovered owner's password, and proves restore refuses a populated database. No owner database or live OpenRouter key is used.
