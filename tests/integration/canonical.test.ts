import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, rename, utimes } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import AdmZip from "adm-zip";
import { createStorage, transaction, ROOT_FOLDER_ID } from "../../src/lib/storage/client";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { asMaintenance } from "../../src/lib/storage/access";
import { KnowledgeService } from "../../src/lib/storage/knowledge";
import { AttachmentService } from "../../src/lib/storage/attachments";
import { SettingsService } from "../../src/lib/storage/settings";
import { StudyService } from "../../src/lib/storage/study";
import { ChatService } from "../../src/lib/storage/chat";
import { importMarkdown } from "../../src/lib/storage/imports";
import { provisionOwner, recoverOwner, allowLogin } from "../../src/lib/auth/owner";
import { createAuth } from "../../src/lib/auth/server";
import type { AIProvider } from "../../src/lib/ai/provider";

const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!url.pathname.startsWith("/myai_test")) throw new Error("Use a dedicated test database.");
const admin = new Pool({ connectionString: url.toString() });
const name = "myai_test_" + randomUUID().replaceAll("-", "");
let storage: ReturnType<typeof createStorage>, pool: Pool, service: KnowledgeService, dir: string;
const run = <T>(work: () => T) => asMaintenance(work);
const key = () => randomUUID();
before(async () => {
  await admin.query('CREATE DATABASE "' + name + '"');
  url.pathname = "/" + name; storage = createStorage({ DATABASE_URL: url.toString() }); pool = storage.pool;
  await migrateDatabase(pool); service = new KnowledgeService(pool); dir = await mkdtemp(path.join(tmpdir(), "myai-canonical-"));
});
after(async () => { if (storage) await storage.close(); await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)'); await admin.end(); if (dir) await rm(dir, { recursive: true, force: true }); });

test("manual save is exact, immediately searchable, versioned, sourced and atomically queued", () => run(async () => {
  const text = "# Exact source\r\n\r\nC++ Map.Entry<T> x != null\n  Keep spaces.\n";
  const receipt = await service.execute({ action: "create", idempotencyKey: key(), title: "Technical source", body: text });
  const note = (await service.get(receipt.noteId))!;
  assert.equal(note.body, text); assert.equal(note.current_version, 1);
  assert.equal(note.content_hash, createHash("sha256").update(text).digest("hex"));
  assert.ok((await service.search("C++")).some((n) => n.id === note.id));
  assert.ok((await service.search("source?")).some((n) => n.id === note.id));
  assert.ok((await service.search("C++?")).some((n) => n.id === note.id));
  await service.execute({ action: "create", idempotencyKey: key(), title: "C language", body: "C does not mean C plus plus." });
  assert.ok((await service.search("C++")).every((n) => n.body.includes("C++")));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM note_sources WHERE note_id=$1", [note.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM processing_state WHERE note_id=$1", [note.id])).rows[0].n, 3);
  assert.equal((await service.history(note.id))[0].body, text);
}));
test("replayed operations are identical; key reuse and path collisions cannot overwrite", () => run(async () => {
  const input = { action: "create" as const, idempotencyKey: key(), title: "Repeat", body: "Original", path: "repeat.md" };
  const a = await service.execute(input), b = await service.execute(input); assert.deepEqual(a, b);
  await assert.rejects(service.execute({ ...input, body: "Overwrite" }), /different request/);
  await assert.rejects(service.execute({ ...input, idempotencyKey: key(), body: "Overwrite" }), /belongs|reserves|path already exists/);
  assert.equal((await service.get(a.noteId))!.body, "Original");
  assert.equal((await service.history(a.noteId)).length, 1);
}));
test("rollback leaves no note, operation, source or orphan job", () => run(async () => {
  const before = (await pool.query("SELECT (SELECT count(*) FROM notes) AS n,(SELECT count(*) FROM operations) AS o,(SELECT count(*) FROM sources) AS s,(SELECT count(*) FROM graphile_worker.jobs) AS j")).rows[0];
  await assert.rejects(transaction(pool, async (client) => {
    await service.executeInTransaction(client, { action: "create", idempotencyKey: key(), title: "Rollback", body: "Never committed" });
    throw new Error("Interrupted write");
  }), /Interrupted/);
  const after = (await pool.query("SELECT (SELECT count(*) FROM notes) AS n,(SELECT count(*) FROM operations) AS o,(SELECT count(*) FROM sources) AS s,(SELECT count(*) FROM graphile_worker.jobs) AS j")).rows[0];
  assert.deepEqual(after, before);
}));
test("competing edits conflict and search reads only the latest active content", () => run(async () => {
  const receipt = await service.execute({ action: "create", idempotencyKey: key(), title: "Race", body: "OldUniqueToken" });
  const attempts = await Promise.allSettled(["NewUniqueAlpha", "NewUniqueBeta"].map((body) => service.execute({ action: "edit", noteId: receipt.noteId, expectedVersion: 1, title: "Race", body, idempotencyKey: key() })));
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.equal((await service.history(receipt.noteId)).length, 2);
  assert.equal((await service.search("OldUniqueToken")).length, 0);
  await service.execute({ action: "lifecycle", noteId: receipt.noteId, expectedVersion: 2, lifecycle: "archived", idempotencyKey: key() });
  assert.equal((await service.search("Race")).length, 0);
  assert.equal(await service.get(receipt.noteId), null);
  await service.execute({ action: "lifecycle", noteId: receipt.noteId, expectedVersion: 3, lifecycle: "active", idempotencyKey: key() });
  assert.equal((await service.get(receipt.noteId))!.current_version, 4);
}));
test("folders, descendants, moves and old paths resolve without a vault", () => run(async () => {
  const java = await service.createFolder({ name: "Java" }), syntax = await service.createFolder({ name: "Syntax", parentId: java.id });
  const r = await service.execute({ action: "create", folderId: syntax.id, idempotencyKey: key(), title: "Nested", body: "scope-token", path: "java/syntax/nested.md" });
  const edit = await service.execute({ action: "edit", noteId: r.noteId, expectedVersion: 1, title: "Nested", body: "scope-token edited", idempotencyKey: key() });
  assert.equal((await service.search("scope-token", { folderId: java.id })).length, 1);
  assert.equal((await service.search("scope-token", { folderId: java.id, descendants: false })).length, 0);
  await service.moveFolder({ id: java.id, parentId: ROOT_FOLDER_ID, name: "Language" });
  assert.equal((await service.get("java/syntax/nested.md"))!.id, r.noteId);
  assert.equal((await service.get(r.noteId))!.path, "language/syntax/nested.md");
  assert.equal(await service.resolveFolder("java/syntax"), syntax.id);
  await service.execute({ action: "undo", operationId: edit.operationId, idempotencyKey: key() });
  assert.equal((await service.get(r.noteId))!.path, "language/syntax/nested.md");
  assert.equal((await service.get(r.noteId))!.body, "scope-token");
  await assert.rejects(service.moveFolder({ id: java.id, parentId: syntax.id, name: "Cycle" }), /cycle|descendant/);
  await assert.rejects(service.createFolder({ name: "Java" }), /reserved/);
}));
test("explicit merge preserves sources and originals, undo creates new versions", () => run(async () => {
  const a = await service.execute({ action: "create", idempotencyKey: key(), title: "First", body: "first source" });
  const b = await service.execute({ action: "create", idempotencyKey: key(), title: "Second", body: "second source" });
  const merged = await service.execute({ action: "merge", noteId: a.noteId, expectedVersion: 1, sources: [{ noteId: b.noteId, expectedVersion: 1 }], title: "Together", body: "first source\nsecond source", idempotencyKey: key() });
  assert.equal((await service.get(b.path))!.id, a.noteId);
  assert.equal((await service.get(b.noteId, true))!.lifecycle, "archived");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM note_sources WHERE note_id=$1 AND version=2", [a.noteId])).rows[0].n, 2);
  await service.execute({ action: "undo", operationId: merged.operationId, idempotencyKey: key() });
  assert.equal((await service.get(a.noteId))!.body, "first source");
  assert.equal((await service.get(b.noteId))!.body, "second source");
  assert.equal((await service.get(a.noteId))!.current_version, 3);
  await assert.rejects(service.execute({ action: "undo", operationId: merged.operationId, idempotencyKey: key() }), /changed/);
  const c = await service.execute({ action: "create", idempotencyKey: key(), title: "Undo create", body: "recoverable" });
  await service.execute({ action: "undo", operationId: c.operationId, idempotencyKey: key() });
  assert.equal((await service.get(c.noteId, true))!.lifecycle, "trashed");
}));
test("attachment finalization is replayable after a rename-before-commit interruption", () => run(async () => {
  const files = new AttachmentService(pool, dir), data = Buffer.from("original bytes\r\n"), staged = await files.stage(data, "source.md", "text/markdown");
  await rename(path.join(dir, "staging", staged.storage_key), path.join(dir, "objects", staged.storage_key));
  await files.finalize(staged.id); await files.finalize(staged.id);
  assert.deepEqual((await files.download(staged.id)).bytes, data);
  const missing = await files.stage(Buffer.from("lost"), "lost.md", "text/markdown");
  await rm(path.join(dir, "staging", missing.storage_key));
  const orphan = path.join(dir, "staging", randomUUID()); await writeFile(orphan, "orphan"); await utimes(orphan, new Date(0), new Date(0));
  await pool.query("UPDATE attachments SET created_at=now()-interval '2 hours' WHERE id=$1", [missing.id]);
  const report = await files.reconcile(); assert.equal(report.failed, 1); assert.equal(report.orphanFilesRemoved, 1);
  assert.deepEqual((await files.download(staged.id)).bytes, data);
  await assert.rejects(readFile(orphan), /ENOENT/);
}));
test("imports retain full UTF-8 content and original bytes; conflicts rollback the whole batch", () => run(async () => {
  const files = new AttachmentService(pool, dir), zip = new AdmZip(), body = "# Imported\n😀 " + "long content ".repeat(1000);
  zip.addFile("vault/import-tests/a.md", Buffer.from(body)); zip.addFile("vault/import-tests/b.md", Buffer.from("Second"));
  const bytes = zip.toBuffer(), operation = key();
  const result = await importMarkdown(service, files, bytes, "notes.zip", operation);
  assert.equal(result.importedCount, 2); assert.equal((await service.get("import-tests/a.md"))!.body, body);
  assert.deepEqual((await files.download(result.attachmentId)).bytes, bytes);
  assert.deepEqual(await importMarkdown(service, files, bytes, "notes.zip", operation), result);
  const conflict = new AdmZip(); conflict.addFile("vault/import-tests/new.md", Buffer.from("New")); conflict.addFile("vault/import-tests/a.md", Buffer.from("Overwrite"));
  await assert.rejects(importMarkdown(service, files, conflict.toBuffer(), "conflict.zip", key()), /belongs|reserves|path already exists/);
  assert.equal(await service.get("import-tests/new.md"), null); assert.equal((await service.get("import-tests/a.md"))!.body, body);
}));
test("settings reject secret/arbitrary URL fields and persist supported preferences", () => run(async () => {
  const preferences = new SettingsService(pool);
  await preferences.save({ chatModel: "test/model", timezone: "Asia/Calcutta" });
  assert.equal((await preferences.read()).chatModel, "test/model");
  await assert.rejects(preferences.save({ apiKey: "private" }));
  await assert.rejects(preferences.save({ baseUrl: "http://internal" }));
}));
test("chat save and Ask use one persistence authority; failed generation saves no note", () => run(async () => {
  const chat = new ChatService(pool);
  const operation = key(), input = { messages: [{ role: "user" as const, content: "  Exact manual input\n" }], mode: "save" as const };
  const turn = await chat.begin(input, operation);
  const result = await chat.finish(turn, turn.content, operation, "none");
  assert.equal((await service.get(String(result.memory.noteId)))!.body, input.messages[0].content);
  assert.equal((await chat.begin(input, operation)).completed, true);
  const history = await chat.history(turn.sessionId); assert.equal(history.messages?.length, 2);
  const askKey = key(), ask = await chat.begin({ sessionId: turn.sessionId, messages: [{ role: "user", content: "A question?" }] }, askKey);
  assert.deepEqual(await chat.context(ask), [
    { role: "user", content: turn.content }, { role: "assistant", content: turn.content }, { role: "user", content: "A question?" },
  ]);
  assert.equal((await chat.finish(ask, "An answer", askKey, "test")).memory.saved, false);
  await chat.fail(ask, "late failure", false);
  assert.equal((await chat.finish(ask, "duplicate", askKey, "test")).reply, "An answer");
  const failed = await chat.begin({ messages: [{ role: "user", content: "Generate something" }], mode: "generate" }, key());
  await chat.fail(failed, "partial", false);
  await assert.rejects(chat.finish(failed, "late output", key(), "test"), /cannot be completed/);
  assert.equal((await pool.query("SELECT status FROM messages WHERE id=$1", [failed.assistantId])).rows[0].status, "failed");
  assert.equal((await pool.query("SELECT note_id FROM operations WHERE id=$1", [failed.operationId])).rows[0].note_id, null);
}));
test("quiz grades stored exact answers once, rejects other sessions and stale evidence", () => run(async () => {
  const source = await service.execute({ action: "create", idempotencyKey: key(), title: "QuizUniqueTopic", body: "Map.Entry is the exact API." });
  const ai: AIProvider = { id: "test", name: "test", async isAvailable() { return true; }, async chat() { return ""; }, async *chatStream() {},
    async chatStructured<T>() { return { type: "mcq", question: "Which API?", options: ["Map.Entry", "Other"], correctAnswer: "Map.Entry", explanation: "Exact source answer." } as T; } };
  const study = new StudyService(pool), quiz = await study.generateQuiz(ai, "QuizUniqueTopic", 1), q = quiz.questions[0];
  assert.equal("correctAnswer" in q, false); assert.equal("explanation" in q, false);
  assert.equal((await study.quizAnswer({ sessionId: quiz.sessionId, questionId: q.id, answer: "M" })).score, 0);
  assert.equal((await study.quizAnswer({ sessionId: quiz.sessionId, questionId: q.id, answer: "Map.Entry" })).score, 0);
  await assert.rejects(study.quizAnswer({ sessionId: key(), questionId: q.id, answer: "Map.Entry" }), /belong/);
  await service.execute({ action: "edit", noteId: source.noteId, expectedVersion: 1, title: "QuizUniqueTopic", body: "Changed", idempotencyKey: key() });
  await assert.rejects(study.quizAnswer({ sessionId: quiz.sessionId, questionId: q.id, answer: "Map.Entry" }), /changed/);
}));
test("review ratings deduplicate, require session membership and reject changed notes", () => run(async () => {
  const source = await service.execute({ action: "create", idempotencyKey: key(), title: "ReviewUniqueTopic", body: "Current content" });
  const study = new StudyService(pool), session = await study.startReview("topic", "ReviewUniqueTopic", 1);
  const first = await study.reviewAnswer({ sessionId: session.sessionId, memoryId: source.noteId, remembered: false }); assert.equal(first.alreadyAnswered, false);
  assert.equal((await study.reviewAnswer({ sessionId: session.sessionId, memoryId: source.noteId, remembered: true })).remembered, false);
  await assert.rejects(study.reviewAnswer({ sessionId: key(), memoryId: source.noteId, remembered: true }), /not in/);
  await service.execute({ action: "edit", noteId: source.noteId, expectedVersion: 1, title: "ReviewUniqueTopic", body: "New content", idempotencyKey: key() });
  await assert.rejects(study.reviewAnswer({ sessionId: session.sessionId, memoryId: source.noteId, remembered: true }), /changed/);
}));
test("owner provisioning races safely; password recovery revokes sessions and login throttling is shared", async () => {
  const credentials = { email: "owner@example.test", password: "long-test-owner-password" };
  const attempts = await Promise.allSettled([provisionOwner(pool, credentials), provisionOwner(pool, { ...credentials, email: "second@example.test" })]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  const owner = (await pool.query("SELECT id,email FROM auth_users")).rows[0];
  const auth = createAuth(storage, { APP_URL: "http://localhost:3338", BETTER_AUTH_SECRET: "isolated-auth-test-secret-32-characters" });
  const signup = await auth.handler(new Request("http://localhost:3338/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3338" }, body: JSON.stringify({ email: "intruder@example.test", password: credentials.password, name: "Intruder" }) }));
  assert.ok(signup.status >= 400);
  const login = await auth.handler(new Request("http://localhost:3338/api/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3338" }, body: JSON.stringify({ email: owner.email, password: credentials.password }) }));
  assert.equal(login.status, 200, await login.clone().text());
  const cookies = login.headers.get("set-cookie")!; assert.match(cookies, /HttpOnly/i); assert.match(cookies, /SameSite=Lax/i); assert.doesNotMatch(cookies, /; Secure/i);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auth_sessions")).rows[0].n, 1);
  const results = await Promise.all(Array.from({ length: 12 }, () => allowLogin(pool))); assert.equal(results.filter(Boolean).length, 10);
  await recoverOwner(pool, { email: owner.email, password: "a-different-long-password" });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auth_sessions")).rows[0].n, 0);
});
