import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "./client";
import { requireAccess, DomainError } from "./access";
import { AttachmentService } from "./attachments";

// Local maintenance only, explicit UUID/version after a 30-day trash retention window.
export async function purgeNote(pool: Pool, directory: string, id: string, expectedVersion: number) {
  if (requireAccess().kind !== "maintenance") throw new DomainError("LOCAL_ONLY", "Permanent deletion is a local maintenance command.", 403);
  z.uuid().parse(id); z.number().int().positive().parse(expectedVersion);
  const result = await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(71202001)");
    await db.query("SELECT pg_advisory_xact_lock(71202002)");
    const note = (await db.query("SELECT id FROM notes WHERE id=$1 AND current_version=$2 AND lifecycle='trashed' AND trashed_at<=now()-interval '30 days' FOR UPDATE", [id, expectedVersion])).rows[0];
    if (!note) throw new DomainError("RETENTION", "Note must match the expected version and have been in trash for at least 30 days.", 409);
    const sources = (await db.query("SELECT DISTINCT source_id FROM note_sources WHERE note_id=$1", [id])).rows.map(r => r.source_id);
    const attachments = (await db.query("SELECT DISTINCT attachment_id FROM sources WHERE id=ANY($1::uuid[]) AND attachment_id IS NOT NULL", [sources])).rows.map(r => r.attachment_id);
    const cards = (await db.query("SELECT id FROM study_cards WHERE note_id=$1", [id])).rows.map(r => r.id);
    const affectedEdges = (await db.query("SELECT DISTINCT g.edge_id FROM graph_evidence g JOIN chunks c ON c.id=g.chunk_id WHERE c.note_id=$1", [id])).rows.map(r => r.edge_id);
    const affectedNodes = (await db.query("SELECT from_node_id AS id FROM graph_edges WHERE id=ANY($1::uuid[]) UNION SELECT to_node_id AS id FROM graph_edges WHERE id=ANY($1::uuid[])", [affectedEdges])).rows.map(r => r.id);
    const sessions = (await db.query("SELECT DISTINCT session_id FROM quiz_questions WHERE card_id=ANY($1::uuid[])", [cards])).rows.map(r => r.session_id);
    // Session summaries would otherwise silently change denominators; delete affected sessions in full.
    await db.query("DELETE FROM quiz_sessions_v2 WHERE id=ANY($1::uuid[])", [sessions]);
    await db.query("DELETE FROM review_events WHERE card_id=ANY($1::uuid[])", [cards]);
    await db.query("DELETE FROM study_cards WHERE note_id=$1", [id]);
    await db.query("DELETE FROM reading_items WHERE note_id=$1", [id]);
    const messages = (await db.query("SELECT DISTINCT mc.message_id FROM message_citations mc JOIN chunks c ON c.id=mc.chunk_id WHERE c.note_id=$1", [id])).rows.map(r => r.message_id);
    await db.query("DELETE FROM messages WHERE id=ANY($1::uuid[])", [messages]);
    await db.query("DELETE FROM improvement_proposals WHERE note_id=$1", [id]);
    await db.query("DELETE FROM import_items WHERE note_id=$1", [id]);
    // Remove private payloads and reset undo references while retaining the idempotency tombstone.
    const operations = (await db.query("UPDATE operations SET note_id=NULL,input='{}',result=jsonb_build_object('purged',true),status='cancelled',error_code='SOURCE_PURGED' WHERE note_id=$1 OR strpos(input::text,$1::text)>0 OR strpos(result::text,$1::text)>0 RETURNING id", [id])).rows.map(r => r.id);
    await db.query("DELETE FROM improvement_proposals WHERE operation_id=ANY($1::uuid[])", [operations]);
    await db.query("DELETE FROM messages WHERE operation_id=ANY($1::uuid[])", [operations]);
    await db.query("DELETE FROM graph_nodes WHERE note_id=$1", [id]);
    await db.query("DELETE FROM notes WHERE id=$1", [id]);
    await db.query("DELETE FROM graph_edges e WHERE id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM graph_evidence g WHERE g.edge_id=e.id)", [affectedEdges]);
    await db.query("DELETE FROM graph_nodes n WHERE id=ANY($1::uuid[]) AND kind='concept' AND NOT EXISTS(SELECT 1 FROM graph_edges e WHERE n.id IN(e.from_node_id,e.to_node_id))", [affectedNodes]);
    await db.query("DELETE FROM sources s WHERE id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM note_sources ns WHERE ns.source_id=s.id) AND NOT EXISTS(SELECT 1 FROM graph_evidence g WHERE g.source_id=s.id)", [sources]);
    // ZIP originals can include the purged note. Remove those archives even if other imported notes shared them.
    // Keep a tombstone: source records are immutable, including their original attachment identity.
    await db.query("UPDATE attachments SET state='purged' WHERE id=ANY($1::uuid[])", [attachments]);
    return { purgedNoteId: id, removedSessions: sessions.length, removedOriginalUploads: attachments.length };
  });
  // Untracked objects are inaccessible through downloads immediately; reconcile completes physical removal.
  await new AttachmentService(pool, directory).reconcile(0);
  return result;
}
