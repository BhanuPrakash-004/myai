import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { KnowledgeService, hash, type Receipt } from "./knowledge";
import { transaction, ROOT_FOLDER_ID } from "./client";
import { requireAccess, DomainError } from "./access";
import type { ChatMessage } from "../ai/provider";

export const chatInput = z.object({ sessionId: z.uuid().optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(200000) }).strict()).min(1).max(50),
  mode: z.enum(["ask", "save", "generate", "improve"]).optional(), folderId: z.guid().optional(),
  noteId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional(), retry: z.boolean().optional(),
}).strict().refine((v) => !v.noteId || Boolean(v.expectedVersion), "Select the current note version.");
export interface Evidence { id: string; version: number; path: string; title: string; chunkId?: string; citationId?: string; url?: string }
export interface ChatTurn { sessionId: string; operationId: string; assistantId: string; folderId: string; content: string; rawContent: string; mode: "ask" | "save" | "generate" | "improve"; completed: boolean; token: string; noteId?: string; expectedVersion?: number; reply?: string; memory?: Record<string, unknown>; evidence?: Evidence[]; proposal?: Record<string, unknown> }
export class ChatService {
  constructor(public pool: Pool) {}
  async context(turn: ChatTurn): Promise<ChatMessage[]> {
    requireAccess();
    const rows = (await this.pool.query<ChatMessage>(`SELECT m.role,m.content FROM messages m JOIN operations o ON o.id=m.operation_id
      WHERE m.conversation_id=$1 AND o.status='completed' AND m.status='completed' AND m.operation_id<>$3
      AND m.sequence < (SELECT sequence FROM messages WHERE id=$2) ORDER BY m.sequence DESC LIMIT 20`, [turn.sessionId, turn.assistantId, turn.operationId])).rows;
    const recent: ChatMessage[] = []; let remaining = 32000;
    for (const row of rows) { if (row.content.length > remaining) break; recent.unshift(row); remaining -= row.content.length; }
    return [...recent, { role: "user", content: turn.content }];
  }
  async resolve(raw: z.input<typeof chatInput>) {
    requireAccess(); const input = chatInput.parse(raw), service = new KnowledgeService(this.pool), last = input.messages.at(-1)!;
    if (last.role !== "user") throw new DomainError("INVALID_MESSAGE", "The last message must be from the owner.");
    let folderId = input.folderId ?? ROOT_FOLDER_ID, content = last.content, mode = input.mode ?? "ask";
    const slash = content.match(/^\/([^\s]*)(?:\s([\s\S]*))?$/);
    if (slash) {
      const resolved = await service.resolveFolder(slash[1]);
      if (!resolved) throw new DomainError("UNKNOWN_FOLDER", "Create or select this folder before sending.", 404, { path: slash[1] });
      folderId = resolved; content = slash[2] ?? ""; mode = input.mode ?? "generate";
    }
    if (!(await service.resolveFolder(folderId))) throw new DomainError("NOT_FOUND", "Folder not found.", 404);
    if (input.noteId && !(slash && !content.trim())) {
      const note = await service.get(input.noteId, true), scope = await service.folderIds(folderId);
      if (!note || !scope.includes(note.folder_id)) throw new DomainError("NOTE_SCOPE", "Select a note inside the chosen folder scope.", 409);
      if (note.current_version !== input.expectedVersion || note.lifecycle !== "active") throw new DomainError("VERSION_CONFLICT", "The selected note changed or is inactive. Reload it before sending.", 409);
    }
    return { input, folderId, content, rawContent: last.content, mode, scopeOnly: Boolean(slash && !content.trim()) };
  }
  async recover() {
    requireAccess();
    await transaction(this.pool, async (client) => {
      const stale = (await client.query("UPDATE operations SET status='interrupted',error_code='CHAT_INTERRUPTED',updated_at=now() WHERE action='chat' AND status='running' AND updated_at<now()-interval '3 minutes' RETURNING id")).rows;
      if (stale.length) await client.query("UPDATE messages SET status='interrupted' WHERE operation_id=ANY($1::uuid[]) AND status='streaming'", [stale.map((r) => r.id)]);
    });
  }
  async history(sessionId?: string, archived = false, before?: number, focus?: string, offset = 0) {
    requireAccess(); await this.recover();
    if (sessionId) {
      z.uuid().parse(sessionId);
      const session = (await this.pool.query("SELECT * FROM conversations WHERE id=$1 AND deleted_at IS NULL", [sessionId])).rows[0];
      if (!session) throw new DomainError("NOT_FOUND", "Conversation not found.", 404);
      if (focus && !before) {
        z.uuid().parse(focus);
        const target = (await this.pool.query("SELECT sequence FROM messages WHERE id=$1 AND conversation_id=$2", [focus, sessionId])).rows[0];
        if (!target) throw new DomainError("NOT_FOUND", "Message not found in this conversation.", 404);
        before = target.sequence + 21;
      }
      const messages = (await this.pool.query(`SELECT m.*,m.metadata->'memory' AS memory_saved,o.status AS operation_status,o.error_code,p.state AS proposal_state,po.result->'receipt' AS proposal_receipt,
        CASE WHEN o.action='chat' THEN o.idempotency_key END AS retry_key,o.input->'request' AS retry_request
        FROM messages m LEFT JOIN operations o ON o.id=m.operation_id
        LEFT JOIN improvement_proposals p ON p.id=nullif(m.metadata->'proposal'->>'id','')::uuid
        LEFT JOIN operations po ON po.id=p.operation_id
        WHERE m.conversation_id=$1 AND ($2::int IS NULL OR m.sequence<$2)
        ORDER BY m.sequence DESC LIMIT 100`, [sessionId, before ?? null])).rows.reverse();
      for (const m of messages) if (m.metadata?.proposal && m.proposal_state) {
        m.metadata.proposal = { ...m.metadata.proposal, state: m.proposal_state, applied: m.proposal_state === "applied" };
        // Recover a committed proposal even if delivery/message reconciliation was interrupted.
        if (m.proposal_state === "applied" && m.proposal_receipt && !m.metadata.memory?.saved) {
          const receipt = m.proposal_receipt as Receipt;
          const version = (await this.pool.query("SELECT title,body FROM note_versions WHERE note_id=$1 AND version=$2", [receipt.noteId, receipt.version])).rows[0];
          m.metadata.memory = { saved: true, action: "IMPROVE", noteId: receipt.noteId, version: receipt.version, filePath: receipt.path, operationId: receipt.operationId, title: version?.title, indexing: "pending" };
          if (version) m.content = version.body;
        }
      }
      return { session, messages, hasOlder: messages.length === 100, sessions: undefined };
    }
    z.number().int().min(0).max(1000000).parse(offset);
    const sessions = (await this.pool.query("SELECT * FROM conversations WHERE archived=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT 201 OFFSET $2", [archived, offset])).rows;
    return { sessions: sessions.slice(0, 200), hasMoreSessions: sessions.length > 200, messages: undefined };
  }
  async conversation(raw: unknown) {
    requireAccess(); const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("create"), id: z.uuid(), title: z.string().trim().min(1).max(200), folderId: z.guid().default(ROOT_FOLDER_ID) }).strict(),
      z.object({ action: z.literal("update"), id: z.uuid(), title: z.string().trim().min(1).max(200).optional(), folderId: z.guid().optional(), archived: z.boolean().optional() }).strict(),
      z.object({ action: z.literal("delete"), id: z.uuid() }).strict(),
    ]).parse(raw);
    return transaction(this.pool, async (client) => {
      if (input.action === "create") return (await client.query("INSERT INTO conversations(id,title,folder_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET id=conversations.id RETURNING *", [input.id, input.title, input.folderId])).rows[0];
      const session = (await client.query("SELECT * FROM conversations WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [input.id])).rows[0];
      if (!session) throw new DomainError("NOT_FOUND", "Conversation not found.", 404);
      if ((await client.query("SELECT 1 FROM operations WHERE action='chat' AND status='running' AND input->>'sessionId'=$1", [input.id])).rowCount) throw new DomainError("CHAT_BUSY", "Stop the active response before changing this conversation.", 409);
      if (input.action === "delete") { await client.query("UPDATE conversations SET deleted_at=now(),archived=true,updated_at=now() WHERE id=$1", [input.id]); return { deleted: true }; }
      return (await client.query("UPDATE conversations SET title=coalesce($2,title),folder_id=coalesce($3,folder_id),archived=coalesce($4,archived),updated_at=now() WHERE id=$1 RETURNING *", [input.id, input.title, input.folderId, input.archived])).rows[0];
    });
  }
  async archive(id: string) { return this.conversation({ action: "update", id, archived: true }); }
  async begin(raw: z.input<typeof chatInput>, key: string): Promise<ChatTurn> {
    requireAccess(); await this.recover();
    const validated = chatInput.parse(raw), { retry, ...request } = validated, requestHash = hash(JSON.stringify(request));
    // Resolve only new requests: retries retain the original stable destination and source.
    const prior = (await this.pool.query("SELECT id FROM operations WHERE idempotency_key=$1", ["chat:" + key])).rows[0];
    const resolved = prior ? null : await this.resolve(validated);
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["chat:" + key]);
      const previous = (await client.query("SELECT * FROM operations WHERE idempotency_key=$1 FOR UPDATE", ["chat:" + key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "Chat key belongs to different input.", 409);
        if (previous.status === "completed") return previous.result;
        if (previous.status === "running" || !retry) throw new DomainError("CHAT_PENDING", "This turn is already recorded. Check its status before retrying.", 409, { operationId: previous.id, sessionId: previous.input.sessionId });
        const session = (await client.query("SELECT id FROM conversations WHERE id=$1 AND archived=false AND deleted_at IS NULL FOR UPDATE", [previous.input.sessionId])).rows[0];
        if (!session) throw new DomainError("NOT_FOUND", "Restore the conversation before retrying.", 409);
        await this.assertIdle(client, session.id);
        if (!previous.input.turn) throw new DomainError("LEGACY_TURN", "Start a new turn to retry this older conversation entry.", 409);
        const turn: ChatTurn = { ...previous.input.turn, token: randomUUID(), completed: false };
        await client.query("UPDATE operations SET status='running',error_code=NULL,input=input || $2::jsonb,updated_at=now() WHERE id=$1", [previous.id, JSON.stringify({ turn })]);
        await client.query("UPDATE messages SET content='',status='streaming',metadata='{}' WHERE id=$1", [turn.assistantId]);
        return turn;
      }
      if (!resolved || resolved.scopeOnly) throw new DomainError("EMPTY_TOPIC", "Folder selected. Add a topic or text.");
      const { folderId, content, rawContent, mode } = resolved;
      if (mode !== "save" && !content.trim()) throw new DomainError("EMPTY_TOPIC", "Enter a topic, question or source text.");
      const sessionId = validated.sessionId ?? randomUUID();
      if (validated.sessionId) {
        if (!(await client.query("SELECT id FROM conversations WHERE id=$1 AND archived=false AND deleted_at IS NULL FOR UPDATE", [sessionId])).rowCount) throw new DomainError("NOT_FOUND", "Conversation not found or archived.", 404);
        await this.assertIdle(client, sessionId);
      } else await client.query("INSERT INTO conversations(id,title,folder_id) VALUES($1,$2,$3)", [sessionId, content.trim().slice(0, 80) || "New conversation", folderId]);
      const operationId = randomUUID(), assistantId = randomUUID();
      const turn: ChatTurn = { sessionId, operationId, assistantId, folderId, content, rawContent, mode, token: randomUUID(), completed: false, noteId: validated.noteId, expectedVersion: validated.expectedVersion };
      await client.query("INSERT INTO operations(id,idempotency_key,request_hash,action,status,folder_id,input) VALUES($1,$2,$3,'chat','running',$4,$5)", [operationId, "chat:" + key, requestHash, folderId, JSON.stringify({ sessionId, content, mode, request, turn })]);
      await this.message(client, sessionId, randomUUID(), "user", rawContent, "completed", operationId);
      await this.message(client, sessionId, assistantId, "assistant", "", "streaming", operationId);
      await client.query("UPDATE conversations SET folder_id=$2,updated_at=now() WHERE id=$1", [sessionId, folderId]);
      return turn;
    });
  }
  private async assertIdle(client: PoolClient, sessionId: string) {
    if ((await client.query("SELECT 1 FROM operations WHERE action='chat' AND status='running' AND input->>'sessionId'=$1", [sessionId])).rowCount) throw new DomainError("CHAT_BUSY", "This conversation already has a running response.", 409);
  }
  async checkpoint(turn: ChatTurn, partial: string) {
    requireAccess();
    return transaction(this.pool, async (client) => {
      const result = await client.query("UPDATE operations SET updated_at=now() WHERE id=$1 AND status='running' AND input->'turn'->>'token'=$2 RETURNING id", [turn.operationId, turn.token]);
      if (!result.rowCount) return false;
      await client.query("UPDATE messages SET content=$2 WHERE id=$1 AND status='streaming'", [turn.assistantId, partial]); return true;
    });
  }
  async status(id: string) {
    requireAccess(); z.uuid().parse(id); await this.recover();
    const op = (await this.pool.query("SELECT id,status,error_code,result,input->>'sessionId' AS session_id,updated_at FROM operations WHERE id=$1 AND action='chat'", [id])).rows[0];
    if (!op) throw new DomainError("NOT_FOUND", "Chat operation not found.", 404);
    return op;
  }
  async cancel(id: string) {
    requireAccess(); z.uuid().parse(id);
    await transaction(this.pool, async (client) => {
      const changed = await client.query("UPDATE operations SET status='cancelled',error_code='AI_CANCELLED',updated_at=now() WHERE id=$1 AND action='chat' AND status='running' RETURNING id", [id]);
      if (changed.rowCount) await client.query("UPDATE messages SET status='cancelled' WHERE operation_id=$1 AND status='streaming'", [id]);
    }); return this.status(id);
  }
  async finish(turn: ChatTurn, reply: string, key: string, model: string, evidence: Evidence[] = [], proposal?: Record<string, unknown>, grounding?: { citations: { label: string; chunkId: string; quote: string }[]; [key: string]: unknown }) {
    requireAccess();
    return transaction(this.pool, async (client) => {
      const operation = (await client.query("SELECT status,result,input FROM operations WHERE id=$1 FOR UPDATE", [turn.operationId])).rows[0];
      if (operation?.status === "completed") return operation.result;
      if (operation?.status !== "running" || operation.input.turn.token !== turn.token) throw new DomainError("CHAT_NOT_RUNNING", "This turn cannot be completed. Check its status.", 409);
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      for (const source of [...evidence].sort((a, b) => a.id.localeCompare(b.id))) {
        const current = await client.query(`WITH RECURSIVE scope AS (SELECT id FROM folders WHERE id=$3 UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id)
          SELECT 1 FROM notes WHERE id=$1 AND current_version=$2 AND lifecycle='active' AND folder_id IN(SELECT id FROM scope) FOR SHARE`, [source.id, source.version, turn.folderId]);
        if (!current.rowCount) throw new DomainError("EVIDENCE_CHANGED", "A source changed during this response. Retry using the current notes.", 409);
        if (source.chunkId && !(await client.query("SELECT 1 FROM chunks WHERE id=$1 AND note_id=$2 AND note_version=$3", [source.chunkId, source.id, source.version])).rowCount) throw new DomainError("INVALID_CITATION", "The evidence passage does not match the cited version.", 409);
      }
      for (const citation of grounding?.citations ?? []) {
        if (!evidence.some((e) => e.chunkId === citation.chunkId && e.citationId === citation.label)) throw new DomainError("INVALID_CITATION", "Citation is outside the supplied evidence.", 409);
        await client.query("INSERT INTO message_citations(message_id,label,chunk_id,quote) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [turn.assistantId, citation.label, citation.chunkId, citation.quote]);
      }
      let receipt: Receipt | undefined;
      const service = new KnowledgeService(this.pool);
      if (turn.mode === "save" || turn.mode === "generate") {
        const body = turn.mode === "save" ? turn.content : reply;
        const current = turn.noteId && turn.mode === "save" ? await service.get(turn.noteId, true) : null;
        receipt = await service.executeInTransaction(client, {
          ...(turn.noteId && turn.mode === "save" ? { action: "edit" as const, noteId: turn.noteId, expectedVersion: turn.expectedVersion! } : { action: "create" as const, folderId: turn.folderId }),
          idempotencyKey: "chat-save:" + key, title: (current?.title ?? body.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 200) ?? turn.content.trim().slice(0, 100)) || "Untitled note", body,
          importance: current?.importance, metadata: { ...current?.metadata, conversationId: turn.sessionId, messageId: turn.assistantId },
          provenance: turn.mode === "save" ? "user_written" : "ai_generated", model: turn.mode === "save" ? undefined : model,
          sources: [{ body: turn.rawContent, origin: "user_written", metadata: { conversationId: turn.sessionId, messageId: turn.assistantId, evidence } }],
        });
      }
      const savedNote = receipt ? (await client.query("SELECT title FROM notes WHERE id=$1", [receipt.noteId])).rows[0] : null;
      const memory = receipt ? { saved: true, action: turn.noteId && turn.mode === "save" ? "EDIT" : "CREATE", filePath: receipt.path, noteId: receipt.noteId, operationId: receipt.operationId, version: receipt.version, title: savedNote.title, indexing: "pending" } : { saved: false, action: "QUERY" };
      const result = { ...turn, completed: true, reply, memory, evidence, proposal, grounding };
      await client.query("UPDATE messages SET content=$2,status='completed',model=$3,metadata=$4 WHERE id=$1", [turn.assistantId, reply, model, JSON.stringify({ memory, evidence, proposal, grounding, mode: turn.mode })]);
      await client.query("UPDATE operations SET status='completed',result=$2,updated_at=now() WHERE id=$1", [turn.operationId, JSON.stringify(result)]);
      await client.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [turn.sessionId]);
      return result;
    });
  }
  async fail(turn: ChatTurn, partial: string, cancelled: boolean) {
    requireAccess();
    await transaction(this.pool, async (client) => {
      const result = await client.query("UPDATE operations SET status=$3,error_code='AI_INCOMPLETE',updated_at=now() WHERE id=$1 AND status='running' AND input->'turn'->>'token'=$2 RETURNING id", [turn.operationId, turn.token, cancelled ? "cancelled" : "failed"]);
      if (result.rowCount) await client.query("UPDATE messages SET content=$2,status=$3 WHERE id=$1", [turn.assistantId, partial, cancelled ? "cancelled" : "failed"]);
    });
  }
  async saveAnswer(id: string, folderId: string) {
    requireAccess(); z.uuid().parse(id); z.guid().parse(folderId);
    return transaction(this.pool, async (client) => {
      const message = (await client.query("SELECT m.*,o.input FROM messages m JOIN operations o ON o.id=m.operation_id WHERE m.id=$1 AND m.role='assistant' AND m.status='completed' FOR UPDATE OF m", [id])).rows[0];
      if (!message || message.metadata.mode !== "ask") throw new DomainError("INVALID_ANSWER", "Only completed Ask answers can be saved.", 409);
      if (message.metadata.memory?.saved) return message.metadata.memory;
      const receipt = await new KnowledgeService(this.pool).executeInTransaction(client, { action: "create", idempotencyKey: "answer-save:" + id, folderId,
        title: message.content.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 200) || message.input.content.slice(0, 100), body: message.content, provenance: "ai_generated", model: message.model,
        metadata: { conversationId: message.conversation_id, messageId: id }, sources: [{ body: message.input.turn.rawContent, origin: "user_written", metadata: { conversationId: message.conversation_id, messageId: id, evidence: message.metadata.evidence } }] });
      const memory = { saved: true, action: "CREATE", filePath: receipt.path, noteId: receipt.noteId, operationId: receipt.operationId, version: receipt.version, indexing: "pending" };
      await client.query("UPDATE messages SET metadata=jsonb_set(metadata,'{memory}',$2::jsonb) WHERE id=$1", [id, JSON.stringify(memory)]);
      await client.query("UPDATE operations SET result=jsonb_set(result,'{memory}',$2::jsonb) WHERE id=$1", [message.operation_id, JSON.stringify(memory)]);
      return memory;
    });
  }
  private async message(client: PoolClient, conversation: string, id: string, role: string, content: string, status: string, operation: string) {
    await client.query("INSERT INTO messages(id,conversation_id,sequence,role,content,status,operation_id) SELECT $1,$2,coalesce(max(sequence),0)+1,$3,$4,$5,$6 FROM messages WHERE conversation_id=$2", [id, conversation, role, content, status, operation]);
  }
}
