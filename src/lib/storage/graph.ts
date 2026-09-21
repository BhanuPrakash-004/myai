import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { DomainError, requireAccess } from "./access";
import { transaction, ROOT_FOLDER_ID } from "./client";
import { hash } from "./knowledge";
import { CHUNKER_VERSION, type PassageChunk } from "../retrieval/chunks";

export const relationship = z.enum(["contains", "mentions", "explains", "prerequisite_for", "related_to", "supports", "contradicts", "derived_from"]);
export type Relationship = z.infer<typeof relationship>;
export async function graphNode(client: PoolClient, kind: "note" | "topic" | "source" | "concept", label: string, scope: string, identity: string, origin = "deterministic", metadata = {}) {
  // Note/source identities survive moves. Topics follow stable folder IDs; concepts include a sense key.
  const conflict = kind === "note" ? "(note_id)" : kind === "source" ? "(source_id)" : "(kind,scope_folder_id,identity_key)";
  return (await client.query(`INSERT INTO graph_nodes(kind,label,scope_folder_id,identity_key,note_id,source_id,origin,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ${conflict} DO UPDATE SET
      label=CASE WHEN graph_nodes.origin='owner_curated' THEN graph_nodes.label ELSE excluded.label END,
      scope_folder_id=excluded.scope_folder_id RETURNING id,metadata`,
  [kind, label, scope, identity, kind === "note" ? identity : null, kind === "source" ? identity : null, origin, JSON.stringify(metadata)])).rows[0] as { id: string; metadata: { mergedInto?: string } };
}
export async function graphEdge(client: PoolClient, from: string, to: string, relation: Relationship, origin: string, model?: string, extractor?: string) {
  if (from === to) return null;
  return (await client.query(`INSERT INTO graph_edges(from_node_id,to_node_id,relation,origin,model,extractor_version,review_state)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(from_node_id,to_node_id,relation,origin) DO UPDATE SET
      model=excluded.model,extractor_version=excluded.extractor_version RETURNING id,disabled`,
  [from, to, relation, origin, model ?? null, extractor ?? null, origin === "owner_curated" ? "owner_reviewed" : "unreviewed"])).rows[0] as { id: string; disabled: boolean };
}
export async function addGraphEvidence(client: PoolClient, edgeId: string, chunkId: string, start: number, end: number, quote: string, sourceId?: string) {
  await client.query(`INSERT INTO graph_evidence(edge_id,chunk_id,start_offset,end_offset,quote,source_id) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(edge_id,chunk_id,start_offset,end_offset) DO NOTHING`, [edgeId, chunkId, start, end, quote, sourceId ?? null]);
}
export async function deterministicGraph(client: PoolClient, input: { noteId: string; noteVersion: number; title: string; folderId: string }, chunks: PassageChunk[]) {
  const note = await graphNode(client, "note", input.title, input.folderId, input.noteId);
  const folders = (await client.query(`WITH RECURSIVE parents AS (SELECT * FROM folders WHERE id=$1 UNION ALL
    SELECT f.* FROM folders f JOIN parents p ON p.parent_id=f.id) SELECT * FROM parents`, [input.folderId])).rows;
  const topics = new Map<string, string>();
  for (const folder of folders) topics.set(folder.id, (await graphNode(client, "topic", folder.name || "Library", folder.id, folder.id)).id);
  const first = chunks[0];
  const attach = async (from: string, to: string, relation: Relationship, sourceId?: string) => {
    const edge = await graphEdge(client, from, to, relation, "deterministic");
    if (edge && first) await addGraphEvidence(client, edge.id, first.id, 0, Array.from(first.body).length, first.body, sourceId);
  };
  await attach(topics.get(input.folderId)!, note.id, "contains");
  for (const folder of folders) if (folder.parent_id) await attach(topics.get(folder.parent_id)!, topics.get(folder.id)!, "contains");
  const sources = (await client.query("SELECT s.id,s.origin FROM note_sources ns JOIN sources s ON s.id=ns.source_id WHERE ns.note_id=$1 AND ns.version=$2", [input.noteId, input.noteVersion])).rows;
  for (const source of sources) {
    const node = await graphNode(client, "source", source.origin + " source", ROOT_FOLDER_ID, source.id);
    await attach(note.id, node.id, "derived_from", source.id);
  }
  return note.id;
}

export const graphChange = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), edgeId: z.uuid(), expectedRevision: z.number().int().positive(), disabled: z.boolean() }).strict(),
  z.object({ action: z.literal("correct"), edgeId: z.uuid(), expectedRevision: z.number().int().positive(), relation: relationship }).strict(),
  z.object({ action: z.literal("alias"), nodeId: z.uuid(), alias: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal("merge"), fromId: z.uuid(), toId: z.uuid() }).strict(),
]);
export class GraphService {
  constructor(private pool: Pool) {}
  async neighborhood(raw: unknown) {
    requireAccess();
    const input = z.object({ folderId: z.guid().default(ROOT_FOLDER_ID), nodeId: z.uuid().optional(), noteId: z.uuid().optional(), query: z.string().max(200).default(""), offset: z.number().int().min(0).max(10000).default(0), includeDisabled: z.boolean().default(false) }).strict().parse(raw);
    return transaction(this.pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(71202001)");
    await client.query("SELECT pg_advisory_xact_lock(71209001)");
    const scope = (await client.query<{ id: string }>("WITH RECURSIVE scope AS (SELECT id FROM folders WHERE id=$1 UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id) SELECT id FROM scope", [input.folderId])).rows.map((r) => r.id);
    const nodes = (await client.query(`SELECT DISTINCT g.* FROM graph_nodes g WHERE g.metadata->>'mergedInto' IS NULL
      AND (g.scope_folder_id=ANY($1::uuid[]) OR g.kind='source')
      AND ($2::uuid IS NULL OR g.id=$2) AND ($3::uuid IS NULL OR g.note_id=$3)
      AND ($4='' OR strpos(lower(g.label),lower($4))>0 OR EXISTS(SELECT 1 FROM concept_aliases a WHERE a.node_id=g.id AND strpos(a.alias,lower($4))>0))
      AND EXISTS(SELECT 1 FROM supported_graph_edges e JOIN current_graph_evidence v ON v.edge_id=e.id JOIN notes n ON n.id=v.note_id
        WHERE g.id IN(e.from_node_id,e.to_node_id) AND n.folder_id=ANY($1::uuid[])) ORDER BY g.label,g.id LIMIT 51 OFFSET $5`, [scope, input.nodeId ?? null, input.noteId ?? null, input.query, input.offset])).rows;
    const ids = nodes.slice(0, 50).map((n) => n.id);
    const edges = ids.length ? (await client.query(`SELECT e.*,a.label AS from_label,b.label AS to_label,
      a.kind AS from_kind,b.kind AS to_kind FROM supported_graph_edges e JOIN graph_nodes a ON a.id=e.from_node_id JOIN graph_nodes b ON b.id=e.to_node_id
      WHERE (e.from_node_id=ANY($1::uuid[]) OR e.to_node_id=ANY($1::uuid[])) AND ($3 OR NOT e.disabled)
      AND a.metadata->>'mergedInto' IS NULL AND b.metadata->>'mergedInto' IS NULL
      AND (a.scope_folder_id=ANY($2::uuid[]) OR a.kind='source') AND (b.scope_folder_id=ANY($2::uuid[]) OR b.kind='source')
      AND EXISTS(SELECT 1 FROM current_graph_evidence v JOIN notes n ON n.id=v.note_id WHERE v.edge_id=e.id AND n.folder_id=ANY($2::uuid[]))
      ORDER BY e.origin,e.id LIMIT 101`, [ids, scope, input.includeDisabled])).rows : [];
    const evidence = edges.length ? (await client.query(`SELECT v.*,c.start_offset AS chunk_start,c.end_offset AS chunk_end,n.title,n.provenance,r.path
      FROM current_graph_evidence v JOIN chunks c ON c.id=v.chunk_id JOIN notes n ON n.id=v.note_id LEFT JOIN note_routes r ON r.note_id=n.id
      WHERE v.edge_id=ANY($1::uuid[]) AND n.folder_id=ANY($2::uuid[]) ORDER BY v.edge_id,v.id LIMIT 500`, [edges.slice(0, 100).map((e) => e.id), scope])).rows : [];
    return { nodes: nodes.slice(0, 50), edges: edges.slice(0, 100), evidence, hasMore: nodes.length > 50, truncated: edges.length > 100 || evidence.length === 500 };
    });
  }
  async change(raw: unknown, key: string) {
    requireAccess(); const input = graphChange.parse(raw); z.string().min(8).max(160).parse(key);
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      await client.query("SELECT pg_advisory_xact_lock(71209001)");
      const opKey = "graph:" + key, digest = hash(JSON.stringify(input));
      const existing = (await client.query("SELECT request_hash,result FROM operations WHERE idempotency_key=$1", [opKey])).rows[0];
      if (existing) { if (existing.request_hash !== digest) throw new DomainError("IDEMPOTENCY_CONFLICT", "Use a new request key for a different change.", 409); return existing.result; }
      let result: Record<string, unknown>;
      if (input.action === "review" || input.action === "correct") {
        const edge = (await client.query("SELECT * FROM graph_edges WHERE id=$1 FOR UPDATE", [input.edgeId])).rows[0];
        if (!edge || edge.revision !== input.expectedRevision) throw new DomainError("GRAPH_CONFLICT", "The relationship changed. Reload before reviewing.", 409);
        if (edge.origin === "deterministic") throw new DomainError("DERIVED_RELATION", "Change the note or folder to change a deterministic relationship.", 409);
        if (input.action === "correct") {
          if (input.relation === edge.relation) throw new DomainError("UNCHANGED_RELATION", "Choose a different relation, or review the existing one.");
          const corrected = await graphEdge(client, edge.from_node_id, edge.to_node_id, input.relation, "owner_curated");
          await client.query("UPDATE graph_edges SET disabled=false,review_state='owner_reviewed',revision=revision+1 WHERE id=$1", [corrected!.id]);
          await client.query(`INSERT INTO graph_evidence(edge_id,chunk_id,source_id,start_offset,end_offset,quote)
            SELECT $1,chunk_id,source_id,start_offset,end_offset,quote FROM graph_evidence WHERE edge_id=$2 ON CONFLICT DO NOTHING`, [corrected!.id, edge.id]);
          await client.query("UPDATE graph_edges SET disabled=true,revision=revision+1 WHERE id=$1", [edge.id]);
          result = { edgeId: corrected!.id, corrected: true };
        } else {
          // Promote accepted AI assertions to curated copies; the original remains suppressed across reindex.
          if (!input.disabled && edge.origin === "ai_extracted") {
            const curated = await graphEdge(client, edge.from_node_id, edge.to_node_id, edge.relation, "owner_curated");
            await client.query("UPDATE graph_edges SET disabled=false,review_state='owner_reviewed',revision=revision+1 WHERE id=$1", [curated!.id]);
            await client.query(`INSERT INTO graph_evidence(edge_id,chunk_id,source_id,start_offset,end_offset,quote)
              SELECT $1,chunk_id,source_id,start_offset,end_offset,quote FROM graph_evidence WHERE edge_id=$2 ON CONFLICT DO NOTHING`, [curated!.id, edge.id]);
            await client.query("UPDATE graph_edges SET disabled=true,revision=revision+1 WHERE id=$1", [edge.id]);
            result = { edgeId: curated!.id, reviewed: true };
          } else {
            await client.query("UPDATE graph_edges SET disabled=$2,review_state='owner_reviewed',revision=revision+1 WHERE id=$1", [edge.id, input.disabled]); result = { edgeId: edge.id, disabled: input.disabled };
          }
        }
      } else if (input.action === "alias") {
        const node = (await client.query("SELECT * FROM graph_nodes WHERE id=$1 AND kind='concept' AND metadata->>'mergedInto' IS NULL FOR UPDATE", [input.nodeId])).rows[0];
        if (!node) throw new DomainError("NOT_FOUND", "Current concept not found.", 404);
        const alias = input.alias.normalize("NFC").toLowerCase();
        const conflict = (await client.query("SELECT node_id FROM concept_aliases WHERE scope_folder_id=$1 AND alias=$2", [node.scope_folder_id, alias])).rows[0];
        if (conflict && conflict.node_id !== node.id) throw new DomainError("ALIAS_CONFLICT", "This alias already identifies another concept in this folder.", 409);
        await client.query("INSERT INTO concept_aliases(node_id,scope_folder_id,alias) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [node.id, node.scope_folder_id, alias]); result = { nodeId: node.id, alias };
      } else {
        if (input.fromId === input.toId) throw new DomainError("GRAPH_CONFLICT", "Choose two different concepts.");
        const nodes = (await client.query("SELECT * FROM graph_nodes WHERE id=ANY($1::uuid[]) AND kind='concept' AND metadata->>'mergedInto' IS NULL ORDER BY id FOR UPDATE", [[input.fromId, input.toId]])).rows;
        if (nodes.length !== 2 || nodes[0].scope_folder_id !== nodes[1].scope_folder_id) throw new DomainError("GRAPH_CONFLICT", "Merge requires two current concepts in the same folder.", 409);
        const edges = (await client.query("SELECT * FROM graph_edges WHERE (from_node_id=$1 OR to_node_id=$1) AND NOT disabled FOR UPDATE", [input.fromId])).rows;
        for (const edge of edges) {
          const merged = await graphEdge(client, edge.from_node_id === input.fromId ? input.toId : edge.from_node_id, edge.to_node_id === input.fromId ? input.toId : edge.to_node_id, edge.relation, "owner_curated");
          if (merged) await client.query(`INSERT INTO graph_evidence(edge_id,chunk_id,source_id,start_offset,end_offset,quote)
            SELECT $1,chunk_id,source_id,start_offset,end_offset,quote FROM graph_evidence WHERE edge_id=$2 ON CONFLICT DO NOTHING`, [merged.id, edge.id]);
          await client.query("UPDATE graph_edges SET disabled=true,revision=revision+1 WHERE id=$1", [edge.id]);
        }
        await client.query("UPDATE concept_aliases SET node_id=$2 WHERE node_id=$1", [input.fromId, input.toId]);
        await client.query("UPDATE graph_nodes SET metadata=metadata || jsonb_build_object('mergedInto',$2::text),origin='owner_curated' WHERE id=$1", [input.fromId, input.toId]);
        result = { nodeId: input.toId, mergedId: input.fromId };
      }
      await client.query("INSERT INTO operations(idempotency_key,request_hash,action,status,input,result) VALUES($1,$2,'graph-review','completed',$3,$4)", [opKey, digest, JSON.stringify(input), JSON.stringify(result)]);
      return result;
    });
  }
}

// At most two relationship hops from seed passages, never entire-vault traversal.
export async function expandGraph(pool: Pool, seedChunks: string[], scope: string[], limit = 30) {
  if (!seedChunks.length) return [] as { chunk_id: string }[];
  return (await pool.query<{ chunk_id: string }>(`WITH seeds AS (
    SELECT DISTINCT e.from_node_id AS id FROM current_graph_edges e JOIN current_graph_evidence v ON v.edge_id=e.id WHERE v.chunk_id=ANY($1::uuid[])
    UNION SELECT DISTINCT e.to_node_id FROM current_graph_edges e JOIN current_graph_evidence v ON v.edge_id=e.id WHERE v.chunk_id=ANY($1::uuid[])
  ), neighbors AS (
    SELECT e.id FROM current_graph_edges e JOIN graph_nodes a ON a.id=e.from_node_id JOIN graph_nodes b ON b.id=e.to_node_id
    WHERE e.relation NOT IN ('contains','derived_from') AND (e.from_node_id IN(SELECT id FROM seeds) OR e.to_node_id IN(SELECT id FROM seeds))
      AND a.scope_folder_id=ANY($2::uuid[]) AND b.scope_folder_id=ANY($2::uuid[]) ORDER BY e.id LIMIT 100
  ) SELECT DISTINCT v.chunk_id FROM current_graph_evidence v JOIN notes n ON n.id=v.note_id JOIN chunks c ON c.id=v.chunk_id
    WHERE v.edge_id IN(SELECT id FROM neighbors) AND n.folder_id=ANY($2::uuid[]) AND c.chunker_version=$3
    ORDER BY v.chunk_id LIMIT $4`, [seedChunks, scope, CHUNKER_VERSION, limit])).rows;
}
