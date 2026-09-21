import type { Pool } from "pg";
import { z } from "zod";
import { requireAccess, DomainError } from "../storage/access";
import { transaction } from "../storage/client";
import { enqueueNoteIndexing } from "../storage/jobs";
import { stages, productionRegistry } from "./runtime";

export async function processingStatus(pool: Pool) {
  requireAccess();
  const [counts, errors, workers] = await Promise.all([
    pool.query("SELECT stage,status,error_code,count(*)::int AS count FROM processing_state s JOIN notes n ON n.id=s.note_id AND n.current_version=s.note_version WHERE n.lifecycle='active' GROUP BY stage,status,error_code ORDER BY stage,status"),
    pool.query("SELECT s.note_id,s.note_version,s.stage,s.status,s.error_code,s.attempts,s.heartbeat_at,n.title FROM processing_state s JOIN notes n ON n.id=s.note_id AND n.current_version=s.note_version WHERE n.lifecycle='active' AND s.error_code IS NOT NULL ORDER BY s.updated_at DESC LIMIT 20"),
    pool.query("SELECT id,status,handlers,heartbeat_at,heartbeat_at>now()-interval '45 seconds' AND status='running' AS alive FROM worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 5"),
  ]);
  return { backend: "pgvector", workerImplemented: true, availableHandlers: Object.keys(productionRegistry), stages: counts.rows, errors: errors.rows, workers: workers.rows };
}
export async function requeue(pool: Pool, raw: unknown) {
  requireAccess();
  const input = z.object({ action: z.enum(["retry", "rebuild"]), noteId: z.uuid().optional() }).strict().parse(raw);
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(71205002)");
    const notes = (await client.query("SELECT id,current_version FROM notes WHERE lifecycle='active' AND ($1::uuid IS NULL OR id=$1) ORDER BY id LIMIT 1001", [input.noteId])).rows;
    if (notes.length > 1000) throw new DomainError("REBUILD_LIMIT", "Rebuild this library by selecting individual notes; one request supports up to 1,000 notes.", 413);
    let queued = 0;
    for (const note of notes) {
      const result = await client.query("UPDATE processing_state SET status='pending',attempts=0,run_token=NULL,error_code='MANUAL_RETRY',updated_at=now() WHERE note_id=$1 AND note_version=$2 AND ($3 OR status IN ('pending','failed','stale'))", [note.id, note.current_version, input.action === "rebuild"]);
      if (result.rowCount) { await enqueueNoteIndexing(client, note.id, note.current_version); queued++; }
    }
    return { queued, availableHandlers: Object.keys(productionRegistry), message: "Queued current versions. Text chunks run locally; embeddings and graph extraction require AI indexing and compatible configured models." };
  });
}
export async function recoverInterrupted(pool: Pool) {
  requireAccess();
  return transaction(pool, async (client) => {
    const candidates = (await client.query("SELECT s.* FROM processing_state s JOIN notes n ON n.id=s.note_id AND n.current_version=s.note_version WHERE n.lifecycle='active' AND ((s.status='processing' AND s.heartbeat_at<now()-interval '90 seconds') OR (s.status='pending' AND s.error_code='WORKER_INTERRUPTED' AND s.updated_at<now()-interval '30 seconds')) ORDER BY s.updated_at LIMIT 100")).rows;
    let recovered = 0;
    for (const row of candidates) {
      if (!stages.includes(row.stage)) continue;
      const lock = "myai-stage:" + row.note_id + ":" + row.note_version + ":" + row.stage;
      if (!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked", [lock])).rows[0].locked) continue;
      const changed = await client.query("UPDATE processing_state SET status=$4::processing_status,error_code=$5,run_token=NULL,updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND (run_token IS NOT DISTINCT FROM $6::uuid) AND status IN ('processing','pending')",
        [row.note_id, row.note_version, row.stage, row.attempts >= 8 ? "failed" : "pending", row.attempts >= 8 ? "RETRY_LIMIT" : "RECOVERED", row.run_token]);
      if (!changed.rowCount || row.attempts >= 8) continue;
      // A new key bypasses Graphile's abandoned job lock; the stage lock and token fence duplicate delivery.
      await client.query("SELECT graphile_worker.add_job(identifier := 'knowledge:index',payload := $1::json,job_key := $2,max_attempts := 8)",
        [JSON.stringify({ noteId: row.note_id, noteVersion: row.note_version, pipelineVersion: "v1" }), "recover:" + row.note_id + ":" + row.note_version + ":" + row.stage + ":" + row.attempts]);
      recovered++;
    }
    return recovered;
  });
}
