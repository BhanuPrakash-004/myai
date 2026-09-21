import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { TaskList } from "graphile-worker";
import { z } from "zod";
import { indexJobSchema, lockCurrentNote } from "../storage/jobs";
import { asMaintenance, requireAccess } from "../storage/access";
import { readPreferences } from "../storage/settings";
import { resolveAIConfig, type AIConfig } from "../ai/preferences";
import { AIError } from "../ai/errors";
import { createProductionRegistry } from "./projections";

export const stages = ["chunks", "embeddings", "graph"] as const;
export type Stage = typeof stages[number];
export type IndexJob = z.infer<typeof indexJobSchema>;
export interface StageInput { noteId: string; noteVersion: number; title: string; body: string; folderId: string; contentHash: string }
export interface StageHandler {
  version: string;
  prepare(input: StageInput, context: { signal: AbortSignal; config: AIConfig }): Promise<unknown>;
  // Publish projections only. The runtime holds a current-version lock and commits readiness with these writes.
  publish(client: PoolClient, result: unknown, input: StageInput): Promise<void>;
}
export type Registry = Partial<Record<Stage, StageHandler>>;
export const productionRegistry: Registry = createProductionRegistry();
function inputKey(stage: Stage, handler: StageHandler, config: AIConfig) {
  return createHash("sha256").update(JSON.stringify([stage, handler.version,
    stage === "embeddings" ? [config.embeddingModel, config.embeddingDimensions] : stage === "graph" ? config.structuredModel : "text-v1"])).digest("hex");
}
export async function runStage(pool: Pool, registry: Registry, stage: Stage, raw: IndexJob, abort?: AbortSignal, timeoutMs = 120000) {
  requireAccess(); const job = indexJobSchema.parse(raw), client = await pool.connect();
  const lock = "myai-stage:" + job.noteId + ":" + job.noteVersion + ":" + stage, token = randomUUID();
  let locked = false, timer: ReturnType<typeof setInterval> | undefined, heartbeat: Promise<unknown> = Promise.resolve(), claimed = false;
  const localAbort = new AbortController(), signal = AbortSignal.any([localAbort.signal, AbortSignal.timeout(timeoutMs), ...(abort ? [abort] : [])]);
  const heartbeatStop = async () => { if (timer) clearInterval(timer); await heartbeat; };
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [lock])).rows[0].locked;
    if (!locked) return "busy";
    const note = (await client.query("SELECT * FROM notes WHERE id=$1 AND current_version=$2 AND lifecycle='active'", [job.noteId, job.noteVersion])).rows[0];
    if (!note) {
      await client.query("UPDATE processing_state SET status='stale',error_code='VERSION_CHANGED',run_token=NULL,updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3", [job.noteId, job.noteVersion, stage]);
      return "stale";
    }
    const config = resolveAIConfig(await readPreferences(client)), handler = registry[stage];
    if ((stage !== "chunks" && !config.aiIndexingEnabled) || !handler) {
      await client.query("UPDATE processing_state SET status='pending',error_code=$4,run_token=NULL,updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND status<>'ready'",
        [job.noteId, job.noteVersion, stage, !config.aiIndexingEnabled ? "AI_DISABLED" : "HANDLER_NOT_IMPLEMENTED"]);
      return "blocked";
    }
    const fingerprint = inputKey(stage, handler, config);
    const state = (await client.query("SELECT * FROM processing_state WHERE note_id=$1 AND note_version=$2 AND stage=$3", [job.noteId, job.noteVersion, stage])).rows[0];
    if (!state) throw new Error("MISSING_STAGE_STATE");
    if (state.status === "ready" && state.input_key === fingerprint) return "ready";
    if (state.attempts >= 8 && state.input_key === fingerprint) {
      await client.query("UPDATE processing_state SET status='failed',error_code='RETRY_LIMIT',updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3", [job.noteId, job.noteVersion, stage]);
      return "blocked";
    }
    await client.query("UPDATE processing_state SET status='processing',attempts=CASE WHEN input_key IS DISTINCT FROM $5 THEN 1 ELSE attempts+1 END,run_token=$4,input_key=$5,error_code=NULL,heartbeat_at=now(),updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3",
      [job.noteId, job.noteVersion, stage, token, fingerprint]); claimed = true;
    timer = setInterval(() => {
      heartbeat = heartbeat.then(() => client.query("UPDATE processing_state SET heartbeat_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND run_token=$4", [job.noteId, job.noteVersion, stage, token]))
        .catch(() => { localAbort.abort(); });
    }, 10000); timer.unref();
    const input: StageInput = { noteId: note.id, noteVersion: note.current_version, title: note.title, body: note.body, folderId: note.folder_id, contentHash: note.content_hash };
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new AIError(signal.reason?.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_CANCELLED"));
      signal.addEventListener("abort", onAbort, { once: true }); if (signal.aborted) onAbort();
    });
    let result: unknown;
    try { result = await Promise.race([handler.prepare(input, { signal, config }), cancelled]); }
    finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
    await heartbeatStop(); signal.throwIfAborted();
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      await client.query("SELECT pg_advisory_xact_lock(71205002)");
      const currentConfig = resolveAIConfig(await readPreferences(client));
      const current = await lockCurrentNote(client, job.noteId, job.noteVersion);
      const owns = (await client.query("SELECT 1 FROM processing_state WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND run_token=$4 FOR UPDATE", [job.noteId, job.noteVersion, stage, token])).rowCount;
      if (!current || !owns || (stage !== "chunks" && !currentConfig.aiIndexingEnabled) || inputKey(stage, handler, currentConfig) !== fingerprint) {
        await client.query("UPDATE processing_state SET status='stale',error_code='INPUT_CHANGED',run_token=NULL,updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND run_token=$4", [job.noteId, job.noteVersion, stage, token]);
        await client.query("COMMIT"); return "stale";
      }
      await handler.publish(client, result, input);
      signal.throwIfAborted();
      await client.query("UPDATE processing_state SET status='ready',error_code=NULL,run_token=NULL,heartbeat_at=now(),updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND run_token=$4", [job.noteId, job.noteVersion, stage, token]);
      await client.query("COMMIT"); return "ready";
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  } catch (error) {
    await heartbeatStop();
    const code = signal.aborted ? "WORKER_INTERRUPTED" : error instanceof AIError ? error.code : "STAGE_FAILED";
    const retry = signal.aborted || !(error instanceof AIError) || error.retryable || error.code === "AI_TIMEOUT";
    if (claimed) await client.query("UPDATE processing_state SET status=$5::processing_status,error_code=$6,run_token=NULL,updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage=$3 AND run_token=$4", [job.noteId, job.noteVersion, stage, token, signal.aborted ? "pending" : "failed", code]);
    if (retry) throw new Error(code); // Graphile records only sanitized codes and applies exponential backoff.
    return "blocked";
  } finally {
    await heartbeatStop();
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]).catch(() => {});
    client.release();
  }
}
export function taskRegistry(pool: Pool, registry: Registry = createProductionRegistry(() => pool)): TaskList {
  return { "knowledge:index": async (raw, helpers) => asMaintenance(async () => {
    const job = indexJobSchema.parse(raw);
    if (await runStage(pool, registry, "chunks", job, helpers.abortSignal) !== "ready") return;
    // Graph extraction is independent of embedding provider availability.
    let failure: unknown;
    for (const stage of ["embeddings", "graph"] as const) {
      try { await runStage(pool, registry, stage, job, helpers.abortSignal); } catch (error) { failure = error; }
    }
    if (failure) throw failure;
  }) };
}
