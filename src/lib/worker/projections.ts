import type { Pool } from "pg";
import type { Registry } from "./runtime";
import { getStorage } from "../storage/client";
import { OpenRouterClient, type EmbeddingProfile } from "../ai/openrouter";
import { UsageService } from "../storage/usage";
import { EmbeddingProfiles } from "../storage/embedding-profiles";
import { AIContentService } from "../ai/content";
import type { AIConfig } from "../ai/preferences";
import { AIError } from "../ai/errors";
import { CHUNKER_VERSION, chunkNote, storeChunks, type PassageChunk } from "../retrieval/chunks";
import { addGraphEvidence, deterministicGraph, graphEdge, graphNode } from "../storage/graph";
import { hash } from "../storage/knowledge";

export const EXTRACTOR_VERSION = "explicit-relations-v1";
export function createProjectionClient(pool: Pool, config: AIConfig) {
  return new OpenRouterClient(config, new UsageService(pool, config), fetch, undefined, new EmbeddingProfiles(pool));
}
export function createProductionRegistry(pool: () => Pool = () => getStorage().pool, provider = createProjectionClient): Registry {
  return {
    chunks: {
      version: CHUNKER_VERSION,
      async prepare(input) { return chunkNote(input.noteId, input.noteVersion, input.body); },
      async publish(client, result, input) {
        const chunks = result as PassageChunk[];
        await storeChunks(client, chunks);
        await client.query("SELECT pg_advisory_xact_lock(71209001)");
        await deterministicGraph(client, input, chunks);
      },
    },
    embeddings: {
      version: CHUNKER_VERSION + ":embedding-v1",
      async prepare(input, { config, signal }) {
        const chunks = chunkNote(input.noteId, input.noteVersion, input.body), ai = provider(pool(), config);
        const profile: EmbeddingProfile = { model: config.embeddingModel, dimensions: config.embeddingDimensions, normalization: "provider", chunkerVersion: CHUNKER_VERSION };
        const profileId = await new EmbeddingProfiles(pool()).record(profile);
        const inputKey = "embedding:" + profileId;
        const rows: { id: string; vector: number[] }[] = [];
        // Batches keep one request bounded; no partial batch is published as a ready note.
        for (let i = 0; i < chunks.length; i += 16) {
          signal.throwIfAborted(); const batch = chunks.slice(i, i + 16);
          const cached = (await pool().query("SELECT chunk_id,result FROM projection_cache WHERE chunk_id=ANY($1::uuid[]) AND input_key=$2", [batch.map((c) => c.id), inputKey])).rows;
          const existing = (await pool().query("SELECT chunk_id,embedding::text AS vector FROM chunk_embeddings WHERE chunk_id=ANY($1::uuid[]) AND profile_id=$2", [batch.map((c) => c.id), profileId])).rows;
          const vectors = new Map<string, number[]>([...cached.map((c) => [c.chunk_id, c.result] as [string, number[]]), ...existing.map((c) => [c.chunk_id, JSON.parse(c.vector)] as [string, number[]])]);
          const missing = batch.filter((c) => !vectors.has(c.id));
          if (missing.length) {
            const response = await ai.embed(missing.map((c) => c.body), profile, { signal });
            for (const [index, chunk] of missing.entries()) {
              await pool().query("INSERT INTO projection_cache(chunk_id,input_key,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [chunk.id, inputKey, JSON.stringify(response.vectors[index])]);
              vectors.set(chunk.id, response.vectors[index]);
            }
          }
          rows.push(...batch.map((c) => ({ id: c.id, vector: vectors.get(c.id)! })));
        }
        return { chunks, profileId, rows };
      },
      async publish(client, raw) {
        const result = raw as { chunks: PassageChunk[]; profileId: string; rows: { id: string; vector: number[] }[] };
        await storeChunks(client, result.chunks);
        for (const row of result.rows) await client.query("INSERT INTO chunk_embeddings(chunk_id,profile_id,embedding) VALUES($1,$2,$3::vector) ON CONFLICT DO NOTHING", [row.id, result.profileId, JSON.stringify(row.vector)]);
        await client.query("DELETE FROM projection_cache WHERE chunk_id=ANY($1::uuid[]) AND input_key=$2", [result.chunks.map((c) => c.id), "embedding:" + result.profileId]);
        // Publish and activate under the runtime's configuration lock. An initial/profile rebuild
        // activates only when EVERY nonempty current note is covered. New edits fall back to text.
        const incomplete = (await client.query(`SELECT 1 FROM notes n WHERE n.lifecycle='active' AND n.body ~ '[^[:space:]]' AND (
          NOT EXISTS(SELECT 1 FROM processing_state s WHERE s.note_id=n.id AND s.note_version=n.current_version AND s.stage='chunks' AND s.status='ready')
          OR NOT EXISTS(SELECT 1 FROM current_chunks c WHERE c.note_id=n.id AND c.chunker_version=$2)
          OR EXISTS(SELECT 1 FROM current_chunks c WHERE c.note_id=n.id AND c.chunker_version=$2
            AND NOT EXISTS(SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id=c.id AND e.profile_id=$1))) LIMIT 1`, [result.profileId, CHUNKER_VERSION])).rowCount;
        if (!incomplete) {
          await client.query("UPDATE embedding_profiles SET active=false WHERE active AND id<>$1", [result.profileId]);
          await client.query("UPDATE embedding_profiles SET active=true WHERE id=$1", [result.profileId]);
        }
      },
    },
    graph: {
      version: EXTRACTOR_VERSION + ":" + CHUNKER_VERSION,
      async prepare(input, { config, signal }) {
        const chunks = chunkNote(input.noteId, input.noteVersion, input.body), content = new AIContentService(provider(pool(), config));
        const extractions: { chunk: PassageChunk; result: Awaited<ReturnType<AIContentService["extractGraph"]>> }[] = [];
        const inputKey = "graph:" + EXTRACTOR_VERSION + ":" + config.structuredModel;
        for (const chunk of chunks) {
          signal.throwIfAborted();
          const cached = (await pool().query("SELECT result FROM projection_cache WHERE chunk_id=$1 AND input_key=$2", [chunk.id, inputKey])).rows[0];
          const result = cached?.result ?? await content.extractGraph(chunk.body, { signal });
          if (!cached) await pool().query("INSERT INTO projection_cache(chunk_id,input_key,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [chunk.id, inputKey, JSON.stringify(result)]);
          extractions.push({ chunk, result });
        }
        return { chunks, extractions, model: config.structuredModel };
      },
      async publish(client, raw, input) {
        const result = raw as { chunks: PassageChunk[]; extractions: { chunk: PassageChunk; result: Awaited<ReturnType<AIContentService["extractGraph"]>> }[]; model: string };
        await storeChunks(client, result.chunks);
        await client.query("SELECT pg_advisory_xact_lock(71209001)");
        const noteId = await deterministicGraph(client, input, result.chunks);
        await client.query(`DELETE FROM graph_evidence v USING graph_edges e,chunks c
          WHERE v.edge_id=e.id AND v.chunk_id=c.id AND e.origin='ai_extracted' AND c.note_id=$1 AND c.note_version=$2`, [input.noteId, input.noteVersion]);
        for (const { chunk, result: extraction } of result.extractions) {
          const resolved = new Map<string, string>();
          for (const concept of extraction.concepts) {
            // Equal labels alone never merge meanings. Auto identity is local to note + explicit
            // description. Cross-note equivalence requires an owner alias or reviewed merge.
            const alias = (await client.query("SELECT node_id FROM concept_aliases WHERE scope_folder_id=$1 AND alias=$2", [input.folderId, concept.name.normalize("NFC").toLowerCase()])).rows[0];
            const node = alias ? { id: alias.node_id, metadata: {} as { mergedInto?: string } } : await graphNode(client, "concept", concept.name, input.folderId,
              hash([input.noteId, concept.name.normalize("NFC").toLowerCase(), concept.description.normalize("NFC").toLowerCase()].join("\n")), "ai_extracted", { description: concept.description, noteId: input.noteId });
            let id = node.id, next = node.metadata.mergedInto;
            const seen = new Set([id]);
            while (next) {
              if (seen.has(next) || seen.size > 100) throw new AIError("AI_MALFORMED");
              seen.add(next); id = next;
              const target = (await client.query("SELECT metadata FROM graph_nodes WHERE id=$1 AND kind='concept' AND scope_folder_id=$2", [id, input.folderId])).rows[0];
              if (!target) throw new AIError("AI_MALFORMED"); next = target.metadata.mergedInto;
            }
            resolved.set(concept.name, id);
            // A mentions edge needs an exact occurrence; descriptions are never used as evidence.
            const pos = chunk.body.indexOf(concept.name);
            if (pos >= 0) {
              const start = Array.from(chunk.body.slice(0, pos)).length;
              const edge = await graphEdge(client, noteId, id, "mentions", "ai_extracted", result.model, EXTRACTOR_VERSION);
              if (edge) await addGraphEvidence(client, edge.id, chunk.id, start, start + Array.from(concept.name).length, concept.name);
            }
          }
          for (const relation of extraction.relations) {
            const edge = await graphEdge(client, resolved.get(relation.from)!, resolved.get(relation.to)!, relation.type, "ai_extracted", result.model, EXTRACTOR_VERSION);
            if (edge) await addGraphEvidence(client, edge.id, chunk.id, relation.startOffset, relation.endOffset, relation.quote);
          }
        }
      },
    },
  };
}
