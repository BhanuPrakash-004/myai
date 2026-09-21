import type { Pool } from "pg";
import { z } from "zod";
import { requireAccess } from "./access";
import { modelId } from "../ai/preferences";
import type { EmbeddingProfile, EmbeddingProfileStore } from "../ai/openrouter";
export class EmbeddingProfiles implements EmbeddingProfileStore {
  constructor(private pool: Pool) {}
  async record(raw: EmbeddingProfile) {
    requireAccess();
    const profile = z.object({ model: modelId, dimensions: z.literal(1536), normalization: z.literal("provider"), chunkerVersion: z.string().min(1).max(100) }).strict().parse(raw);
    // Recording alone never activates a profile. Fenced embedding publication checks full coverage.
    return (await this.pool.query("INSERT INTO embedding_profiles(model,dimensions,normalization,chunker_version) VALUES($1,$2,$3,$4) ON CONFLICT(model,dimensions,normalization,chunker_version) DO UPDATE SET model=excluded.model RETURNING id",
      [profile.model, profile.dimensions, profile.normalization, profile.chunkerVersion])).rows[0].id as string;
  }
}
