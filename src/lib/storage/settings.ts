import type { Pool, PoolClient } from "pg";
import { requireAccess } from "./access";
import { transaction, getStorage } from "./client";
import { preferencesSchema, resolveAIConfig } from "../ai/preferences";

export async function readPreferences(db: Pool | PoolClient) {
  requireAccess();
  const values = Object.fromEntries((await db.query("SELECT key,value FROM settings WHERE key=ANY($1)", [Object.keys(preferencesSchema.shape)])).rows.map((r) => [r.key, r.value]));
  return preferencesSchema.parse(values);
}
export class SettingsService {
  constructor(private pool: Pool) {}
  async read() { return readPreferences(this.pool); }
  async save(input: unknown) {
    requireAccess(); const values = preferencesSchema.parse(input);
    await transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71205002)");
      const old = resolveAIConfig(await readPreferences(client)), next = resolveAIConfig({ ...await readPreferences(client), ...values });
      for (const [key, value] of Object.entries(values)) await client.query("INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()", [key, JSON.stringify(value)]);
      const changed = old.embeddingModel !== next.embeddingModel || old.embeddingDimensions !== next.embeddingDimensions || old.structuredModel !== next.structuredModel;
      if (changed || old.aiIndexingEnabled !== next.aiIndexingEnabled) {
        // Fence work already in flight. Workers must compare their run token before publishing.
        await client.query("UPDATE processing_state s SET status='stale',run_token=NULL,error_code='CONFIG_CHANGED',updated_at=now() FROM notes n WHERE n.id=s.note_id AND n.current_version=s.note_version AND n.lifecycle='active'");
        if (old.embeddingModel !== next.embeddingModel || old.embeddingDimensions !== next.embeddingDimensions) await client.query("UPDATE embedding_profiles SET active=false WHERE active=true");
        if (next.aiIndexingEnabled) await client.query("SELECT graphile_worker.add_job(identifier := 'knowledge:index', payload := json_build_object('noteId',id,'noteVersion',current_version,'pipelineVersion','v1'),job_key := 'index:'||id||':'||current_version||':v1',max_attempts := 8) FROM notes WHERE lifecycle='active'");
      }
    });
    return this.read();
  }
}
export function settings() { return new SettingsService(getStorage().pool); }
