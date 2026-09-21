import type { Pool } from "pg";
import { z } from "zod";
import { requireAccess, DomainError } from "../storage/access";
import { ROOT_FOLDER_ID, transaction } from "../storage/client";
import { KnowledgeService, noteSelect, type Note } from "../storage/knowledge";
import { readPreferences } from "../storage/settings";
import { resolveAIConfig } from "../ai/preferences";
import { createProjectionClient } from "../worker/projections";
import { CHUNKER_VERSION, chunkNote, storeChunks, type PassageChunk } from "./chunks";
import { expandGraph } from "../storage/graph";

export const retrievalInput = z.object({
  query: z.string().max(4000).default(""), folderId: z.guid().default(ROOT_FOLDER_ID), descendants: z.boolean().default(true),
  noteId: z.uuid().optional(), provenance: z.enum(["user_written", "imported", "ai_generated", "ai_improved", "migrated_unknown"]).optional(),
  limit: z.number().int().min(1).max(50).default(8), offset: z.number().int().min(0).max(199).default(0),
  mode: z.enum(["search", "summary"]).default("search"), method: z.enum(["hybrid", "keyword"]).default("hybrid"), graph: z.boolean().optional(),
}).strict();
export interface EvidencePassage extends PassageChunk {
  citationId: string; title: string; path: string; folderId: string; provenance: string; updatedAt: string;
  url: string; score: number; via: string[];
  sources?: { id: string; origin: string; observedAt: string; validAsOf: string | null }[];
}
export interface RetrievalResult {
  passages: EvidencePassage[]; warnings: string[]; hasMore: boolean; latencyMs: number;
  coverage: { totalNotes: number; representedNotes: number; complete: boolean; mode: "search" | "summary"; offset: number };
  diagnostics: { lexicalCandidates: number; vectorCandidates: number; graphCandidates: number; reranked: boolean; profileId: string | null };
}
const stop = new Set("a an the is are was were what why when where how do does did can could would should i me my of in on to for and or it this that please explain tell about give show describe".split(" "));
export function queryTerms(query: string) {
  const phrases = Array.from(query.matchAll(/"([^"]+)"/g), (m) => m[1].toLowerCase()).slice(0, 10);
  const tokens = query.replace(/"[^"]+"/g, " ").toLowerCase().split(/\s+/).map((s) => s.replace(/^[(']+|[).,!?;:']+$/g, "")).filter((s) => s && !stop.has(s)).slice(0, 30);
  return { phrases, tokens: [...new Set([...phrases, ...tokens])], required: [...phrases, ...tokens.filter((s) => /[+.#/\\=<>]|^--/.test(s))] };
}
function scoreText(text: string, terms: ReturnType<typeof queryTerms>) {
  const lower = text.toLowerCase();
  return terms.tokens.reduce((score, t) => score + (lower.includes(t) ? 1 : 0), 0) + terms.phrases.reduce((score, t) => score + (lower.includes(t) ? 3 : 0), 0);
}
function evidence(chunk: PassageChunk, note: Note, via: string): EvidencePassage {
  return { ...chunk, citationId: "E" + chunk.id.replaceAll("-", ""), title: note.title, path: note.path, folderId: note.folder_id,
    provenance: note.provenance, updatedAt: new Date(note.updated_at).toISOString(), url: "/evidence/" + chunk.id, score: 0, via: [via] };
}
export class RetrievalService {
  constructor(private pool: Pool, private provider = createProjectionClient) {}
  async retrieve(raw: z.input<typeof retrievalInput>, options: { signal?: AbortSignal; operationId?: string } = {}): Promise<RetrievalResult> {
    requireAccess(); const started = performance.now(), input = retrievalInput.parse(raw), terms = queryTerms(input.query);
    const knowledge = new KnowledgeService(this.pool), scope = await knowledge.folderIds(input.folderId, input.descendants);
    const config = resolveAIConfig(await readPreferences(this.pool)), warnings: string[] = [];
    const total = Number((await this.pool.query("SELECT count(*) FROM notes WHERE lifecycle='active' AND folder_id=ANY($1::uuid[]) AND ($2::text IS NULL OR provenance::text=$2) AND ($3::uuid IS NULL OR id=$3)", [scope, input.provenance ?? null, input.noteId ?? null])).rows[0].count);
    const candidates = new Map<string, EvidencePassage>(), lexical: EvidencePassage[] = [], semantic: EvidencePassage[] = [];
    const chunkCache = new Map<string, PassageChunk[]>();
    const maxCandidates = 200; // Stable candidate window across pages of an unchanged query/library.
    const notes = (await this.pool.query<Note>(noteSelect + ` WHERE n.lifecycle='active' AND n.folder_id=ANY($1::uuid[])
      AND ($2::text IS NULL OR n.provenance::text=$2) AND ($3::uuid IS NULL OR n.id=$3)
      AND ($4 OR (cardinality($5::text[])>0 AND (
        n.search_vector @@ websearch_to_tsquery('simple',$6) OR EXISTS(SELECT 1 FROM unnest($5::text[]) t WHERE strpos(lower(n.title || E'\n' || n.body),t)>0))))
      AND ($4 OR NOT EXISTS(SELECT 1 FROM unnest($7::text[]) t WHERE strpos(lower(n.title || E'\n' || n.body),t)=0))
      ORDER BY CASE WHEN $4 THEN 0 ELSE ts_rank_cd(n.search_vector,websearch_to_tsquery('simple',$6)) END DESC,n.id LIMIT $8`,
    [scope, input.provenance ?? null, input.noteId ?? null, input.mode === "summary" || Boolean(input.noteId), terms.tokens, input.query, terms.required, maxCandidates])).rows;
    for (const note of notes) {
      const chunks = chunkNote(note.id, note.current_version, note.body); chunkCache.set(note.id, chunks);
      const ranked = chunks.map((chunk) => ({ chunk, score: scoreText(chunk.body, terms) + scoreText(note.title, terms) * .25 }))
        .filter((c) => input.mode === "summary" || ((input.noteId || c.score > 0) && terms.required.every((t) => (note.title + "\n" + c.chunk.body).toLowerCase().includes(t)))).sort((a, b) => b.score - a.score || a.chunk.ordinal - b.chunk.ordinal).slice(0, input.mode === "summary" ? 1 : 3);
      for (const row of ranked) { const item = evidence(row.chunk, note, "keyword"); item.score = row.score; lexical.push(item); }
    }
    if (input.mode !== "summary") lexical.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    let profileId: string | null = null, ai: ReturnType<typeof createProjectionClient> | undefined;
    if (input.method === "hybrid" && input.mode !== "summary" && input.query.trim() && config.apiKey) {
      const profile = (await this.pool.query("SELECT * FROM embedding_profiles WHERE active AND model=$1 AND dimensions=$2 AND chunker_version=$3", [config.embeddingModel, config.embeddingDimensions, CHUNKER_VERSION])).rows[0];
      if (profile) {
        profileId = profile.id; ai = this.provider(this.pool, config);
        try {
          const queryVector = await ai.embed([input.query], { model: profile.model, dimensions: profile.dimensions, normalization: "provider", chunkerVersion: profile.chunker_version }, options);
          const rows = (await this.pool.query(`SELECT c.*,n.title,n.folder_id,n.provenance,n.updated_at,r.path,(e.embedding <=> $1::vector) AS distance
            FROM current_embeddings e JOIN current_chunks c ON c.id=e.chunk_id JOIN notes n ON n.id=c.note_id LEFT JOIN note_routes r ON r.note_id=n.id
            WHERE e.profile_id=$2 AND n.folder_id=ANY($3::uuid[]) AND ($4::text IS NULL OR n.provenance::text=$4) AND ($5::uuid IS NULL OR n.id=$5)
              AND NOT EXISTS(SELECT 1 FROM unnest($6::text[]) t WHERE strpos(lower(n.title || E'\n' || c.body),t)=0)
            ORDER BY e.embedding <=> $1::vector,c.id LIMIT 60`, [JSON.stringify(queryVector.vectors[0]), profileId, scope, input.provenance ?? null, input.noteId ?? null, terms.required])).rows;
          for (const row of rows) semantic.push({ id: row.id, noteId: row.note_id, version: row.note_version, ordinal: row.ordinal, body: row.body, start: row.start_offset, end: row.end_offset, heading: row.heading || "", tokens: row.token_count,
            title: row.title, path: row.path, folderId: row.folder_id, provenance: row.provenance, updatedAt: new Date(row.updated_at).toISOString(), citationId: "E" + row.id.replaceAll("-", ""), url: "/evidence/" + row.id, score: 0, via: ["semantic"] });
        } catch (error) { if (options.signal?.aborted) throw error; warnings.push("Semantic retrieval unavailable; current text results are shown."); }
      } else warnings.push("No complete active embedding profile; using current text.");
    } else if (input.method === "hybrid" && input.mode !== "summary") warnings.push("Semantic retrieval is not configured; using current text.");
    // Reciprocal rank fusion, k=60. Never add incomparable lexical and cosine scores.
    for (const list of [lexical, semantic]) for (const [rank, item] of list.entries()) {
      const previous = candidates.get(item.id);
      if (previous) { previous.score += 1 / (60 + rank + 1); previous.via = [...new Set([...previous.via, ...item.via])]; }
      else candidates.set(item.id, { ...item, score: 1 / (60 + rank + 1) });
    }
    let graphCandidates = 0;
    if ((input.graph ?? config.graphExpansionEnabled) && input.mode !== "summary") {
      const seeds = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 8).map((c) => c.id);
      const expanded = await expandGraph(this.pool, seeds, scope);
      if (expanded.length) {
        const rows = (await this.pool.query(`SELECT c.*,n.title,n.folder_id,n.provenance,n.updated_at,r.path FROM current_chunks c
          JOIN notes n ON n.id=c.note_id LEFT JOIN note_routes r ON r.note_id=n.id WHERE c.id=ANY($1::uuid[]) AND n.folder_id=ANY($2::uuid[])
          AND ($3::text IS NULL OR n.provenance::text=$3) AND ($4::uuid IS NULL OR n.id=$4)
          AND NOT EXISTS(SELECT 1 FROM unnest($5::text[]) t WHERE strpos(lower(n.title || E'\n' || c.body),t)=0)`, [expanded.map((e) => e.chunk_id), scope, input.provenance ?? null, input.noteId ?? null, terms.required])).rows;
        for (const [rank, row] of rows.entries()) {
          if (candidates.has(row.id)) continue; graphCandidates++;
          candidates.set(row.id, { id: row.id, noteId: row.note_id, version: row.note_version, ordinal: row.ordinal, body: row.body, start: row.start_offset, end: row.end_offset, heading: row.heading || "", tokens: row.token_count,
            title: row.title, path: row.path, folderId: row.folder_id, provenance: row.provenance, updatedAt: new Date(row.updated_at).toISOString(), citationId: "E" + row.id.replaceAll("-", ""), url: "/evidence/" + row.id, score: .75 / (60 + rank + 1), via: ["graph"] });
        }
      }
    }
    let ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)), reranked = false;
    if (input.method === "hybrid" && input.mode !== "summary" && config.rerankEnabled && config.apiKey && ranked.length) {
      ai ??= this.provider(this.pool, config);
      const head = ranked.slice(0, 60), response = await ai.rerank(input.query, head.map((p) => ({ id: p.id, text: p.title + "\n" + p.body })), head.length, options);
      reranked = response.reranked; if (!reranked) warnings.push("Reranking unavailable; fused ordering retained.");
      ranked = [...response.results.map((r) => candidates.get(r.id)!), ...ranked.slice(60)];
    }
    const counts = new Map<string, number>();
    ranked = ranked.filter((p) => { const count = counts.get(p.noteId) ?? 0; counts.set(p.noteId, count + 1); return count < (input.mode === "summary" ? 1 : 2); });
    if (ranked.length > 200 || notes.length === maxCandidates) warnings.push("Candidate window limited to 200 notes/passages. Narrow the folder or query for additional results.");
    ranked = ranked.slice(0, 200);
    const page = ranked.slice(input.offset, input.offset + input.limit), passages: EvidencePassage[] = [];
    // Recheck after remote inference. Materialize fallback chunks as derived data for stable evidence
    // links; no note/source/version write and no false processing-ready status.
    await transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      const currentScope = input.descendants ? (await client.query<{ id: string }>("WITH RECURSIVE scope AS (SELECT id FROM folders WHERE id=$1 UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id) SELECT id FROM scope", [input.folderId])).rows.map((r) => r.id) : [input.folderId];
      for (const item of [...page].sort((a, b) => a.noteId.localeCompare(b.noteId))) {
        const note = (await client.query<Note>(noteSelect + " WHERE n.id=$1 AND n.current_version=$2 AND n.lifecycle='active' AND n.folder_id=ANY($3::uuid[]) FOR SHARE OF n", [item.noteId, item.version, currentScope])).rows[0];
        if (!note || note.folder_id !== item.folderId) { warnings.push("A source changed during retrieval and was excluded. Search again for its latest text."); continue; }
        await storeChunks(client, [item]); passages.push({ ...item, title: note.title, path: note.path });
      }
      const sources = passages.length ? (await client.query(`SELECT ns.note_id,ns.version,s.id,s.origin,s.observed_at,s.valid_as_of
        FROM note_sources ns JOIN sources s ON s.id=ns.source_id WHERE ns.note_id=ANY($1::uuid[]) ORDER BY s.observed_at DESC`, [[...new Set(passages.map((p) => p.noteId))]])).rows : [];
      for (const passage of passages) passage.sources = sources.filter((s) => s.note_id === passage.noteId && s.version === passage.version).slice(0, 20).map((s) => ({ id: s.id, origin: s.origin, observedAt: new Date(s.observed_at).toISOString(), validAsOf: s.valid_as_of ? new Date(s.valid_as_of).toISOString() : null }));
    });
    passages.sort((a, b) => page.findIndex((p) => p.id === a.id) - page.findIndex((p) => p.id === b.id));
    const representedNotes = new Set(passages.map((p) => p.noteId)).size;
    const complete = input.mode === "summary" && input.offset === 0 && representedNotes === total && passages.every((p) => (chunkCache.get(p.noteId)?.length ?? 0) === 1);
    if (input.mode === "summary" && !complete) warnings.push(`Partial folder coverage: ${representedNotes} of ${total} active notes, selected passages only. Continue through pages or narrow the scope.`);
    return { passages, warnings: [...new Set(warnings)], hasMore: ranked.length > input.offset + input.limit,
      coverage: { totalNotes: total, representedNotes, complete, mode: input.mode, offset: input.offset }, latencyMs: Math.round(performance.now() - started),
      diagnostics: { lexicalCandidates: lexical.length, vectorCandidates: semantic.length, graphCandidates, reranked, profileId } };
  }
  async notes(query: string, options: { limit?: number; folderId?: string; descendants?: boolean } = {}) {
    const limit = z.number().int().min(1).max(50).parse(options.limit ?? 15);
    const result = await this.retrieve({ query, ...options, limit: Math.min(50, limit * 2) });
    const ids = [...new Set(result.passages.map((p) => p.noteId))].slice(0, limit);
    const rows = (await this.pool.query<Note>(noteSelect + " WHERE n.id=ANY($1::uuid[]) AND n.lifecycle='active'", [ids])).rows;
    return ids.flatMap((id) => rows.filter((n) => n.id === id && result.passages.some((p) => p.noteId === id && p.version === n.current_version && p.folderId === n.folder_id)));
  }
  async inspect(id: string) {
    requireAccess(); z.uuid().parse(id);
    const row = (await this.pool.query(`SELECT c.*,v.title,n.current_version,n.lifecycle,n.provenance,n.folder_id,r.path
      FROM chunks c JOIN note_versions v ON v.note_id=c.note_id AND v.version=c.note_version JOIN notes n ON n.id=c.note_id
      LEFT JOIN note_routes r ON r.note_id=n.id WHERE c.id=$1`, [id])).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Evidence passage not found.", 404);
    const sources = (await this.pool.query(`SELECT s.id,s.origin,s.observed_at,s.valid_as_of,s.origin_url FROM note_sources ns JOIN sources s ON s.id=ns.source_id
      WHERE ns.note_id=$1 AND ns.version=$2 ORDER BY s.observed_at`, [row.note_id, row.note_version])).rows;
    return { ...row, sources, current: row.current_version === row.note_version && row.lifecycle === "active" };
  }
}
