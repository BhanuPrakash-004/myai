#!/usr/bin/env bash
set -euo pipefail
umask 077
action=${1:-}
name=${2:-}
if [[ ! "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$ ]]; then echo 'Use a backup name containing only letters, digits, underscores and hyphens.' >&2; exit 1; fi
bundle="/backups/$name"
sql() { psql -X -v ON_ERROR_STOP=1 -Atc "$1"; }
quiet_database() {
  # The orchestration command stops app/worker first. Refuse all remaining client connections.
  if [[ $(sql "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'") != 0 ]]; then
    echo 'Database still has clients. Stop all writers and maintenance commands before recovery.' >&2; exit 1
  fi
}
validate_objects() {
  local dir=$1
  [[ -d "$dir" && ! -L "$dir" ]] || { echo 'Missing regular objects directory.' >&2; exit 1; }
  while IFS= read -r -d '' item; do
    [[ -f "$item" && ! -L "$item" && "${item##*/}" =~ ^[a-f0-9-]{36}$ ]] || { echo 'Invalid attachment object.' >&2; exit 1; }
  done < <(find "$dir" -mindepth 1 -print0)
}
case "$action" in
  backup)
    quiet_database
    [[ ! -e "$bundle" && ! -e "$bundle.partial" ]] || { echo 'Backup destination already exists. Use a new name.' >&2; exit 1; }
    [[ $(sql "SELECT count(*) FROM attachments WHERE state NOT IN ('ready','purged')") == 0 ]] || { echo 'Reconcile pending attachments before backing up.' >&2; exit 1; }
    mkdir -p "$bundle.partial/objects"
    # PostgreSQL custom-format dump contains every application and worker table, versions and owner credentials.
    pg_dump --format=custom --no-owner --no-acl --file="$bundle.partial/database.dump"
    sql "SELECT storage_key||'|'||sha256||'|'||byte_size FROM attachments WHERE state='ready' ORDER BY storage_key" > "$bundle.partial/attachments.index"
    while IFS='|' read -r object digest bytes; do
      [[ "$object" =~ ^[a-f0-9-]{36}$ && "$digest" =~ ^[a-f0-9]{64}$ && "$bytes" =~ ^[0-9]+$ ]] || exit 1
      src="/attachments/objects/$object"
      [[ -f "$src" && ! -L "$src" ]] || { echo 'Missing attachment object.' >&2; exit 1; }
      [[ $(sha256sum "$src" | cut -d' ' -f1) == "$digest" && $(stat -c%s "$src") == "$bytes" ]] || { echo 'Attachment checksum failed.' >&2; exit 1; }
      cp -- "$src" "$bundle.partial/objects/$object"
    done < "$bundle.partial/attachments.index"
    sql "SELECT name||'|'||sha256 FROM myai_migrations ORDER BY name" > "$bundle.partial/migrations.index"
    printf 'myai-full-backup-v1\nPostgreSQL 17\n' > "$bundle.partial/format"
    (cd "$bundle.partial"; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
    mv -- "$bundle.partial" "$bundle"
    echo "Backup complete: $name. Store deployment secrets separately."
    ;;
  verify|restore)
    [[ -d "$bundle" && ! -L "$bundle" && $(head -n1 "$bundle/format") == myai-full-backup-v1 ]] || { echo 'Not a complete MyAI backup.' >&2; exit 1; }
    # All input paths are constrained; checksums detect corruption, not a malicious backup author.
    validate_objects "$bundle/objects"
    for item in database.dump attachments.index migrations.index format SHA256SUMS; do [[ -f "$bundle/$item" && ! -L "$bundle/$item" ]] || exit 1; done
    if grep -Ev '^[a-f0-9]{64}  \./(database\.dump|attachments\.index|migrations\.index|format|objects/[a-f0-9-]{36})$' "$bundle/SHA256SUMS" >/dev/null; then echo 'Invalid checksum paths.' >&2; exit 1; fi
    (cd "$bundle"; sha256sum --quiet --strict -c SHA256SUMS)
    for item in database.dump attachments.index migrations.index format; do grep -q "  \./$item$" "$bundle/SHA256SUMS" || exit 1; done
    pg_restore --list "$bundle/database.dump" >/dev/null
    while IFS='|' read -r object digest bytes; do
      [[ "$object" =~ ^[a-f0-9-]{36}$ && "$digest" =~ ^[a-f0-9]{64}$ && "$bytes" =~ ^[0-9]+$ ]] || exit 1
      [[ $(sha256sum "$bundle/objects/$object" | cut -d' ' -f1) == "$digest" && $(stat -c%s "$bundle/objects/$object") == "$bytes" ]] || exit 1
    done < "$bundle/attachments.index"
    if [[ "$action" == verify ]]; then echo 'Backup checksums and PostgreSQL archive verified.'; exit 0; fi
    quiet_database
    [[ $(sql "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')") == 0 ]] || { echo 'Restore requires an EMPTY database. Existing data is never overwritten.' >&2; exit 1; }
    [[ ! -e /attachments/objects || -z $(find /attachments/objects -mindepth 1 -print -quit) ]] || { echo 'Restore requires an empty attachment volume.' >&2; exit 1; }
    [[ ! -e /attachments/staging || -z $(find /attachments/staging -mindepth 1 -print -quit) ]] || { echo 'Restore requires an empty staging directory.' >&2; exit 1; }
    mkdir -p /attachments/objects /attachments/staging
    cp -- "$bundle"/objects/* /attachments/objects/ 2>/dev/null || [[ -z $(find "$bundle/objects" -mindepth 1 -print -quit) ]]
    chown -R 1000:1000 /attachments/objects /attachments/staging
    pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$PGDATABASE" "$bundle/database.dump"
    # A stopped worker may have held job leases in the snapshot. Make queued work claimable again.
    sql "SELECT graphile_worker.force_unlock_workers(ARRAY(SELECT DISTINCT locked_by FROM graphile_worker._private_jobs WHERE locked_by IS NOT NULL))" >/dev/null
    sql "SELECT storage_key||'|'||sha256||'|'||byte_size FROM attachments WHERE state='ready' ORDER BY storage_key" > /tmp/restored-attachments.index
    cmp "$bundle/attachments.index" /tmp/restored-attachments.index
    echo 'Restore completed. Validate with scripts/recovery-validate.ts before starting the web and worker.'
    ;;
  *) echo 'Usage: recovery.sh backup|verify|restore BACKUP_NAME' >&2; exit 1;;
esac
