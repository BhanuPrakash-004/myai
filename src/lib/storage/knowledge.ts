import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ROOT_FOLDER_ID, getStorage, transaction } from "./client";
import { DomainError, requireAccess } from "./access";
import { enqueueNoteIndexing } from "./jobs";

// PostgreSQL accepts the fixed root UUID (version 0) as well as generated v4 IDs.
const uuid = z.guid();
const version = z.number().int().positive();
const body = z.string().max(1_000_000);
const title = z.string().trim().min(1).max(200);
const origin = z.enum(["user_written", "imported", "ai_generated", "ai_improved", "migrated_unknown"]);
const source = z.object({ body, origin, attachmentId: uuid.optional(), metadata: z.record(z.string(), z.unknown()).default({}) });
const common = { idempotencyKey: z.string().min(8).max(200) };
const fields = { title, body, provenance: origin.default("user_written"), importance: z.number().int().min(1).max(5).default(3),
  sources: z.array(source).max(50).default([]), metadata: z.record(z.string(), z.unknown()).default({}), model: z.string().max(200).optional() };
const requestSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create"), ...fields, folderId: uuid.default(ROOT_FOLDER_ID), path: z.string().max(500).optional(), createdAt: z.iso.datetime().optional() }).strict(),
  z.object({ ...common, action: z.literal("edit"), noteId: uuid, expectedVersion: version, ...fields }).strict(),
  z.object({ ...common, action: z.literal("move"), noteId: uuid, expectedVersion: version, folderId: uuid, path: z.string().max(500).optional() }).strict(),
  z.object({ ...common, action: z.literal("lifecycle"), noteId: uuid, expectedVersion: version, lifecycle: z.enum(["active", "archived", "trashed"]) }).strict(),
  z.object({ ...common, action: z.literal("restore"), noteId: uuid, expectedVersion: version, targetVersion: version }).strict(),
  z.object({ ...common, action: z.literal("merge"), noteId: uuid, expectedVersion: version, title, body,
    sources: z.array(z.object({ noteId: uuid, expectedVersion: version })).min(1).max(20) }).strict(),
  z.object({ ...common, action: z.literal("undo"), operationId: uuid }).strict(),
]);
export type NoteRequest = z.input<typeof requestSchema>;
export interface Note {
  id: string; folder_id: string; title: string; body: string; content_hash: string; current_version: number;
  lifecycle: "active" | "archived" | "trashed"; provenance: z.infer<typeof origin>; review_state: string;
  importance: number; metadata: Record<string, unknown>; created_at: Date; updated_at: Date; path: string;
}
interface Change { noteId: string; version: number; previousVersion: number | null }
export interface Receipt { operationId: string; noteId: string; version: number; path: string; changes: Change[] }
export const folderPathsSql = `WITH RECURSIVE folder_paths AS (
  SELECT id,parent_id,name,slug,''::text AS path FROM folders WHERE parent_id IS NULL
  UNION ALL SELECT f.id,f.parent_id,f.name,f.slug,concat_ws('/',nullif(p.path,''),f.slug)
  FROM folders f JOIN folder_paths p ON p.id=f.parent_id
)`;
export const noteSelect = "SELECT n.*, coalesce(r.path,n.id::text || '.md') AS path FROM notes n LEFT JOIN note_routes r ON r.note_id=n.id";
export function slug(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)
    || "topic-" + hash(value).slice(0, 10);
}
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}";
  return JSON.stringify(value);
}
export function safePath(value: string) {
  const p = value.normalize("NFC").replaceAll("\\", "/");
  if (!p || p.length > 500 || !p.endsWith(".md") || /[\u0000-\u001f<>:"|?*]/.test(p) || p.split("/").some((s) => !s || s === "." || s === "..")) {
    throw new DomainError("INVALID_PATH", "Use a relative Markdown path without traversal or reserved characters.");
  }
  return p;
}
export class KnowledgeService {
  constructor(public readonly pool: Pool) {}

  async get(idOrPath: string, includeInactive = false): Promise<Note | null> {
    requireAccess();
    const isId = uuid.safeParse(idOrPath).success;
    const result = await this.pool.query<Note>(noteSelect + (isId ? " WHERE n.id=$1" : " WHERE n.id IN (SELECT note_id FROM note_routes WHERE lower(path)=lower($1) UNION SELECT note_id FROM note_aliases WHERE lower(path)=lower($1))") + " LIMIT 1", [idOrPath]);
    let note = result.rows[0];
    if (note?.metadata.mergedInto && typeof note.metadata.mergedInto === "string" && !includeInactive) {
      const target = await this.pool.query<Note>(noteSelect + " WHERE n.id=$1 AND n.lifecycle='active'", [note.metadata.mergedInto]);
      note = target.rows[0];
    }
    return note && (includeInactive || note.lifecycle === "active") ? note : null;
  }

  async list(options: { limit?: number; offset?: number; lifecycle?: Note["lifecycle"]; important?: boolean; folderId?: string; descendants?: boolean } = {}) {
    requireAccess();
    const input = z.object({ limit: z.number().int().min(1).max(10001).default(100), offset: z.number().int().min(0).default(0),
      lifecycle: z.enum(["active", "archived", "trashed"]).default("active"), important: z.boolean().default(false), folderId: uuid.optional(), descendants: z.boolean().default(true) }).parse(options);
    const scope = input.folderId ? (await this.folderIds(input.folderId, input.descendants)) : null;
    return (await this.pool.query<Note>(noteSelect + " WHERE n.lifecycle=$1 AND (NOT $2 OR n.importance>=4) AND ($3::uuid[] IS NULL OR n.folder_id=ANY($3)) ORDER BY n.updated_at DESC,n.id LIMIT $4 OFFSET $5",
      [input.lifecycle, input.important, scope, input.limit, input.offset])).rows;
  }

  async search(query: string, options: { limit?: number; folderId?: string; descendants?: boolean } = {}) {
    requireAccess();
    const { RetrievalService } = await import("../retrieval/service");
    return new RetrievalService(this.pool).notes(query, options);
  }

  async folders() {
    requireAccess();
    return (await this.pool.query<{ id: string; parent_id: string | null; name: string; slug: string; path: string; sort_order: number; aliases: string[] }>(folderPathsSql + ` SELECT p.*,f.sort_order,
      ARRAY(SELECT path FROM folder_aliases a WHERE a.folder_id=p.id ORDER BY path) AS aliases
      FROM folder_paths p JOIN folders f USING(id) ORDER BY f.sort_order,p.path`)).rows;
  }
  async folderIds(id: string, descendants = true) {
    requireAccess();
    uuid.parse(id);
    if (!descendants) return [id];
    return (await this.pool.query<{ id: string }>("WITH RECURSIVE scope AS (SELECT id FROM folders WHERE id=$1 UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id) SELECT id FROM scope", [id])).rows.map((r) => r.id);
  }
  async resolveFolder(pathOrId: string) {
    requireAccess();
    if (uuid.safeParse(pathOrId).success) return (await this.pool.query<{ id: string }>("SELECT id FROM folders WHERE id=$1", [pathOrId])).rows[0]?.id ?? null;
    const p = pathOrId.replace(/^\/+|\/+$/g, "").toLowerCase();
    const result = await this.pool.query<{ id: string }>(folderPathsSql + " SELECT id FROM folder_paths WHERE path=$1 UNION SELECT folder_id AS id FROM folder_aliases WHERE path=$1", [p]);
    if (result.rows.length > 1) throw new DomainError("AMBIGUOUS_FOLDER", "Select a folder by its ID.", 409);
    return result.rows[0]?.id ?? null;
  }
  async createFolder(input: { name: string; parentId?: string }) {
    requireAccess();
    const name = title.parse(input.name);
    const parentId = uuid.parse(input.parentId ?? ROOT_FOLDER_ID);
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      const parent = (await client.query(folderPathsSql + " SELECT path FROM folder_paths WHERE id=$1", [parentId])).rows[0];
      if (!parent) throw new DomainError("NOT_FOUND", "Parent folder not found.", 404);
      const path = [parent.path, slug(name)].filter(Boolean).join("/");
      if ((await client.query("SELECT 1 FROM folder_aliases WHERE path=$1", [path])).rowCount) throw new DomainError("PATH_TAKEN", "This folder path is reserved by an alias.", 409);
      return (await client.query("INSERT INTO folders(parent_id,name,slug) VALUES($1,$2,$3) RETURNING *", [parentId, name, slug(name)])).rows[0];
    });
  }
  async ensureFolderPath(path: string, client: PoolClient) {
    requireAccess();
    await client.query("SELECT pg_advisory_xact_lock(71202001)");
    let parent = ROOT_FOLDER_ID;
    for (const name of path.split("/").filter(Boolean)) {
      title.parse(name);
      const p = (await client.query(folderPathsSql + " SELECT path FROM folder_paths WHERE id=$1", [parent])).rows[0].path;
      const proposedPath = [p, slug(name)].filter(Boolean).join("/");
      const alias = (await client.query("SELECT folder_id FROM folder_aliases WHERE path=$1", [proposedPath])).rows[0];
      if (alias) { parent = alias.folder_id; continue; }
      parent = (await client.query("INSERT INTO folders(parent_id,name,slug) VALUES($1,$2,$3) ON CONFLICT(parent_id,slug) DO UPDATE SET name=folders.name RETURNING id", [parent, name, slug(name)])).rows[0].id;
    }
    return parent;
  }
  async moveFolder(input: { id: string; parentId: string; name: string; sortOrder?: number; aliases?: string[] }) {
    requireAccess();
    const id = uuid.parse(input.id), parent = uuid.parse(input.parentId), name = title.parse(input.name);
    if (id === ROOT_FOLDER_ID) throw new DomainError("ROOT_FOLDER", "The root folder cannot be moved or renamed.");
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      const old = (await client.query<{ id: string; path: string }>(folderPathsSql + " SELECT id,path FROM folder_paths")).rows;
      if (!old.some((f) => f.id === id)) throw new DomainError("NOT_FOUND", "Folder not found.", 404);
      if (!old.some((f) => f.id === parent)) throw new DomainError("NOT_FOUND", "Parent folder not found.", 404);
      const descendants = await client.query("WITH RECURSIVE scope AS (SELECT id FROM folders WHERE id=$1 UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id) SELECT 1 FROM scope WHERE id=$2", [id, parent]);
      if (descendants.rowCount) throw new DomainError("FOLDER_CYCLE", "A folder cannot be moved inside itself or a descendant.", 409);
      await client.query("UPDATE folders SET parent_id=$2,name=$3,slug=$4,updated_at=now() WHERE id=$1", [id, parent, name, slug(name)]);
      await client.query("UPDATE graph_nodes SET label=$2 WHERE kind='topic' AND scope_folder_id=$1", [id, name]);
      const current = (await client.query<{ id: string; path: string }>(folderPathsSql + " SELECT id,path FROM folder_paths")).rows;
      for (const folder of current) {
        const previous = old.find((f) => f.id === folder.id)!;
        if (previous.path === folder.path) continue;
        const reserved = await client.query("SELECT 1 FROM folder_aliases WHERE path=$1 AND folder_id<>$2", [folder.path, folder.id]);
        if (reserved.rowCount) throw new DomainError("PATH_TAKEN", "A folder alias reserves this destination.", 409);
        await client.query("INSERT INTO folder_aliases(path,folder_id) VALUES($1,$2) ON CONFLICT(path) DO NOTHING", [previous.path, folder.id]);
        const notes = (await client.query<Note>(noteSelect + " WHERE n.folder_id=$1 ORDER BY n.id FOR UPDATE OF n", [folder.id])).rows;
        for (const note of notes) {
          await this.setPath(client, note.id, folder.path + "/" + note.path.split("/").pop());
          if (note.lifecycle === "active") {
            await client.query("UPDATE processing_state SET status='pending',run_token=NULL,attempts=0,error_code='FOLDER_CHANGED',updated_at=now() WHERE note_id=$1 AND note_version=$2 AND stage='chunks'", [note.id, note.current_version]);
            await enqueueNoteIndexing(client, note.id, note.current_version);
          }
        }
      }
      if (input.sortOrder !== undefined) await client.query("UPDATE folders SET sort_order=$2 WHERE id=$1", [id, z.number().int().min(-100000).max(100000).parse(input.sortOrder)]);
      for (const raw of input.aliases ?? []) {
        const alias = z.string().min(1).max(500).regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/).parse(raw);
        if (current.some((f) => f.path === alias && f.id !== id) || (await client.query("SELECT 1 FROM folder_aliases WHERE path=$1 AND folder_id<>$2", [alias, id])).rowCount)
          throw new DomainError("ALIAS_TAKEN", "An alias already belongs to another folder.", 409);
        await client.query("INSERT INTO folder_aliases(path,folder_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [alias, id]);
      }
      return current.find((f) => f.id === id);
    });
  }
  async deleteFolder(id: string) {
    requireAccess(); uuid.parse(id);
    if (id === ROOT_FOLDER_ID) throw new DomainError("ROOT_FOLDER", "The root folder cannot be deleted.");
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202001)");
      if (!(await client.query("SELECT 1 FROM folders WHERE id=$1 FOR UPDATE", [id])).rowCount) throw new DomainError("NOT_FOUND", "Folder not found.", 404);
      if ((await client.query("SELECT 1 FROM folders WHERE parent_id=$1 UNION ALL SELECT 1 FROM notes WHERE folder_id=$1 UNION ALL SELECT 1 FROM note_versions WHERE metadata->>'folderId'=$1::text LIMIT 1", [id])).rowCount)
        throw new DomainError("FOLDER_NOT_EMPTY", "Move notes and subfolders first. Folders referenced by note history are retained for undo.", 409);
      await client.query("DELETE FROM folders WHERE id=$1", [id]);
    });
  }
  async detail(noteId: string) {
    requireAccess(); uuid.parse(noteId);
    return transaction(this.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const note = (await client.query<Note>(noteSelect + " WHERE n.id=$1", [noteId])).rows[0];
      if (!note) throw new DomainError("NOT_FOUND", "Note not found.", 404);
      const history = (await client.query("SELECT * FROM note_versions WHERE note_id=$1 ORDER BY version DESC", [noteId])).rows;
      const sources = (await client.query("SELECT s.* FROM sources s JOIN note_sources ns ON ns.source_id=s.id WHERE ns.note_id=$1 AND ns.version=$2 ORDER BY s.created_at,s.id", [noteId, note.current_version])).rows;
      const processing = (await client.query("SELECT stage,status,error_code FROM processing_state WHERE note_id=$1 AND note_version=$2 ORDER BY stage", [noteId, note.current_version])).rows;
      return { note, history, sources, processing };
    });
  }
  async history(noteId: string) {
    requireAccess(); uuid.parse(noteId);
    return (await this.pool.query("SELECT * FROM note_versions WHERE note_id=$1 ORDER BY version DESC", [noteId])).rows;
  }
  async execute(input: NoteRequest) {
    requireAccess();
    return transaction(this.pool, (client) => this.executeInTransaction(client, input));
  }
  async executeInTransaction(client: PoolClient, raw: NoteRequest): Promise<Receipt> {
    requireAccess();
    const input = requestSchema.parse(raw);
    const requestHash = hash(stable(input));
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["operation:" + input.idempotencyKey]);
    const previous = (await client.query("SELECT * FROM operations WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This operation key was used for a different request.", 409);
      if (previous.status !== "completed") throw new DomainError("OPERATION_PENDING", "This operation is not complete.", 409);
      return previous.result as Receipt;
    }
    // Consistent lock order with folder moves and imports avoids structural deadlocks.
    await client.query("SELECT pg_advisory_xact_lock(71202001)");
    const operationId = randomUUID();
    await client.query("INSERT INTO operations(id,idempotency_key,request_hash,action,status,input) VALUES($1,$2,$3,$4,'running',$5)",
      [operationId, input.idempotencyKey, requestHash, input.action, JSON.stringify(input)]);
    const changes: Change[] = [];
    let main: Note;
    if (input.action === "create") {
      const id = randomUUID();
      const folder = await this.folderPath(client, input.folderId);
      const destination = safePath(input.path ?? [folder, slug(input.title) + "-" + id.slice(0, 8) + ".md"].filter(Boolean).join("/"));
      const result = await client.query<Note>("INSERT INTO notes(id,folder_id,title,body,provenance,importance,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now())) RETURNING *",
        [id, input.folderId, input.title, input.body, input.provenance, input.importance, JSON.stringify(input.metadata), input.createdAt]);
      main = { ...result.rows[0], path: destination };
      await this.setPath(client, id, destination);
      await this.snapshot(client, main, operationId, "create", input.model);
      await this.linkSources(client, main, input.sources.length ? input.sources : [{ body: input.body, origin: input.provenance, metadata: {} }]);
      changes.push({ noteId: id, version: 1, previousVersion: null });
    } else if (input.action === "undo") {
      const op = (await client.query("SELECT result FROM operations WHERE id=$1 AND status='completed'", [input.operationId])).rows[0];
      if (!op?.result?.changes?.length) throw new DomainError("UNDO_UNAVAILABLE", "Operation cannot be undone.", 404);
      const original = op.result as Receipt;
      const locked = await this.lockNotes(client, original.changes.map((c) => ({ noteId: c.noteId, expectedVersion: c.version })));
      for (const change of original.changes) {
        const note = locked.get(change.noteId)!;
        let next = { ...note, lifecycle: "trashed" as Note["lifecycle"] };
        let restoreVersion = note.current_version;
        if (change.previousVersion) {
          const snapshot = (await client.query("SELECT * FROM note_versions WHERE note_id=$1 AND version=$2", [note.id, change.previousVersion])).rows[0];
          const meta = snapshot.metadata;
          restoreVersion = change.previousVersion;
          next = { ...note, title: snapshot.title, body: snapshot.body, provenance: snapshot.provenance,
            folder_id: meta.folderId ?? note.folder_id,
            path: [await this.folderPath(client, meta.folderId ?? note.folder_id), (meta.path ?? note.path).split("/").pop()].filter(Boolean).join("/"),
            lifecycle: meta.lifecycle ?? "active", importance: meta.importance ?? note.importance, metadata: meta.noteMetadata ?? {} };
        }
        const restored = await this.revise(client, note, next, operationId, "undo", restoreVersion);
        changes.push({ noteId: note.id, version: restored.current_version, previousVersion: note.current_version });
      }
      main = (await client.query<Note>(noteSelect + " WHERE n.id=$1", [original.noteId])).rows[0];
    } else {
      const targets = [{ noteId: input.noteId, expectedVersion: input.expectedVersion }, ...(input.action === "merge" ? input.sources : [])];
      if (new Set(targets.map((t) => t.noteId)).size !== targets.length) throw new DomainError("INVALID_MERGE", "Merge notes must be distinct.");
      const locked = await this.lockNotes(client, targets);
      const note = locked.get(input.noteId)!;
      if (note.lifecycle === "trashed" && input.action !== "lifecycle") throw new DomainError("TRASHED_NOTE", "Restore this note before editing.", 409);
      let next = { ...note };
      if (input.action === "edit") next = { ...next, title: input.title, body: input.body, provenance: input.provenance, importance: input.importance, metadata: input.metadata };
      if (input.action === "move") {
        const folder = await this.folderPath(client, input.folderId);
        next = { ...next, folder_id: input.folderId, path: input.path ?? [folder, note.path.split("/").pop()].filter(Boolean).join("/") };
      }
      if (input.action === "lifecycle") next.lifecycle = input.lifecycle;
      if (input.action === "restore") {
        const snapshot = (await client.query("SELECT title,body,provenance FROM note_versions WHERE note_id=$1 AND version=$2", [note.id, input.targetVersion])).rows[0];
        if (!snapshot) throw new DomainError("NOT_FOUND", "Historical version not found.", 404);
        next = { ...next, ...snapshot, metadata: { ...note.metadata, restoredFromVersion: input.targetVersion } };
      }
      if (input.action === "merge") next = { ...next, title: input.title, body: input.body };
      main = await this.revise(client, note, next, operationId, input.action, input.action === "restore" ? input.targetVersion : note.current_version, input.action === "edit" ? input.model : undefined);
      if (input.action === "edit") await this.linkSources(client, main, input.sources.length ? input.sources : [{ body: input.body, origin: input.provenance, metadata: {} }]);
      if (input.action === "merge") {
        for (const target of input.sources) {
          const original = locked.get(target.noteId)!;
          if (original.lifecycle !== "active" || note.lifecycle !== "active") throw new DomainError("INVALID_MERGE", "Only active notes may be merged.", 409);
          await client.query("INSERT INTO note_sources(note_id,version,source_id) SELECT $1,$2,source_id FROM note_sources WHERE note_id=$3 AND version=$4 ON CONFLICT DO NOTHING", [main.id, main.current_version, original.id, original.current_version]);
          const archived = await this.revise(client, original, { ...original, lifecycle: "archived", metadata: { ...original.metadata, mergedInto: main.id } }, operationId, "merged into " + main.id);
          changes.push({ noteId: archived.id, version: archived.current_version, previousVersion: original.current_version });
        }
      }
      changes.unshift({ noteId: main.id, version: main.current_version, previousVersion: note.current_version });
    }
    const receipt: Receipt = { operationId, noteId: main.id, version: main.current_version, path: main.path, changes };
    await client.query("UPDATE operations SET status='completed',note_id=$2,folder_id=$3,result=$4,updated_at=now() WHERE id=$1", [operationId, main.id, main.folder_id, JSON.stringify(receipt)]);
    return receipt;
  }
  private async lockNotes(client: PoolClient, targets: { noteId: string; expectedVersion: number }[]) {
    const locked = new Map<string, Note>();
    for (const target of [...targets].sort((a, b) => a.noteId.localeCompare(b.noteId))) {
      const note = (await client.query<Note>(noteSelect + " WHERE n.id=$1 FOR UPDATE OF n", [target.noteId])).rows[0];
      if (!note) throw new DomainError("NOT_FOUND", "Note not found.", 404);
      if (note.current_version !== target.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This note changed. Review the current version before saving.", 409, { noteId: note.id, currentVersion: note.current_version, currentBody: note.body });
      locked.set(note.id, note);
    }
    return locked;
  }
  private async folderPath(client: PoolClient, folderId: string) {
    const folder = (await client.query(folderPathsSql + " SELECT path FROM folder_paths WHERE id=$1", [folderId])).rows[0];
    if (!folder) throw new DomainError("NOT_FOUND", "Folder not found.", 404);
    return folder.path as string;
  }
  private async setPath(client: PoolClient, noteId: string, raw: string) {
    const path = safePath(raw);
    const taken = await client.query("SELECT 1 FROM note_routes WHERE lower(path)=lower($1) AND note_id<>$2 UNION SELECT 1 FROM note_aliases WHERE lower(path)=lower($1) AND note_id<>$2", [path, noteId]);
    if (taken.rowCount) throw new DomainError("PATH_TAKEN", "This path already belongs to another note. Choose a new path or explicitly merge.", 409);
    await client.query("INSERT INTO note_aliases(path,note_id) SELECT path,note_id FROM note_routes WHERE note_id=$1 ON CONFLICT(path) DO NOTHING", [noteId]);
    await client.query("INSERT INTO note_routes(note_id,path) VALUES($1,$2) ON CONFLICT(note_id) DO UPDATE SET path=excluded.path", [noteId, path]);
  }
  private async snapshot(client: PoolClient, note: Note, operationId: string, reason: string, model?: string) {
    await client.query("INSERT INTO note_versions(note_id,version,title,body,provenance,reason,operation_id,model,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [note.id, note.current_version, note.title, note.body, note.provenance, reason, operationId, model,
        JSON.stringify({ folderId: note.folder_id, path: note.path, lifecycle: note.lifecycle, importance: note.importance, noteMetadata: note.metadata })]);
    if (note.lifecycle === "active") await enqueueNoteIndexing(client, note.id, note.current_version);
  }
  private async revise(client: PoolClient, old: Note, next: Note, operationId: string, reason: string, sourceVersion = old.current_version, model?: string) {
    await this.setPath(client, old.id, next.path);
    const row = (await client.query<Note>("UPDATE notes SET title=$2,body=$3,provenance=$4,importance=$5,folder_id=$6,lifecycle=$7::lifecycle,metadata=$8,current_version=current_version+1,trashed_at=CASE WHEN $7::lifecycle='trashed' THEN now() ELSE NULL END WHERE id=$1 RETURNING *",
      [old.id, next.title, next.body, next.provenance, next.importance, next.folder_id, next.lifecycle, JSON.stringify(next.metadata)])).rows[0];
    const result = { ...row, path: next.path };
    await this.snapshot(client, result, operationId, reason, model);
    await client.query("INSERT INTO note_sources(note_id,version,source_id) SELECT note_id,$2,source_id FROM note_sources WHERE note_id=$1 AND version=$3 ON CONFLICT DO NOTHING", [old.id, result.current_version, sourceVersion]);
    await client.query("UPDATE graph_nodes SET scope_folder_id=$2,label=$3 WHERE note_id=$1", [old.id, next.folder_id, next.title]);
    return result;
  }
  private async linkSources(client: PoolClient, note: Note, inputs: z.infer<typeof source>[]) {
    for (const item of inputs) {
      if (item.attachmentId && !(await client.query("SELECT 1 FROM attachments WHERE id=$1 AND state='ready'", [item.attachmentId])).rowCount) throw new DomainError("ATTACHMENT_NOT_READY", "Attachment must be finalized before saving.", 409);
      const sourceId = randomUUID();
      await client.query("INSERT INTO sources(id,origin,body,attachment_id,metadata) VALUES($1,$2,$3,$4,$5)", [sourceId, item.origin, item.body, item.attachmentId, JSON.stringify(item.metadata)]);
      await client.query("INSERT INTO note_sources(note_id,version,source_id) VALUES($1,$2,$3)", [note.id, note.current_version, sourceId]);
    }
  }
}
export function knowledge() { return new KnowledgeService(getStorage().pool); }

/** Presentation compatibility only: this does not read or write the removed legacy stores. */
export function presentNote(note: Note) {
  const parts = note.path.split("/");
  return { ...note, file_path: note.path, content: note.body, content_preview: note.body.slice(0, 300), version: note.current_version,
    topic: parts.length > 1 ? parts[0] : "Knowledge", subcategory: parts.slice(1, -1).join("/"), knowledge_type: "general" as const,
    status: note.lifecycle === "active" ? "confirmed" : "archived", user_id: "owner", query_count: 0,
    quiz_correct_count: 0, quiz_incorrect_count: 0, forgetting_score: 0, last_accessed_at: null };
}
