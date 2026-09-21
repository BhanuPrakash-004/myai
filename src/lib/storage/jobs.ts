import { z } from "zod";
import type { PoolClient } from "pg";

export const indexJobSchema = z.object({
  noteId: z.uuid(), noteVersion: z.number().int().positive(),
  pipelineVersion: z.literal("v1"),
}).strict();

export async function enqueueNoteIndexing(client: PoolClient, noteId: string, noteVersion: number) {
  const payload = indexJobSchema.parse({ noteId, noteVersion, pipelineVersion: "v1" });
  await client.query(
    "INSERT INTO processing_state (note_id, note_version, stage) SELECT $1, $2, stage FROM unnest(ARRAY['chunks', 'embeddings', 'graph']) AS stage ON CONFLICT DO NOTHING",
    [noteId, noteVersion],
  );
  await client.query(
    "SELECT graphile_worker.add_job(identifier := $1, payload := $2::json, job_key := $3, max_attempts := 8)",
    ["knowledge:index", JSON.stringify(payload), "index:" + noteId + ":" + noteVersion + ":v1"],
  );
}

// A worker must acquire this guard inside the transaction that publishes results.
// It prevents an old job from marking a newer version ready while an edit races.
export async function lockCurrentNote(client: PoolClient, noteId: string, version: number): Promise<boolean> {
  const result = await client.query(
    "SELECT id FROM notes WHERE id = $1 AND current_version = $2 AND lifecycle = 'active' FOR UPDATE",
    [noteId, version],
  );
  return result.rowCount === 1;
}
