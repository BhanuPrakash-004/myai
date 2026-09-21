import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import AdmZip from "adm-zip";
import { createStorage } from "../../src/lib/storage/client";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { provisionOwner, recoverOwner } from "../../src/lib/auth/owner";
import { createAuth } from "../../src/lib/auth/server";
import { asMaintenance } from "../../src/lib/storage/access";
import { KnowledgeService } from "../../src/lib/storage/knowledge";
import { PracticeService } from "../../src/lib/storage/practice";
import type { AIProvider } from "../../src/lib/ai/provider";

const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!url.pathname.startsWith("/myai_test")) throw new Error("HTTP tests require a dedicated test database.");
const admin = new Pool({ connectionString: url.toString() }), dbName = "myai_test_" + randomUUID().replaceAll("-", "");
const base = "http://localhost:" + (process.env.HTTP_TEST_PORT || "3391"), port = new URL(base).port;
const password = "test-owner-" + randomUUID(), email = "owner@example.test", secret = randomBytes(48).toString("hex");
let storage: ReturnType<typeof createStorage>, server: ChildProcess | undefined, scratch: string, cookie = "", noteId = "", notePath = "", attachmentId = "";
let logs = "";
async function start() {
  server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", port], {
    windowsHide: true, env: { ...process.env, NODE_ENV: "production", DATABASE_URL: url.toString(), APP_URL: base,
      BETTER_AUTH_SECRET: secret, DATA_DIR: scratch, OPENROUTER_API_KEY: "", OPENROUTER_CHAT_MODEL: "", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (data) => { logs = (logs + data).slice(-12000); });
  server.stderr!.on("data", (data) => { logs = (logs + data).slice(-12000); });
  server.on("error", (error) => { logs += error.message; });
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error("HTTP test server exited: " + logs);
    try { if ((await fetch(base + "/api/health")).ok) return; } catch {}
    await delay(200);
  }
  throw new Error("HTTP test server did not become ready: " + logs);
}
async function stop() {
  const child = server; if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill(); await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
  server = undefined;
}
function request(route: string, options: { method?: string; body?: unknown; auth?: boolean; origin?: string | null; key?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.auth !== false && cookie) headers.Cookie = cookie;
  if (options.origin !== null) headers.Origin = options.origin ?? base;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  headers["Idempotency-Key"] = options.key ?? randomUUID();
  return fetch(base + route, { method: options.method ?? "GET", headers, redirect: "manual", body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
async function login(pass = password) {
  const response = await request("/api/auth/sign-in/email", { method: "POST", auth: false, body: { email, password: pass } });
  assert.equal(response.status, 200, await response.clone().text());
  const cookies = response.headers.getSetCookie();
  cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  return cookies;
}
before(async () => {
  await admin.query('CREATE DATABASE "' + dbName + '"'); url.pathname = "/" + dbName;
  storage = createStorage({ DATABASE_URL: url.toString() }); await migrateDatabase(storage.pool);
  scratch = await mkdtemp(path.join(tmpdir(), "myai-http-"));
  await provisionOwner(storage.pool, { email, password }); await start();
});
after(async () => {
  await stop(); if (storage) await storage.close();
  await admin.query('DROP DATABASE "' + dbName + '" WITH (FORCE)'); await admin.end();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test("all personal routes, streams and downloads reject anonymous HTTP requests", async () => {
  const id = randomUUID();
  for (const route of ["/api/graph", "/api/knowledge", "/api/knowledge/private.md", "/api/notes/" + id, "/api/search?q=secret", "/api/export", "/api/chat", "/api/settings", "/api/folders", "/api/review", "/api/quiz", "/api/leetcode", "/api/insights/dashboard", "/api/insights/forgotten", "/api/insights/weak-areas", "/api/slash-commands", "/api/vector/status", "/api/attachments/" + id]) {
    assert.equal((await request(route, { auth: false })).status, 401, route);
  }
  for (const route of ["/api/chat/tools", "/api/improvements", "/api/chat", "/api/knowledge", "/api/import", "/api/import/chatgpt", "/api/settings", "/api/settings/test", "/api/attachments", "/api/vector/reindex", "/api/operations/" + id + "/undo"]) {
    assert.equal((await request(route, { method: "POST", auth: false, body: {} })).status, 401, route);
  }
  for (const route of ["/graph", "/evidence/" + id, "/knowledge", "/chat", "/dashboard", "/search", "/settings", "/review", "/quiz", "/leetcode", "/notes/" + id, "/knowledge/private.md"]) {
    const response = await request(route, { auth: false }); assert.equal(response.status, 307, route); assert.match(response.headers.get("location")!, /sign-in/);
  }
  assert.equal((await request("/sign-in", { auth: false })).status, 200);
});
test("public signup and remote recovery are unavailable; cookies match HTTP and HTTPS", async () => {
  for (const route of ["sign-up/email", "request-password-reset", "reset-password", "update-user"]) {
    assert.equal((await request("/api/auth/" + route, { method: "POST", auth: false, body: { email: "second@example.test", password, name: "Second" } })).status, 404);
  }
  const cookies = await login(); assert.match(cookies.join(";"), /HttpOnly/i); assert.match(cookies.join(";"), /SameSite=Lax/i); assert.doesNotMatch(cookies.join(";"), /; Secure/i);
  const https = createAuth(storage, { APP_URL: "https://brain.example.test", BETTER_AUTH_SECRET: secret });
  const response = await https.handler(new Request("https://brain.example.test/api/auth/sign-in/email", { method: "POST", headers: { Origin: "https://brain.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
  assert.equal(response.status, 200); assert.match(response.headers.get("set-cookie")!, /; Secure/i);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM auth_users")).rows[0].n, 1);
});
test("authenticated cross-site and missing-origin writes cannot mutate data", async () => {
  for (const origin of ["https://evil.example.test", null]) {
    assert.equal((await request("/api/knowledge", { method: "POST", origin, body: { title: "Attack", body: "Never save" } })).status, 403);
    assert.equal((await request("/api/auth/sign-out", { method: "POST", origin, body: {} })).status, 403);
  }
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM notes")).rows[0].n, 0);
});
test("HTTP capture/edit/move/search/aliases/export share complete canonical content", async () => {
  const folderResponse = await request("/api/folders", { method: "POST", body: { name: "Java" } }); assert.equal(folderResponse.status, 200);
  const folderId = (await folderResponse.json()).folder.id, key = randomUUID(), body = "# HTTP source\nExact Map.Entry<T> content.\n";
  const input = { folderId, title: "HTTP source", body };
  const created = await request("/api/knowledge", { method: "POST", body: input, key }); assert.equal(created.status, 201, await created.clone().text());
  const receipt = (await created.json()).receipt; noteId = receipt.noteId; notePath = receipt.path;
  const replay = await request("/api/knowledge", { method: "POST", body: input, key }); assert.equal((await replay.json()).receipt.noteId, noteId);
  let note = await request("/api/notes/" + noteId); assert.equal((await note.json()).note.body, body);
  const edited = await request("/api/notes/" + noteId, { method: "PATCH", body: { action: "edit", expectedVersion: 1, title: "HTTP source", body: body + "UpdatedCurrentToken" } }); assert.equal(edited.status, 200, await edited.clone().text());
  const conflict = await request("/api/notes/" + noteId, { method: "PATCH", body: { action: "edit", expectedVersion: 1, title: "Stale", body: "Overwrite" } }); assert.equal(conflict.status, 409);
  const results = await request("/api/search?q=UpdatedCurrentToken"); assert.equal((await results.json()).results[0].id, noteId);
  const page = await request("/notes/" + noteId); assert.equal(page.status, 200); assert.match(await page.text(), /UpdatedCurrentToken/);
  const move = await request("/api/knowledge/" + notePath, { method: "POST", body: { newPath: "java/syntax/source.md", expectedVersion: 2 } }); assert.equal(move.status, 200, await move.clone().text());
  const alias = await request("/knowledge/" + notePath); assert.equal(alias.status, 307); assert.equal(alias.headers.get("location"), "/notes/" + noteId);
  notePath = "java/syntax/source.md";
  note = await request("/api/knowledge/" + notePath); assert.equal((await note.json()).content, body + "UpdatedCurrentToken");
  const exported = await request("/api/export"); assert.equal(exported.status, 200); assert.match(exported.headers.get("cache-control")!, /no-store/);
  const zip = new AdmZip(Buffer.from(await exported.arrayBuffer())); assert.equal(zip.readAsText("vault/" + notePath), body + "UpdatedCurrentToken");
});
test("P06 owner APIs expose source/status/history and keep unavailable improvement read-only", async () => {
  const detail = await request("/api/notes/" + noteId + "?detail=1"); assert.equal(detail.status, 200);
  const data = await detail.json(); assert.equal(data.note.current_version, 3); assert.ok(data.history.length >= 3); assert.ok(data.sources.length); assert.equal(data.processing.length, 3);
  const before = (await storage.pool.query("SELECT count(*)::int AS n FROM notes")).rows[0].n;
  const improvement = await request("/api/improvements", { method: "POST", body: { title: "Draft retained", body: "Exact original" } });
  assert.equal(improvement.status, 503); assert.equal((await improvement.json()).details.code, "AI_UNAVAILABLE");
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM notes")).rows[0].n, before);
  const folder = (await (await request("/api/folders", { method: "POST", body: { name: "P06 Empty" } })).json()).folder;
  const renamed = await request("/api/folders", { method: "PATCH", body: { id: folder.id, name: "P06 Renamed", parentId: "00000000-0000-0000-0000-000000000001", sortOrder: -5, aliases: ["p06-alias"] } }); assert.equal(renamed.status, 200);
  const folders = (await (await request("/api/folders")).json()).folders; assert.ok(folders.find((f: { id: string; aliases: string[] }) => f.id === folder.id).aliases.includes("p06-alias"));
  assert.equal((await request("/api/folders", { method: "DELETE", body: { id: folder.id } })).status, 200);
});
test("P06 undo endpoint restores content, deduplicates retries and rejects obsolete history", async () => {
  await login();
  const created = await request("/api/knowledge", { method: "POST", body: { title: "Undo fixture", body: "Original source" } });
  assert.equal(created.status, 201);
  const id = (await created.json()).receipt.noteId;
  const edited = await request("/api/notes/" + id, { method: "PATCH", body: { action: "edit", expectedVersion: 1, title: "Undo fixture", body: "Reviewed edit" } });
  assert.equal(edited.status, 200);
  const operationId = (await edited.json()).receipt.operationId, key = randomUUID();
  const undone = await request("/api/operations/" + operationId + "/undo", { method: "POST", body: {}, key });
  assert.equal(undone.status, 200, await undone.clone().text());
  const receipt = (await undone.json()).receipt;
  assert.equal(receipt.version, 3);
  const replay = await request("/api/operations/" + operationId + "/undo", { method: "POST", body: {}, key });
  assert.deepEqual((await replay.json()).receipt, receipt);
  const detail = (await (await request("/api/notes/" + id + "?detail=1")).json());
  assert.equal(detail.note.body, "Original source");
  assert.equal(detail.sources.length, 1); assert.equal(detail.sources[0].body, "Original source");
  const stale = await request("/api/operations/" + operationId + "/undo", { method: "POST", body: {} });
  assert.equal(stale.status, 409);
});
test("P07 HTTP scope, exact targeted save, operation recovery, tools and history management", async () => {
  await login();
  const folder = await request("/api/chat/tools", { method: "POST", body: { tool: "create-folder", path: "http-chat/syntax" } });
  assert.equal(folder.status, 200); const folderId = (await folder.json()).folderId;
  const selected = await request("/api/chat", { method: "POST", body: { messages: [{ role: "user", content: "/http-chat/syntax" }] } });
  assert.equal(selected.status, 200); assert.deepEqual((await selected.json()).folderId, folderId);
  const sessionId = randomUUID();
  assert.equal((await request("/api/chat", { method: "PATCH", body: { action: "create", id: sessionId, title: "P07 fixture", folderId } })).status, 200);
  const body = "  Exact P07 capture\r\n", key = randomUUID(), input = { sessionId, folderId, mode: "save", messages: [{ role: "user", content: body }] };
  const response = await request("/api/chat", { method: "POST", body: input, key }); assert.equal(response.status, 200);
  const operationId = response.headers.get("x-operation-id")!; assert.ok(operationId);
  assert.match(await response.text(), /"saved":true/);
  const status = await request("/api/chat/operations/" + operationId); assert.equal(status.status, 200);
  const operation = (await status.json()).operation; assert.equal(operation.status, "completed");
  const capturedId = operation.result.memory.noteId;
  assert.equal((await (await request("/api/notes/" + capturedId)).json()).note.body, body);
  const replay = await request("/api/chat", { method: "POST", body: input, key }); assert.match(await replay.text(), /"saved":true/);
  const history = await request("/api/chat?sessionId=" + sessionId); assert.equal((await history.json()).messages.length, 2);
  const exact = { sessionId, folderId, noteId: capturedId, expectedVersion: 1, mode: "save", messages: [{ role: "user", content: "Reviewed replacement" }] };
  assert.match(await (await request("/api/chat", { method: "POST", body: exact })).text(), /"action":"EDIT"/);
  assert.equal((await request("/api/chat", { method: "POST", body: exact })).status, 409);
  const detail = await request("/api/chat/tools", { method: "POST", body: { tool: "read", folderId, noteId: capturedId } }); assert.equal((await detail.json()).note.current_version, 2);
  const plan = await request("/api/chat/tools", { method: "POST", body: { tool: "plan", folderId, noteId: capturedId, expectedVersion: 2, allowedAction: "trash", instructions: "Trash chosen note" } });
  const planId = (await plan.json()).plan.id;
  assert.equal((await (await request("/api/notes/" + capturedId)).json()).note.lifecycle, "active");
  assert.equal((await request("/api/chat/tools", { method: "POST", body: { tool: "apply", planId } })).status, 200);
  assert.equal((await (await request("/api/notes/" + capturedId)).json()).note.lifecycle, "trashed");
  assert.equal((await request("/api/chat", { method: "PATCH", body: { action: "update", id: sessionId, title: "Renamed fixture", archived: true } })).status, 200);
  assert.equal((await request("/api/chat", { method: "POST", body: { ...input, messages: [{ role: "user", content: "Blocked in archive" }] } })).status, 404);
  assert.equal((await request("/api/chat?sessionId=" + sessionId, { method: "DELETE" })).status, 200);
  assert.equal((await request("/api/chat?sessionId=" + sessionId)).status, 404);
});
test("all remaining feature surfaces use PostgreSQL under the owner session", async () => {
  for (const route of ["/api/insights/dashboard", "/api/insights/forgotten", "/api/insights/weak-areas", "/api/vector/status", "/api/slash-commands"]) assert.equal((await request(route)).status, 200, route);
  assert.equal((await request("/api/settings", { method: "POST", body: { chatModel: "test/model" } })).status, 200);
  assert.equal((await request("/api/settings")).status, 200);
  const preferences = await (await request("/api/settings")).json();
  assert.equal(preferences.effective.embeddingDimensions, 1536); assert.equal(preferences.effective.hasApiKey, false);
  assert.equal("apiKey" in preferences.effective, false); assert.equal(preferences.usage.requests, 0);
  assert.equal((await request("/api/settings", { method: "POST", body: { embeddingDimensions: 768 } })).status, 400);
  const check = await request("/api/settings/test", { method: "POST", body: { live: true, task: "embeddings" } });
  assert.equal((await check.json()).result.code, "AI_UNAVAILABLE");
  assert.equal((await request("/api/vector/reindex", { method: "POST", body: { action: "retry" } })).status, 200);
  const lc = await request("/api/leetcode", { method: "POST", body: { problemName: "Problem without invented complexity", pattern: "Arrays", difficulty: "Easy", approach: "My supplied approach" } }); assert.equal(lc.status, 200);
  const problems = (await (await request("/api/leetcode")).json()).problems; assert.equal(problems.length, 1);
  const lcNote = await request("/api/knowledge/" + problems[0].file_path); assert.doesNotMatch((await lcNote.json()).content, /O\(N\)|O\(1\)/);
  const review = await request("/api/review", { method: "POST", body: { action: "start", mode: "quick" } }); assert.equal(review.status, 200); const session = await review.json();
  assert.equal((await request("/api/review", { method: "POST", body: { sessionId: session.sessionId, memoryId: session.items[0].id, remembered: true } })).status, 200);
  const quiz = await request("/api/quiz", { method: "POST", body: { action: "generate", topic: "no_such_topic", count: 1 } }); assert.equal(quiz.status, 200); assert.deepEqual((await quiz.json()).questions, []);
  const chat = await request("/api/chat", { method: "POST", body: { mode: "save", messages: [{ role: "user", content: "Exact chat capture." }] } }); assert.equal(chat.status, 200); const events = await chat.text(); assert.match(events, /"saved":true/);
  assert.equal((await request("/api/chat")).status, 200);
  const failed = await request("/api/chat", { method: "POST", body: { mode: "generate", messages: [{ role: "user", content: "No provider test." }] } }); assert.match(await failed.text(), /"type":"error"/);
});
test("attachments and Markdown imports require auth and retain exact original bytes", async () => {
  const data = "Exact attachment\r\n", uploaded = await fetch(base + "/api/attachments", { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "text/plain", "X-File-Name": "original.txt" }, body: data });
  assert.equal(uploaded.status, 201); attachmentId = (await uploaded.json()).attachment.id;
  const downloaded = await request("/api/attachments/" + attachmentId); assert.equal(await downloaded.text(), data); assert.match(downloaded.headers.get("content-disposition")!, /attachment/);
  const form = new FormData(); form.set("file", new File(["# Imported HTTP\nFull body"], "http.md"));
  const imported = await fetch(base + "/api/import", { method: "POST", headers: { Cookie: cookie, Origin: base, "Idempotency-Key": randomUUID() }, body: form }); assert.equal(imported.status, 200, await imported.clone().text());
  assert.equal((await (await request("/api/knowledge/http.md")).json()).content, "# Imported HTTP\nFull body");
});

test("P08/P09 search exposes exact version evidence, graph is private, and empty Ask abstains without saving", async () => {
  await login();
  const folderResponse = await request("/api/folders", { method: "POST", body: { name: "HTTP retrieval" } });
  assert.equal(folderResponse.status, 200, await folderResponse.clone().text());
  const folder = (await folderResponse.json()).folder;
  const created = await request("/api/knowledge", { method: "POST", body: { action: "create", folderId: folder.id, title: "HTTP evidence", body: "Current http-evidence-token in a late source paragraph." } });
  assert.equal(created.status, 201, await created.clone().text());
  const searched = await request("/api/search?q=http-evidence-token&method=keyword&folderId=" + folder.id); assert.equal(searched.status, 200);
  const result = await searched.json(); assert.equal(result.passages.length, 1);
  const evidence = await request(result.passages[0].url); assert.equal(evidence.status, 200); assert.match(await evidence.text(), /Current active version/);
  assert.equal((await request("/graph?folderId=" + folder.id)).status, 200);
  assert.equal((await request("/api/graph?folderId=" + folder.id)).status, 200);
  assert.equal((await request("/api/graph", { method: "POST", body: { action: "alias" }, auth: false })).status, 401);
  assert.equal((await request("/api/graph", { method: "POST", body: { action: "alias" }, origin: "https://foreign.example" })).status, 403);
  const before = (await storage.pool.query("SELECT count(*)::int AS count FROM notes")).rows[0].count;
  const ask = await request("/api/chat", { method: "POST", body: { folderId: folder.id, mode: "ask", messages: [{ role: "user", content: "unmatched-fixture-unknown" }] } });
  const stream = await ask.text(); assert.match(stream, /sufficient supporting evidence/); assert.match(stream, /"type":"complete"/);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS count FROM notes")).rows[0].count, before);
});
test("restart retains notes, versions, sources, settings and the authenticated session", async () => {
  const before = (await storage.pool.query("SELECT count(*)::int AS n FROM note_versions")).rows[0].n;
  await stop(); await start();
  const response = await request("/api/notes/" + noteId + "?history=1"); assert.equal(response.status, 200); assert.equal((await response.json()).note.current_version, 3);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM note_versions")).rows[0].n, before);
  assert.equal((await (await request("/api/settings")).json()).settings.chatModel, "test/model");
  assert.equal((await request("/api/attachments/" + attachmentId)).status, 200);
});
test("expired, revoked and recovered sessions lose API and download access", async () => {
  await storage.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await request("/api/knowledge")).status, 401); assert.equal((await request("/api/export")).status, 401);
  await login(); await recoverOwner(storage.pool, { email, password: "recovered-" + password });
  assert.equal((await request("/api/attachments/" + attachmentId)).status, 401);
  await login("recovered-" + password);
  const signedOut = await request("/api/auth/sign-out", { method: "POST", body: {} }); assert.equal(signedOut.status, 200);
  assert.equal((await request("/api/settings")).status, 401);
});
test("login throttle persists across requests and cannot be bypassed with forwarded IPs", async () => {
  await storage.pool.query("DELETE FROM auth_login_throttle");
  for (let i = 0; i < 10; i++) assert.equal((await request("/api/auth/sign-in/email", { method: "POST", auth: false, body: { email, password: "incorrect-password" }, headers: { "X-Forwarded-For": "192.0.2." + i } })).status, 401);
  const blocked = await request("/api/auth/sign-in/email", { method: "POST", auth: false, body: { email, password: "recovered-" + password }, headers: { "X-Forwarded-For": "198.51.100.1" } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("retry-after"), "60");
  assert.ok(!logs.includes(password) && !logs.includes(secret), "credentials must not appear in server logs");
});

test("P10/P11 private HTTP practice, saved feedback and import preview", async () => {
  await recoverOwner(storage.pool, { email, password }); // Isolate from the preceding recovery/throttle scenarios.
  await login();
  assert.equal((await request("/api/study", { auth: false })).status, 401);
  const model: AIProvider = { id: "http/synthetic", name: "Synthetic", isAvailable: async () => true, chat: async () => "", async *chatStream() {},
    async chatStructured(messages, schema) {
      return schema.parse(messages[0].content.startsWith("Independently") ? { supported: true, atomic: true, unambiguous: true } :
        { supported: true, prompt: "What ordering does the queue use?", answer: "FIFO", options: [], quote: "Queues use FIFO.", explanation: "The note states FIFO.", criteria: ["FIFO"] });
    } };
  const folder = await asMaintenance(async () => {
    const k = new KnowledgeService(storage.pool), folder = await k.createFolder({ name: "HTTP study" });
    await k.execute({ action: "create", folderId: folder.id, title: "Queue", body: "Queues use FIFO.", idempotencyKey: randomUUID() });
    await new PracticeService(storage.pool).act({ action: "generate", folderId: folder.id, kind: "recall", query: "", count: 1 }, randomUUID(), model);
    return folder;
  });
  const started = await request("/api/study", { method: "POST", body: { action: "start", folderId: folder.id, mode: "due", count: 1 } });
  assert.equal(started.status, 200, await started.clone().text()); const { sessionId } = await started.json();
  let session = await (await request("/api/study?sessionId=" + sessionId)).json(); const questionId = session.questions[0].id;
  assert.equal(session.questions[0].answerKey, undefined);
  assert.equal((await request("/api/study", { method: "POST", body: { action: "reveal", sessionId, questionId } })).status, 200);
  const token = randomUUID(), body = { action: "answer", sessionId, questionId, rating: 2 };
  assert.equal((await request("/api/study", { method: "POST", key: token, body })).status, 200);
  assert.equal((await request("/api/study", { method: "POST", key: token, body })).status, 200);
  session = await (await request("/api/study?sessionId=" + sessionId)).json(); assert.equal(session.score, 1); assert.equal(session.questions[0].answerKey, "FIFO");
  assert.equal((await request("/api/quiz", { method: "POST", body: { sessionId, questionId, answer: "FIFO" } })).status, 409);
  const form = new FormData(); form.set("file", new File(["class Queue {}"], "Queue.java")); form.set("folderId", folder.id); form.set("action", "preview");
  const preview = await fetch(base + "/api/import", { method: "POST", headers: { Cookie: cookie, Origin: base, "Idempotency-Key": randomUUID() }, body: form });
  assert.equal(preview.status, 200); const data = await preview.json(); assert.equal(data.items[0].status, "new");
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM notes WHERE folder_id=$1", [folder.id])).rows[0].n, 1);
});
