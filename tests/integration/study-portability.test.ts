import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import AdmZip from "adm-zip";
import { createStorage, ROOT_FOLDER_ID } from "../../src/lib/storage/client";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { asMaintenance } from "../../src/lib/storage/access";
import { KnowledgeService } from "../../src/lib/storage/knowledge";
import { PracticeService } from "../../src/lib/storage/practice";
import { AttachmentService } from "../../src/lib/storage/attachments";
import { SettingsService } from "../../src/lib/storage/settings";
import { importMarkdown, parseImport, previewImport } from "../../src/lib/storage/imports";
import { exportNotes } from "../../src/lib/storage/export";
import { purgeNote } from "../../src/lib/storage/purge";
import { validateRecovery } from "../../src/lib/storage/recovery";
import { provisionOwner } from "../../src/lib/auth/owner";
import { verifyPassword } from "better-auth/crypto";
import { createProductionRegistry } from "../../src/lib/worker/projections";
import { runStage } from "../../src/lib/worker/runtime";
import { schedule, type StudyAction } from "../../src/lib/study/contracts";
import type { AIProvider } from "../../src/lib/ai/provider";

const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!url.pathname.startsWith("/myai_test")) throw new Error("Dedicated test database required.");
const admin = new Pool({ connectionString: url.toString() }), name = "myai_test_study_" + randomUUID().replaceAll("-", ""), restoredName = name + "_restore";
let storage: ReturnType<typeof createStorage>, knowledge: KnowledgeService, practice: PracticeService, directory: string, files: AttachmentService;
let clock = new Date("2026-03-07T23:30:00Z"), verdict = "partial", calls = 0;
const run = <T>(f: () => T) => asMaintenance(f), key = () => randomUUID();
const ai: AIProvider = { id: "test/structured", name: "Synthetic", isAvailable: async () => true, chat: async () => "", async *chatStream() {},
  async chatStructured(messages, schema) {
    calls++; const data = JSON.parse(messages[1].content), system = messages[0].content;
    if (system.startsWith("Independently")) return schema.parse({ supported: true, atomic: true, unambiguous: true });
    if (system.startsWith("Assess")) return schema.parse({ verdict, feedback: "Synthetic rubric assessment", criteriaMet: [verdict === "correct"] });
    return schema.parse({ supported: true, prompt: "Explain the ordering in " + data.source, answer: "FIFO", options: data.kind === "mcq" ? ["FIFO", "LIFO", "Sorted", "Random"] : [], quote: data.source, explanation: "The source states FIFO.", criteria: ["Identify FIFO ordering."] });
  } };
before(async () => {
  await admin.query('CREATE DATABASE "' + name + '"'); url.pathname = "/" + name;
  storage = createStorage({ DATABASE_URL: url.toString() }); await migrateDatabase(storage.pool);
  knowledge = new KnowledgeService(storage.pool); practice = new PracticeService(storage.pool, () => clock);
  directory = await mkdtemp(path.join(tmpdir(), "myai-study-")); files = new AttachmentService(storage.pool, directory);
  await run(() => new SettingsService(storage.pool).save({ timezone: "America/New_York" }));
});
after(async () => { await storage?.close(); await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)'); await admin.query('DROP DATABASE IF EXISTS "' + restoredName + '" WITH (FORCE)'); await admin.end(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function setup(kind: "mcq" | "recall" | "explanation", count = 1) {
  const folder = await knowledge.createFolder({ name: key() }), notes = [];
  for (let i = 0; i < count; i++) notes.push(await knowledge.execute({ action: "create", folderId: folder.id, title: "Queue " + i, body: "Queue " + i + " uses FIFO.", idempotencyKey: key() }));
  const generated = await practice.act({ action: "generate", folderId: folder.id, query: "", kind, count }, key(), ai);
  const started = await practice.act({ action: "start", folderId: folder.id, mode: "folder", count }, key());
  return { folder, notes, generated, session: await practice.session(started.sessionId) };
}
test("P10 persisted options, out-of-order/duplicate submissions, reveal and bounded scores", () => run(async () => {
  const { session } = await setup("mcq", 2); const [q, second] = session.questions;
  assert.equal(q.answerKey, undefined); assert.equal(q.quote, undefined);
  const option = (question: typeof q, text: string) => question.options.find((o: { text: string }) => o.text === text).id;
  await assert.rejects(practice.act({ action: "answer", sessionId: session.id, questionId: second.id, answer: option(second, "FIFO") }, key(), ai), /previous question/);
  const request = { action: "answer", sessionId: session.id, questionId: q.id, answer: option(q, "LIFO") } satisfies StudyAction, token = key();
  await practice.act(request, token, ai); await practice.act(request, token, ai);
  await assert.rejects(practice.act({ ...request, answer: option(q, "FIFO") }, token, ai), /different study action/);
  await practice.act({ action: "reveal", sessionId: session.id, questionId: second.id }, key());
  await practice.act({ action: "answer", sessionId: session.id, questionId: second.id, answer: option(second, "FIFO") }, key(), ai);
  const result = await practice.session(session.id); assert.equal(result.score, 0); assert.equal(result.total, 2); assert(result.completed);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM quiz_attempts_v2 WHERE session_id=$1", [session.id])).rows[0].n, 2);
  assert.equal(result.questions[1].attempt?.grade.assisted, true);
}));
test("P10 rubric uncertainty, partial and one-character answers; correction is versioned and replayable", () => run(async () => {
  const { session, folder } = await setup("explanation"); const q = session.questions[0]; verdict = "uncertain";
  await practice.act({ action: "answer", sessionId: session.id, questionId: q.id, answer: "A queue follows an ordering" }, key(), ai);
  let result = await practice.session(session.id); assert.equal(result.questions[0].attempt?.correct, null);
  await practice.act({ action: "correct", sessionId: session.id, questionId: q.id, rating: 1, reason: "Missing the FIFO criterion", revision: 1 }, key());
  await assert.rejects(practice.act({ action: "correct", sessionId: session.id, questionId: q.id, rating: 3, reason: "Stale correction", revision: 1 }, key()), /Feedback changed/);
  result = await practice.session(session.id); assert.equal(result.score, 0); assert.equal(result.questions[0].attempt?.revision, 2);
  const s2 = await practice.act({ action: "start", folderId: folder.id, mode: "folder", count: 1 }, key()); const second = await practice.session(s2.sessionId); verdict = "correct";
  await practice.act({ action: "answer", sessionId: second.id, questionId: second.questions[0].id, answer: "x" }, key(), ai);
  assert.equal((await practice.session(second.id)).score, 0);
  const s3 = await practice.act({ action: "start", folderId: folder.id, mode: "folder", count: 1 }, key()); const third = await practice.session(s3.sessionId); verdict = "partial";
  await practice.act({ action: "answer", sessionId: third.id, questionId: third.questions[0].id, answer: "It has ordering" }, key(), ai);
  assert.equal((await practice.session(third.id)).questions[0].attempt?.grade.rating, 1);
}));
test("P10 recall calendar/DST, raw-event replay, stale sources, regeneration, exam privacy", () => run(async () => {
  const { session, folder, notes, generated } = await setup("recall"); const q = session.questions[0];
  await assert.rejects(practice.act({ action: "answer", sessionId: session.id, questionId: q.id, rating: 2, answer: "" }, key()), /Reveal/);
  await practice.act({ action: "reveal", sessionId: session.id, questionId: q.id }, key());
  await practice.act({ action: "answer", sessionId: session.id, questionId: q.id, rating: 2, answer: "" }, key());
  let result = await practice.session(session.id); assert.equal(new Date(result.questions[0].attempt?.dueAt).toISOString(), "2026-03-08T13:00:00.000Z");
  const exam = await practice.act({ action: "start", folderId: folder.id, mode: "exam", count: 1 }, key()); const examSession = await practice.session(exam.sessionId);
  assert.equal(examSession.score, null); await assert.rejects(practice.act({ action: "reveal", sessionId: exam.sessionId, questionId: examSession.questions[0].id }, key()), /Exam answers/);
  clock = new Date("2026-03-08T22:00:00Z");
  await practice.act({ action: "answer", sessionId: exam.sessionId, questionId: examSession.questions[0].id, answer: "FIFO" }, key());
  await practice.act({ action: "correct", sessionId: exam.sessionId, questionId: examSession.questions[0].id, revision: 1, rating: 2, reason: "Matches source" }, key());
  await practice.act({ action: "correct", sessionId: session.id, questionId: q.id, revision: 1, rating: 0, reason: "Actually forgot it" }, key());
  const state = (await storage.pool.query("SELECT state FROM review_schedule WHERE card_id=$1", [generated.cardIds[0]])).rows[0].state;
  assert.deepEqual(state, schedule(schedule({}, 0), 2));
  await knowledge.execute({ action: "edit", noteId: notes[0].noteId, expectedVersion: 1, title: "Updated queue", body: "A queue still uses FIFO, with updated examples.", idempotencyKey: key() });
  result = await practice.session(session.id); assert(result.questions[0].stale);
  await assert.rejects(practice.act({ action: "correct", sessionId: session.id, questionId: q.id, revision: 2, rating: 2, reason: "Source no longer current" }, key()), /source changed/);
  const next = await practice.act({ action: "generate", folderId: folder.id, query: "", kind: "recall", count: 1, regenerateId: generated.cardIds[0] }, key(), ai);
  assert.notEqual(next.cardIds[0], generated.cardIds[0]); assert((await practice.overview(folder.id)).cards.some(c => c.stale));
}));
test("P11 UTF-8/code ZIP import, duplicate hashes, merge conflicts and DB-only export", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Portable" }), archive = new AdmZip();
  archive.addFile("java/syntax.java", Buffer.from("class Example { String s = \"😀\"; }")); archive.addFile("java/readme.md", Buffer.from("# Source\nComplete text"));
  const bytes = archive.toBuffer(), preview = await previewImport(knowledge, bytes, "notes.zip", folder.id); assert.equal(preview.items.length, 2);
  const token = key(), result = await importMarkdown(knowledge, files, bytes, "notes.zip", token, folder.id, { policy: "skip" });
  assert.equal(result.importedCount, 2); assert.deepEqual(await importMarkdown(knowledge, files, bytes, "notes.zip", token, folder.id, { policy: "skip" }), result);
  assert.equal((await importMarkdown(knowledge, files, bytes, "notes.zip", key(), folder.id, { policy: "skip" })).skippedCount, 2);
  const code = await knowledge.get(result.receipts.find((r: { path: string }) => r.path.endsWith(".java.md")).noteId); assert(code?.body.includes("```java"));
  const original = (await storage.pool.query("SELECT body FROM sources WHERE attachment_id=$1 ORDER BY created_at", [result.attachmentId])).rows; assert(original.some(s => s.body.startsWith("class Example")));
  const altered = new AdmZip(); altered.addFile("java/readme.md", Buffer.from("Appended content")); const diff = await previewImport(knowledge, altered.toBuffer(), "new.zip", folder.id);
  await assert.rejects(importMarkdown(knowledge, files, altered.toBuffer(), "new.zip", key(), folder.id, { policy: "merge" }), /Preview again/);
  const merged = await importMarkdown(knowledge, files, altered.toBuffer(), "new.zip", key(), folder.id, { policy: "merge", expectedVersions: { "java/readme.md": diff.items[0].expectedVersion! } });
  assert((await knowledge.get(merged.receipts[0].noteId))?.body.includes("Complete text\n\n---\n\nAppended content"));
  const exported = new AdmZip(await exportNotes(storage.pool)); assert(exported.getEntry("graph.json")); assert(exported.getEntry("attachments.json"));
  assert.equal(exported.readAsText("vault/" + code!.path), code!.body);
  assert.equal(JSON.parse(exported.readAsText("manifest.json")).fullBackup, false);
}));
test("P10 concurrent generation is retryable and does not duplicate cards or billing after publication", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Concurrent practice" });
  await knowledge.execute({ action: "create", folderId: folder.id, title: "Queue", body: "Queues use FIFO.", idempotencyKey: key() });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const slow: AIProvider = { ...ai, async chatStructured(messages, schema, options) { entered(); await gate; return ai.chatStructured(messages, schema, options); } };
  const input = { action: "generate", folderId: folder.id, query: "", kind: "mcq", count: 1 } satisfies StudyAction, token = key();
  const first = practice.act(input, token, slow); await started;
  try { await assert.rejects(practice.act(input, token, slow), /Another study action/); } finally { release(); }
  const result = await first, billed = calls;
  assert.deepEqual(await practice.act(input, token, slow), result); assert.equal(calls, billed);
}));
test("P11 unsafe archives/formats fail before writes, and purge enforces retention", () => run(async () => {
  const unsafe = new AdmZip(); unsafe.addFile("aa/a.md", Buffer.from("unsafe"));
  const traversal = Buffer.from(unsafe.toBuffer().toString("latin1").replaceAll("aa/a.md", "../a.md"), "latin1");
  assert.throws(() => parseImport(traversal, "unsafe.zip"), /Unsafe archive path/);
  const collision = new AdmZip(); collision.addFile("A.md", Buffer.from("one")); collision.addFile("a.md", Buffer.from("two")); assert.throws(() => parseImport(collision.toBuffer(), "dup.zip"), /colliding/);
  assert.throws(() => parseImport(Buffer.from("image"), "picture.png"), /Unsupported/);
  assert.throws(() => parseImport(Buffer.from([0xff]), "invalid.txt"), /UTF-8/);
  const oversized = new AdmZip(); oversized.addFile("huge.md", Buffer.alloc(1_000_001, 65)); assert.throws(() => parseImport(oversized.toBuffer(), "huge.zip"), /Oversized/);
  const result = await importMarkdown(knowledge, files, Buffer.from("Private purge content"), "purge.txt", key(), ROOT_FOLDER_ID, { policy: "create" });
  const note = result.receipts[0]; await assert.rejects(purgeNote(storage.pool, directory, note.noteId, 1), /30 days/);
  await knowledge.execute({ action: "lifecycle", noteId: note.noteId, expectedVersion: 1, lifecycle: "trashed", idempotencyKey: key() });
  await storage.pool.query("UPDATE notes SET trashed_at=now()-interval '31 days' WHERE id=$1", [note.noteId]);
  await purgeNote(storage.pool, directory, note.noteId, 2); assert.equal(await knowledge.get(note.noteId, true), null);
  await assert.rejects(files.download(result.attachmentId), /not found/);
  const shared = new AdmZip(); shared.addFile("shared/secret.md", Buffer.from("Remove from original ZIP")); shared.addFile("shared/keep.md", Buffer.from("Keep this note"));
  const imported = await importMarkdown(knowledge, files, shared.toBuffer(), "shared.zip", key());
  const secret = imported.receipts.find((r: { path: string }) => r.path.endsWith("secret.md"));
  await knowledge.execute({ action: "lifecycle", noteId: secret.noteId, expectedVersion: 1, lifecycle: "trashed", idempotencyKey: key() });
  await storage.pool.query("UPDATE notes SET trashed_at=now()-interval '31 days' WHERE id=$1", [secret.noteId]);
  await purgeNote(storage.pool, directory, secret.noteId, 2);
  assert.equal((await knowledge.get("shared/keep.md"))?.body, "Keep this note");
  assert.equal((await storage.pool.query("SELECT state FROM attachments WHERE id=$1", [imported.attachmentId])).rows[0].state, "purged");
  await assert.rejects(files.download(imported.attachmentId), /not found/);
}));
test("P11 full PostgreSQL + attachment backup restores owner, graph, chat, versions and learning into fresh database", () => run(async () => {
  await provisionOwner(storage.pool, { email: "restore@example.test", password: "a-strong-test-password" });
  const conversation = (await storage.pool.query("INSERT INTO conversations(title) VALUES('Restore chat') RETURNING id")).rows[0];
  await storage.pool.query("INSERT INTO messages(conversation_id,sequence,role,content,status) VALUES($1,0,'user','Saved conversation','completed')", [conversation.id]);
  const note = (await knowledge.list({ limit: 1 }))[0];
  await runStage(storage.pool, createProductionRegistry(() => storage.pool), "chunks", { noteId: note.id, noteVersion: note.current_version, pipelineVersion: "v1" });
  await storage.pool.query("UPDATE graph_edges SET origin='owner_curated',review_state='owner_reviewed' WHERE id=(SELECT id FROM graph_edges LIMIT 1)");
  const before = await validateRecovery(storage.pool, directory); assert(before.counts.review_events > 0); assert(before.counts.graph_edges > 0);
  const container = "myai-tests-db-1", bundle = "roundtrip_" + randomUUID().replaceAll("-", "");
  const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(docker("inspect", "--format", '{{ index .Config.Labels "com.docker.compose.project" }}', container).trim(), "myai-tests");
  docker("cp", path.resolve("scripts/recovery/recovery.sh"), container + ":/tmp/myai-recovery.sh");
  docker("exec", container, "mkdir", "-p", "/attachments", "/backups");
  docker("cp", path.join(directory, "objects"), container + ":/attachments/objects");
  await storage.close();
  const recovery = (action: string, db: string) => docker("exec", "-e", "PGHOST=127.0.0.1", "-e", "PGUSER=myai_test", "-e", "PGPASSWORD=test-only-password", "-e", "PGDATABASE=" + db, container, "bash", "/tmp/myai-recovery.sh", action, bundle);
  try {
    assert.match(recovery("backup", name), /Backup complete/); assert.match(recovery("verify", name), /verified/);
    assert.throws(() => recovery("restore", name)); // Existing installation is protected.
    await admin.query('CREATE DATABASE "' + restoredName + '"');
    docker("exec", container, "rm", "-rf", "/attachments/objects", "/attachments/staging");
    assert.match(recovery("restore", restoredName), /Restore completed/);
    const restoredDir = path.join(directory, "restored"); await mkdir(restoredDir);
    docker("cp", container + ":/attachments/objects", restoredDir);
    const target = new URL(url); target.pathname = "/" + restoredName;
    const restored = createStorage({ DATABASE_URL: target.toString() });
    try {
      const checked = await validateRecovery(restored.pool, restoredDir); assert.deepEqual(checked.counts, before.counts);
      const credential = (await restored.pool.query("SELECT password FROM auth_accounts WHERE provider_id='credential'")).rows[0].password;
      assert(await verifyPassword({ hash: credential, password: "a-strong-test-password" }));
      assert.equal((await migrateDatabase(restored.pool)).length, 0);
    } finally { await restored.close(); }
  } finally { storage = createStorage({ DATABASE_URL: url.toString() }); docker("exec", container, "rm", "-rf", "/attachments/objects", "/attachments/staging", "/backups/" + bundle); }
  assert(calls > 0);
}));

