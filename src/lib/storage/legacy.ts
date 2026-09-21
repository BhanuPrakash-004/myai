import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { transaction } from "./client";
import { KnowledgeService, hash } from "./knowledge";
import { requireAccess } from "./access";


export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export interface LegacyItem {
  key: string;
  kind: "sqlite" | "markdown";
  path: string;
  title: string;
  body: string;
  hash: string;
  createdAt: string | null;
}
export interface LegacyInventory {
  formatVersion: 1;
  items: LegacyItem[];
  counts: Record<string, number>;
  conflicts: { path: string; keys: string[] }[];
  warnings: string[];
  // Metadata only: no account keys, settings values or chat contents are read.
  excluded: string[];
}

function safeNotePath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "." || !part) || normalized.includes("\0")) {
    throw new Error("Unsafe legacy note path");
  }
  return normalized;
}

export async function inventoryLegacy(options: { sqlitePath?: string; vaultPath?: string }): Promise<LegacyInventory> {
  const report: LegacyInventory = {
    formatVersion: 1, items: [], counts: {}, conflicts: [], warnings: [],
    excluded: ["settings values and credentials", "remote Turso (export locally first)", "untrusted historical quiz totals"],
  };
  const markdown = new Map<string, string>();
  if (options.vaultPath) {
    const root = path.resolve(options.vaultPath);
    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) { report.warnings.push("Skipped symbolic link: " + path.relative(root, full)); continue; }
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          if ((await stat(full)).size > 20 * 1024 * 1024) { report.warnings.push("Skipped oversized note: " + entry.name); continue; }
          const relative = safeNotePath(path.relative(root, full));
          const body = await readFile(full, "utf8");
          markdown.set(relative.toLowerCase(), body);
          report.items.push({ key: "markdown:" + relative, kind: "markdown", path: relative,
            title: body.match(/^#\s+(.+)$/m)?.[1] || path.basename(relative, ".md"), body, hash: sha256(body), createdAt: null });
        }
      }
    }
    await walk(root);
  }
  if (options.sqlitePath) {
    const db = new Database(path.resolve(options.sqlitePath), { readonly: true, fileMustExist: true });
    try {
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
      for (const table of ["memories", "memory_versions", "chat_sessions", "chat_messages", "review_sessions", "quiz_sessions", "leetcode_problems", "app_settings"]) {
        if (tables.has(table)) report.counts[table] = (db.prepare("SELECT COUNT(*) AS count FROM " + table).get() as { count: number }).count;
      }
      if (tables.has("memories")) {
        const columns = new Set((db.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).map((row) => row.name));
        const hasContent = columns.has("content");
        const rows = db.prepare("SELECT id, title, file_path, created_at" + (hasContent ? ", content" : "") + " FROM memories ORDER BY id").all() as {
          id: string; title: string; file_path: string; content?: string | null; created_at: string;
        }[];
        for (const row of rows) {
          let notePath: string;
          try { notePath = safeNotePath(row.file_path); } catch { report.warnings.push("Skipped unsafe SQLite path for " + row.id); continue; }
          const body = row.content ?? markdown.get(notePath.toLowerCase());
          if (body === undefined) { report.warnings.push("Missing full content for " + notePath + "; preview was not imported"); continue; }
          const createdAt = Number.isFinite(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString() : null;
          report.items.push({ key: "sqlite:" + row.id, kind: "sqlite", path: notePath, title: row.title, body, hash: sha256(body), createdAt });
        }
      }
    } finally { db.close(); }
  }
  const paths = new Map<string, LegacyItem[]>();
  for (const item of report.items) {
    const key = item.path.toLowerCase();
    paths.set(key, [...(paths.get(key) || []), item]);
  }
  for (const [notePath, entries] of paths) {
    if (new Set(entries.map((entry) => entry.hash)).size > 1) report.conflicts.push({ path: notePath, keys: entries.map((entry) => entry.key) });
  }
  report.counts.markdownFiles = report.items.filter((item) => item.kind === "markdown").length;
  report.counts.importableCopies = report.items.length;
  return report;
}

export async function importLegacy(pool: Pool, report: LegacyInventory, namespace: string) {
  requireAccess();
  if (!namespace.trim() || namespace.length > 100) throw new Error("A short import namespace is required");
  const service = new KnowledgeService(pool);
  let imported=0, skipped=0;
  for (const item of report.items) {
    safeNotePath(item.path);
    if (sha256(item.body)!==item.hash) throw new Error("Inventory body hash mismatch");
    const sourceKey=namespace+":"+item.key+":"+item.hash;
    const added=await transaction(pool,async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[sourceKey]);
      if((await client.query("SELECT 1 FROM import_items WHERE source_key=$1",[sourceKey])).rowCount)return false;
      const folderId=await service.ensureFolderPath(["Imported",namespace,item.kind,...item.path.split("/").slice(0,-1)].join("/"),client);
      const receipt=await service.executeInTransaction(client,{action:"create",idempotencyKey:"legacy:"+hash(sourceKey),folderId,title:item.title.slice(0,200)||"Imported note",body:item.body,provenance:"migrated_unknown",createdAt:item.createdAt??undefined,
        sources:[{body:item.body,origin:"migrated_unknown",metadata:{legacyPath:item.path,originalCreatedAt:item.createdAt,sourceKind:item.kind}}]});
      const sourceId=(await client.query("SELECT source_id FROM note_sources WHERE note_id=$1 AND version=1",[receipt.noteId])).rows[0].source_id;
      await client.query("INSERT INTO import_items(source_key,source_hash,source_id,note_id,legacy_path) VALUES($1,$2,$3,$4,$5)",[sourceKey,item.hash,sourceId,receipt.noteId,item.path]);
      return true;
    });
    if(added)imported++;else skipped++;
  }
  return {imported,skipped,conflictsPreserved:report.conflicts.length};
}
