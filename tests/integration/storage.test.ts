import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import Database from "better-sqlite3";
import { createStorage, ROOT_FOLDER_ID, transaction } from "../../src/lib/storage/client";
import { folders } from "../../src/lib/storage/schema";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { enqueueNoteIndexing, lockCurrentNote } from "../../src/lib/storage/jobs";
import { inventoryLegacy, importLegacy, sha256 } from "../../src/lib/storage/legacy";
import { asMaintenance } from "../../src/lib/storage/access";
import { KnowledgeService } from "../../src/lib/storage/knowledge";

const testUrl = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!testUrl.pathname.startsWith("/myai_test")) throw new Error("Integration tests require a dedicated myai_test database");
const admin = new Pool({ connectionString: testUrl.toString(), connectionTimeoutMillis: 5000 });
const allocated: { name: string; storage: ReturnType<typeof createStorage> }[] = [];
let storage: ReturnType<typeof createStorage>;
let pool: Pool;
let scratch: string;

async function freshDatabase() {
  const name = "myai_test_" + randomUUID().replaceAll("-", "");
  assert.match(name, /^myai_test_[a-f0-9]{32}$/);
  await admin.query('CREATE DATABASE "' + name + '"');
  const url = new URL(testUrl);
  url.pathname = "/" + name;
  const created = createStorage({ DATABASE_URL: url.toString() });
  allocated.push({ name, storage: created });
  return created;
}
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "myai-postgres-"));
  storage = await freshDatabase();
  pool = storage.pool;
  await migrateDatabase(pool);
});
after(async () => {
  for (const item of allocated) {
    await item.storage.close();
    assert.match(item.name, /^myai_test_[a-f0-9]{32}$/);
    await admin.query('DROP DATABASE "' + item.name + '" WITH (FORCE)');
  }
  await admin.end();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function insertNote(client: PoolClient, body = "Classes encapsulate state.", noteId = randomUUID()) {
  await client.query("INSERT INTO notes (id, folder_id, title, body, provenance) VALUES ($1, $2, 'Classes', $3, 'user_written')", [noteId, ROOT_FOLDER_ID, body]);
  await client.query("INSERT INTO note_versions (note_id, version, title, body, provenance, reason) VALUES ($1, 1, 'Classes', $2, 'user_written', 'Test source')", [noteId, body]);
  return noteId;
}
async function editNote(client: PoolClient, noteId: string, expectedVersion: number, body: string) {
  const edited = await client.query(
    "UPDATE notes SET body = $3, current_version = current_version + 1 WHERE id = $1 AND current_version = $2 RETURNING current_version",
    [noteId, expectedVersion, body],
  );
  if (!edited.rowCount) throw new Error("Version conflict");
  await client.query("INSERT INTO note_versions (note_id, version, title, body, provenance, reason) VALUES ($1, $2, 'Classes', $3, 'user_written', 'Edited')", [noteId, expectedVersion + 1, body]);
}
async function count(table: string, clause = "", args: unknown[] = []) {
  const allowed = ["notes", "note_versions", "sources", "operations", "processing_state", "graphile_worker.jobs", "current_chunks", "current_embeddings", "current_graph_edges", "graph_edges", "import_items"];
  assert.ok(allowed.includes(table));
  return Number((await pool.query("SELECT count(*) AS n FROM " + table + (clause ? " WHERE " + clause : ""), args)).rows[0].n);
}

test("fresh install, Drizzle queries, vector extension and migration rerun", async () => {
  assert.deepEqual(await migrateDatabase(pool), []);
  assert.equal((await storage.db.select().from(folders)).length, 1);
  assert.equal((await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).rows[0].extversion, "0.8.2");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM myai_migrations")).rows[0].n, 11);
});

test("upgrade from the first migration preserves existing source data", async () => {
  const previous = await freshDatabase();
  await migrateDatabase(previous.pool, { through: "0000_foundation.sql" });
  const row = await previous.pool.query("INSERT INTO sources (origin, body) VALUES ('user_written', 'Preserve this upgrade source') RETURNING id");
  assert.deepEqual(await migrateDatabase(previous.pool), ["0001_integrity_and_freshness.sql", "0002_hesitant_lethal_legion.sql", "0003_canonical_guards.sql", "0004_ai_runtime.sql", "0005_chat_lifecycle.sql", "0006_retrieval_graph.sql", "0007_retrieval_indexes.sql", "0008_projection_cache.sql", "0009_practice.sql", "0010_attachment_purge.sql"]);
  assert.equal((await previous.pool.query("SELECT body FROM sources WHERE id=$1", [row.rows[0].id])).rows[0].body, "Preserve this upgrade source");
});

test("modified applied migrations fail instead of silently accepting schema drift", async () => {
  const copy = path.join(scratch, "migrations");
  await cp(path.resolve("migrations"), copy, { recursive: true });
  const file = path.join(copy, "0000_foundation.sql");
  await writeFile(file, (await readFile(file, "utf8")) + "\n-- changed\n");
  await assert.rejects(migrateDatabase(pool, { directory: copy }), /modified/);
});

test("nested topics support Java/syntax and reject collisions and cycles", async () => {
  const java = (await pool.query("INSERT INTO folders (parent_id,name,slug) VALUES ($1,'Java','java') RETURNING id", [ROOT_FOLDER_ID])).rows[0].id;
  const syntax = (await pool.query("INSERT INTO folders (parent_id,name,slug) VALUES ($1,'Syntax','syntax') RETURNING id", [java])).rows[0].id;
  await assert.rejects(pool.query("INSERT INTO folders (parent_id,name,slug) VALUES ($1,'Other Java','java')", [ROOT_FOLDER_ID]), /unique/);
  await assert.rejects(pool.query("UPDATE folders SET parent_id=$1 WHERE id=$2", [syntax, java]), /cycle/);
  await assert.rejects(pool.query("DELETE FROM folders WHERE id=$1", [ROOT_FOLDER_ID]), /root/);
  await assert.rejects(pool.query("INSERT INTO folders (parent_id,name,slug) VALUES ($1,'Unsafe','../x')", [ROOT_FOLDER_ID]), /folder_shape/);
});

test("single owner is enforced even when the UI is bypassed", async () => {
  await pool.query("INSERT INTO auth_users (name,email) VALUES ('Owner','owner@example.test')");
  await assert.rejects(pool.query("INSERT INTO auth_users (name,email) VALUES ('Second','second@example.test')"), /unique/);
  await assert.rejects(pool.query("INSERT INTO auth_users (name,email,owner_slot) VALUES ('Bypass','bypass@example.test',false)"), /owner_slot_true/);
});

test("canonical note, source, operation and job commit atomically and rollback together", async () => {
  const beforeJobs = await count("graphile_worker.jobs");
  const noteId = randomUUID();
  await assert.rejects(transaction(pool, async (client) => {
    await insertNote(client, "Atomic note", noteId);
    await client.query("INSERT INTO sources (origin,body) VALUES ('user_written','Atomic source')");
    await client.query("INSERT INTO operations (idempotency_key,request_hash,action,input) VALUES ($1,'hash','create','{}')", [noteId]);
    await enqueueNoteIndexing(client, noteId, 1);
    throw new Error("Crash before commit");
  }), /Crash/);
  assert.equal(await count("notes", "id=$1", [noteId]), 0);
  assert.equal(await count("sources", "body='Atomic source'"), 0);
  assert.equal(await count("operations", "idempotency_key=$1", [noteId]), 0);
  assert.equal(await count("graphile_worker.jobs"), beforeJobs);
  await transaction(pool, async (client) => {
    await insertNote(client, "Atomic note", noteId);
    await enqueueNoteIndexing(client, noteId, 1);
    await enqueueNoteIndexing(client, noteId, 1);
  });
  assert.equal(await count("graphile_worker.jobs"), beforeJobs + 1);
  assert.equal(await count("processing_state", "note_id=$1", [noteId]), 3);
});

test("notes cannot commit without matching immutable snapshots", async () => {
  await assert.rejects(pool.query("INSERT INTO notes (folder_id,title,body,provenance) VALUES ($1,'Orphan','Bad','user_written')", [ROOT_FOLDER_ID]), /notes_current_version_fk|snapshot/);
  const noteId = await transaction(pool, (client) => insertNote(client));
  await assert.rejects(pool.query("UPDATE notes SET body='Unversioned edit' WHERE id=$1", [noteId]), /next note version/);
  await assert.rejects(pool.query("UPDATE note_versions SET body='Rewrite history' WHERE note_id=$1", [noteId]), /immutable/);
  await assert.rejects(transaction(pool, async (client) => {
    await client.query("UPDATE notes SET body='New body',current_version=2 WHERE id=$1", [noteId]);
    await client.query("INSERT INTO note_versions (note_id,version,title,body,provenance,reason) VALUES ($1,2,'Classes','Different body','user_written','Bad')", [noteId]);
  }), /snapshot/);
});

test("competing edits yield one accepted version and one conflict", async () => {
  const noteId = await transaction(pool, (client) => insertNote(client));
  const results = await Promise.allSettled([
    transaction(pool, (client) => editNote(client, noteId, 1, "First edit")),
    transaction(pool, (client) => editNote(client, noteId, 1, "Second edit")),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await count("note_versions", "note_id=$1", [noteId]), 2);
});

test("exact evidence, active embeddings and curated graph history follow note versions", async () => {
  const text = "🧠 Classes encapsulate state.";
  const noteId = await transaction(pool, (client) => insertNote(client, text));
  const chunkId = (await pool.query("INSERT INTO chunks (note_id,note_version,ordinal,body,start_offset,end_offset,chunker_version) VALUES ($1,1,0,$2,0,$3,'v1') RETURNING id", [noteId, text, Array.from(text).length])).rows[0].id;
  const profileId = (await pool.query("INSERT INTO embedding_profiles (model,dimensions,chunker_version,active) VALUES ('fixture/embedding',1536,'v1',true) RETURNING id")).rows[0].id;
  const values = "[" + [1, ...Array(1535).fill(0)].join(",") + "]";
  await pool.query("INSERT INTO chunk_embeddings (chunk_id,profile_id,embedding) VALUES ($1,$2,$3)", [chunkId, profileId, values]);
  const from = (await pool.query("INSERT INTO graph_nodes (kind,label,identity_key,scope_folder_id,note_id,origin) VALUES ('note','Classes',$1,$2,$3,'deterministic') RETURNING id", [noteId, ROOT_FOLDER_ID, noteId])).rows[0].id;
  const to = (await pool.query("INSERT INTO graph_nodes (kind,label,identity_key,scope_folder_id,origin) VALUES ('concept','State','state',$1,'owner_curated') RETURNING id", [ROOT_FOLDER_ID])).rows[0].id;
  const edgeId = (await pool.query("INSERT INTO graph_edges (from_node_id,to_node_id,relation,origin) VALUES ($1,$2,'explains','owner_curated') RETURNING id", [from, to])).rows[0].id;
  await assert.rejects(pool.query("INSERT INTO graph_evidence (edge_id,chunk_id,start_offset,end_offset,quote) VALUES ($1,$2,0,4,'fake')", [edgeId, chunkId]), /exact stored chunk/);
  await pool.query("INSERT INTO graph_evidence (edge_id,chunk_id,start_offset,end_offset,quote) VALUES ($1,$2,0,$3,$4)", [edgeId, chunkId, Array.from(text).length, text]);
  assert.equal(await count("current_chunks", "id=$1", [chunkId]), 1);
  assert.equal(await count("current_embeddings", "chunk_id=$1", [chunkId]), 1);
  assert.equal(await count("current_graph_edges", "id=$1", [edgeId]), 1);
  await transaction(pool, async (client) => {
    await enqueueNoteIndexing(client, noteId, 1);
    await editNote(client, noteId, 1, "Updated current detail: Map.Entry");
  });
  assert.equal(await count("current_chunks", "id=$1", [chunkId]), 0);
  assert.equal(await count("current_embeddings", "chunk_id=$1", [chunkId]), 0);
  assert.equal(await count("current_graph_edges", "id=$1", [edgeId]), 0);
  assert.equal(await count("graph_edges", "id=$1", [edgeId]), 1);
  assert.equal(await count("processing_state", "note_id=$1 AND status='stale'", [noteId]), 3);
  assert.equal(await transaction(pool, (client) => lockCurrentNote(client, noteId, 1)), false);
  assert.equal(await transaction(pool, (client) => lockCurrentNote(client, noteId, 2)), true);
  assert.equal((await pool.query("SELECT id FROM notes WHERE id=$1 AND search_vector @@ plainto_tsquery('simple','Map.Entry')", [noteId])).rowCount, 1);
  const current = (await pool.query("SELECT current_version FROM notes WHERE id=$1", [noteId])).rows[0].current_version;
  await asMaintenance(() => new KnowledgeService(pool).execute({ action: "lifecycle", noteId, expectedVersion: current, lifecycle: "trashed", idempotencyKey: randomUUID() }));
  assert.equal(await transaction(pool, (client) => lockCurrentNote(client, noteId, 2)), false);
});

test("invalid chunk offsets, vector dimensions and profile changes are rejected", async () => {
  const noteId = await transaction(pool, (client) => insertNote(client));
  await assert.rejects(pool.query("INSERT INTO chunks (note_id,note_version,ordinal,body,start_offset,end_offset,chunker_version) VALUES ($1,1,0,'Invented',0,8,'v1')", [noteId]), /match the stored note version/);
  await assert.rejects(pool.query("INSERT INTO embedding_profiles (model,dimensions,chunker_version) VALUES ('wrong/dimension',3,'v1')"), /embedding_dimensions/);
  await assert.rejects(pool.query("UPDATE embedding_profiles SET model='changed/model' WHERE model='fixture/embedding'"), /immutable/);
  await assert.rejects(pool.query("INSERT INTO embedding_profiles (model,dimensions,chunker_version,active) VALUES ('second/active',1536,'v1',true)"), /one_active_embedding_profile/);
});

test("quiz attempts require stored question membership and cannot duplicate scores", async () => {
  const sessionId = (await pool.query("INSERT INTO quiz_sessions_v2 (mode) VALUES ('mcq') RETURNING id")).rows[0].id;
  const otherId = (await pool.query("INSERT INTO quiz_sessions_v2 (mode) VALUES ('mcq') RETURNING id")).rows[0].id;
  const questionId = (await pool.query("INSERT INTO quiz_questions (session_id,sequence,prompt,answer_key) VALUES ($1,0,'Question','{}') RETURNING id", [sessionId])).rows[0].id;
  const attempt = "INSERT INTO quiz_attempts_v2 (session_id,question_id,submission_key,answer,is_correct,feedback) VALUES ($1,$2,$3,'{}',true,'Feedback')";
  await assert.rejects(pool.query(attempt, [otherId, questionId, randomUUID()]), /foreign key/);
  await pool.query(attempt, [sessionId, questionId, randomUUID()]);
  await assert.rejects(pool.query(attempt, [sessionId, questionId, randomUUID()]), /quiz_one_attempt/);
  const result = (await pool.query("SELECT total_questions, score FROM quiz_session_scores WHERE session_id=$1", [sessionId])).rows[0];
  assert.deepEqual(result, { total_questions: 1, score: 1 });
});

test("optional legacy import preserves full conflicting copies, timestamps, hashes and rerun checkpoints", async () => {
  const legacyDir = path.join(scratch, "legacy");
  const vault = path.join(legacyDir, "vault");
  await mkdir(path.join(vault, "Java"), { recursive: true });
  const fileBody = "# Classes\n" + "File source detail. ".repeat(100);
  const dbBody = "# Classes\n" + "Different database detail. ".repeat(100);
  await writeFile(path.join(vault, "Java", "Classes.md"), fileBody);
  const file = path.join(legacyDir, "legacy.db");
  const legacy = new Database(file);
  legacy.exec("CREATE TABLE memories (id TEXT, title TEXT, file_path TEXT, content TEXT, created_at TEXT); CREATE TABLE app_settings (key TEXT, value TEXT)");
  legacy.prepare("INSERT INTO memories VALUES ('old-note','Classes','Java/Classes.md',?,'2020-01-02T00:00:00Z')").run(dbBody);
  legacy.prepare("INSERT INTO app_settings VALUES ('api_key','do-not-read-or-import')").run();
  legacy.close();
  const before = sha256((await readFile(file)).toString("base64"));
  const report = await inventoryLegacy({ sqlitePath: file, vaultPath: vault });
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.items.length, 2);
  assert.equal(JSON.stringify(report).includes("do-not-read-or-import"), false);
  assert.deepEqual(await asMaintenance(() => importLegacy(pool, report, "fixtures")), { imported: 2, skipped: 0, conflictsPreserved: 1 });
  assert.deepEqual(await asMaintenance(() => importLegacy(pool, report, "fixtures")), { imported: 0, skipped: 2, conflictsPreserved: 1 });
  const rows = (await pool.query("SELECT n.body,n.content_hash,n.created_at FROM notes n JOIN import_items i ON i.note_id=n.id WHERE i.source_key LIKE 'fixtures:%'")).rows;
  assert.deepEqual(rows.map((row) => row.content_hash).sort(), [sha256(fileBody), sha256(dbBody)].sort());
  assert.ok(rows.every((row) => row.body.length > 300));
  assert.equal(rows.find((row) => row.body === dbBody).created_at.toISOString(), "2020-01-02T00:00:00.000Z");
  assert.equal(sha256((await readFile(file)).toString("base64")), before);
});
