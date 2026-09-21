import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { AttachmentService } from "./attachments";
import { requireAccess } from "./access";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function validateRecovery(pool: Pool, directory: string) {
  requireAccess();
  const problems: string[] = [];
  const migrations = (await pool.query("SELECT name,sha256 FROM myai_migrations ORDER BY name")).rows;
  const local = (await readdir("migrations")).filter(n => /^\d{4}_[\w-]+\.sql$/.test(n)).sort();
  if (local.length !== migrations.length) problems.push("Migration count differs from this application version.");
  for (const m of migrations) {
    if (!local.includes(m.name)) { problems.push("Unknown applied migration."); continue; }
    const body = await readFile(path.join("migrations", m.name), "utf8");
    if (createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex") !== m.sha256) problems.push("Migration checksum differs: " + m.name);
  }
  const checks = [
    ["notes", "SELECT count(*) FROM notes n LEFT JOIN note_versions v ON v.note_id=n.id AND v.version=n.current_version WHERE v.note_id IS NULL OR n.body<>v.body OR n.title<>v.title"],
    ["sources", "SELECT count(*) FROM note_sources ns LEFT JOIN sources s ON s.id=ns.source_id WHERE s.id IS NULL"],
    ["schedules", "SELECT count(*) FROM review_schedule WHERE interval_days<0 OR algorithm_version NOT IN ('myai-calendar-v1')"],
    ["scores", "SELECT count(*) FROM quiz_session_scores WHERE score>total_questions"],
    ["graph", "SELECT count(*) FROM graph_edges e LEFT JOIN graph_nodes a ON a.id=e.from_node_id LEFT JOIN graph_nodes b ON b.id=e.to_node_id WHERE a.id IS NULL OR b.id IS NULL"],
    ["owner", "SELECT CASE WHEN (SELECT count(*) FROM auth_users)=1 AND EXISTS(SELECT 1 FROM installation i JOIN auth_users u ON u.id=i.owner_id JOIN auth_accounts a ON a.user_id=u.id WHERE a.provider_id='credential' AND a.password IS NOT NULL) THEN 0 ELSE 1 END AS count"],
  ];
  for (const [name, sql] of checks) if (Number((await pool.query(sql)).rows[0].count)) problems.push("Invalid " + name + " records.");
  const files = new AttachmentService(pool, directory), attachments = (await pool.query("SELECT id,state,sha256,byte_size FROM attachments")).rows;
  for (const a of attachments) {
    if (a.state === "purged") continue;
    if (a.state !== "ready") { problems.push("Unfinished attachment: " + a.id); continue; }
    try { const { bytes } = await files.download(a.id); if (bytes.length !== a.byte_size || createHash("sha256").update(bytes).digest("hex") !== a.sha256) problems.push("Attachment checksum failed: " + a.id); }
    catch { problems.push("Attachment missing: " + a.id); }
  }
  const counts: Record<string, number> = {};
  for (const table of ["notes", "note_versions", "sources", "graph_edges", "conversations", "messages", "study_cards", "quiz_attempts_v2", "review_schedule", "review_events", "attachments", "auth_users"]) counts[table] = Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  if (problems.length) throw new Error("Recovery validation failed: " + problems.join(" "));
  return { valid: true, counts, migrations: migrations.length, attachmentsVerified: attachments.filter(a => a.state === "ready").length, reminder: "Use the original deployment secrets and verify owner sign-in before exposing this installation." };
}

