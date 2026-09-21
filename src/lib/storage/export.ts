import AdmZip from "adm-zip";
import type { Pool } from "pg";
import { requireAccess, DomainError } from "./access";
import { transaction } from "./client";
import { safePath, folderPathsSql } from "./knowledge";

// A consistent, portable document export. Full installation backups use pg_dump + attachment objects.
export async function exportNotes(pool: Pool, includeInactive = false) {
  requireAccess();
  return transaction(pool, async db => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const size = (await db.query(`SELECT
      (SELECT count(*) FROM notes WHERE $1 OR lifecycle='active') AS notes,
      coalesce((SELECT sum(octet_length(row_to_json(n)::text)) FROM notes n WHERE $1 OR lifecycle='active'),0)
      +coalesce((SELECT sum(octet_length(row_to_json(s)::text)) FROM sources s WHERE EXISTS(SELECT 1 FROM note_sources ns JOIN notes n ON n.id=ns.note_id WHERE ns.source_id=s.id AND ($1 OR n.lifecycle='active'))),0)
      +coalesce((SELECT sum(octet_length(row_to_json(g)::text)) FROM graph_evidence g),0)
      +coalesce((SELECT sum(octet_length(row_to_json(g)::text)) FROM graph_nodes g),0) AS bytes`, [includeInactive])).rows[0];
    if (Number(size.notes) > 10000 || Number(size.bytes) > 50 * 1024 * 1024) throw new DomainError("EXPORT_LIMIT", "Document/source inventory exceeds the bounded export limit. Use a full backup.", 413);
    const notes = (await db.query(`SELECT n.*,r.path FROM notes n JOIN note_routes r ON r.note_id=n.id WHERE $1 OR n.lifecycle='active' ORDER BY r.path LIMIT 10001`, [includeInactive])).rows;
    if (notes.length > 10000) throw new DomainError("EXPORT_LIMIT", "Use a full backup for more than 10,000 notes.", 413);
    const ids = notes.map(n => n.id), zip = new AdmZip(); let bytes = 0;
    const add = (path: string, body: string) => { bytes += Buffer.byteLength(body); if (bytes > 50 * 1024 * 1024) throw new DomainError("EXPORT_LIMIT", "Export exceeds 50 MB. Use a full backup.", 413); zip.addFile(path, Buffer.from(body)); };
    for (const n of notes) add("vault/" + safePath(n.path), n.body);
    const folders = (await db.query(folderPathsSql + " SELECT * FROM folder_paths ORDER BY path")).rows;
    for (const f of folders) if (f.path) zip.addFile("vault/" + f.path + "/", Buffer.alloc(0));
    const sources = (await db.query("SELECT DISTINCT s.* FROM sources s JOIN note_sources ns ON ns.source_id=s.id WHERE ns.note_id=ANY($1::uuid[])", [ids])).rows;
    const links = (await db.query("SELECT * FROM note_sources WHERE note_id=ANY($1::uuid[])", [ids])).rows;
    const graph = (await db.query(`SELECT e.*,coalesce(jsonb_agg(jsonb_build_object('chunkId',g.chunk_id,'noteId',c.note_id,'version',c.note_version,'start',g.start_offset,'end',g.end_offset,'quote',g.quote)) FILTER(WHERE g.id IS NOT NULL),'[]') AS evidence
      FROM graph_edges e LEFT JOIN graph_evidence g ON g.edge_id=e.id LEFT JOIN chunks c ON c.id=g.chunk_id
      WHERE EXISTS(SELECT 1 FROM graph_evidence ge JOIN chunks ch ON ch.id=ge.chunk_id WHERE ge.edge_id=e.id AND ch.note_id=ANY($1::uuid[]))
        OR EXISTS(SELECT 1 FROM graph_nodes n WHERE n.id IN(e.from_node_id,e.to_node_id) AND n.note_id=ANY($1::uuid[])) GROUP BY e.id`, [ids])).rows;
    const nodes = (await db.query("SELECT * FROM graph_nodes WHERE id=ANY($1::uuid[]) OR note_id=ANY($2::uuid[])", [graph.flatMap(e => [e.from_node_id, e.to_node_id]), ids])).rows;
    const attachments = (await db.query("SELECT * FROM attachments WHERE id=ANY($1::uuid[])", [sources.map(s => s.attachment_id).filter(Boolean)])).rows;
    add("manifest.json", JSON.stringify({ format: "myai-notes-v2", exportedAt: new Date().toISOString(), includeInactive, fullBackup: false,
      description: "Portable current Markdown and provenance. Import creates new local identities. Use full recovery backup for versions, learning, owner credentials and attachment bytes.",
      folders, notes: notes.map(note => Object.fromEntries(Object.entries(note).filter(([key]) => key !== "body" && key !== "search_vector"))), sourceLinks: links }, null, 2));
    add("sources.json", JSON.stringify(sources)); add("graph.json", JSON.stringify({ nodes, edges: graph }));
    add("attachments.json", JSON.stringify({ includedBytes: false, attachments }));
    return zip.toBuffer();
  });
}
