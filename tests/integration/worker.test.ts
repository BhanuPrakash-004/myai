import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { runOnce, Logger } from "graphile-worker";
import { createStorage } from "../../src/lib/storage/client";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { asMaintenance } from "../../src/lib/storage/access";
import { KnowledgeService } from "../../src/lib/storage/knowledge";
import { SettingsService } from "../../src/lib/storage/settings";
import { UsageService } from "../../src/lib/storage/usage";
import { EmbeddingProfiles } from "../../src/lib/storage/embedding-profiles";
import { runStage, taskRegistry, type StageHandler, type IndexJob } from "../../src/lib/worker/runtime";
import { recoverInterrupted, requeue } from "../../src/lib/worker/admin";

const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!url.pathname.startsWith("/myai_test")) throw new Error("Use an isolated test database.");
const admin = new Pool({ connectionString: url.toString() }), name = "myai_test_" + randomUUID().replaceAll("-", "");
let storage: ReturnType<typeof createStorage>, pool: Pool, knowledge: KnowledgeService, settings: SettingsService;
const run = <T>(work: () => T) => asMaintenance(work);
before(async () => {
  await admin.query('CREATE DATABASE "' + name + '"'); url.pathname = "/" + name;
  storage = createStorage({ DATABASE_URL: url.toString(), DATABASE_POOL_SIZE: "8" }); pool = storage.pool;
  await migrateDatabase(pool); knowledge = new KnowledgeService(pool); settings = new SettingsService(pool);
  await pool.query("CREATE TABLE fixture_projections(note_id uuid PRIMARY KEY, body text NOT NULL)");
  await run(() => settings.save({ aiIndexingEnabled: true, chatModel: "test/chat", structuredModel: "test/structured" }));
});
after(async () => {
  if (storage) await storage.close();
  await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)'); await admin.end();
});
async function note(): Promise<IndexJob> {
  const r = await knowledge.execute({ action: "create", title: "Worker fixture", body: "Original source", idempotencyKey: randomUUID() });
  return { noteId: r.noteId, noteVersion: 1, pipelineVersion: "v1" };
}
function handler(prepare: StageHandler["prepare"] = async (input) => input.body): StageHandler {
  return { version: "test-v1", prepare, async publish(client, result, input) {
    await client.query("INSERT INTO fixture_projections(note_id,body) VALUES($1,$2)", [input.noteId, result]);
  } };
}
async function state(job: IndexJob) { return (await pool.query("SELECT * FROM processing_state WHERE note_id=$1 AND note_version=$2 AND stage='chunks'", [job.noteId, job.noteVersion])).rows[0]; }

test("duplicate stage delivery publishes once and version changes fence an in-flight result", () => run(async () => {
  const job = await note(); let release!: () => void, started!: () => void, calls = 0;
  const began = new Promise<void>((resolve) => { started = resolve; }), wait = new Promise<void>((resolve) => { release = resolve; });
  const stage = handler(async (input) => { calls++; started(); await wait; return input.body; });
  const first = runStage(pool, { chunks: stage }, "chunks", job);
  await began;
  assert.equal(await runStage(pool, { chunks: stage }, "chunks", job), "busy"); release();
  assert.equal(await first, "ready");
  assert.equal(await runStage(pool, { chunks: stage }, "chunks", job), "ready"); assert.equal(calls, 1);
  const changed = await note();
  assert.equal(await runStage(pool, { chunks: handler(async () => {
    await knowledge.execute({ action: "edit", noteId: changed.noteId, expectedVersion: 1, title: "Changed", body: "New source", idempotencyKey: randomUUID() });
    return "obsolete result";
  }) }, "chunks", changed), "stale");
  assert.equal((await pool.query("SELECT * FROM fixture_projections WHERE note_id=$1", [changed.noteId])).rowCount, 0);
  assert.equal((await state(changed)).status, "stale");
}));

test("publish failure rolls back projections and readiness; attempts are bounded and explicitly retryable", () => run(async () => {
  const job = await note(), broken = handler();
  const publish = broken.publish;
  broken.publish = async (...args) => { await publish(...args); throw new Error("private source must not reach job errors"); };
  await assert.rejects(runStage(pool, { chunks: broken }, "chunks", job), /STAGE_FAILED/);
  assert.equal((await pool.query("SELECT * FROM fixture_projections WHERE note_id=$1", [job.noteId])).rowCount, 0);
  assert.equal((await state(job)).status, "failed");
  await pool.query("UPDATE processing_state SET attempts=8 WHERE note_id=$1 AND stage='chunks'", [job.noteId]);
  assert.equal(await runStage(pool, { chunks: handler() }, "chunks", job), "blocked");
  await requeue(pool, { action: "retry", noteId: job.noteId });
  assert.equal(await runStage(pool, { chunks: handler() }, "chunks", job), "ready");
}));

test("model/config changes invalidate in-flight work; disabled and absent handlers never claim readiness", () => run(async () => {
  const job = await note();
  const result = await runStage(pool, { chunks: handler(async () => {
    await settings.save({ structuredModel: "test/new-structured" }); return "stale configuration";
  }) }, "chunks", job);
  assert.equal(result, "stale"); assert.equal((await state(job)).status, "stale");
  const blocked = await note();
  assert.equal(await runStage(pool, {}, "chunks", blocked), "blocked");
  assert.equal((await state(blocked)).error_code, "HANDLER_NOT_IMPLEMENTED");
  await settings.save({ aiIndexingEnabled: false });
  assert.equal(await runStage(pool, { chunks: handler() }, "chunks", blocked), "ready");
  assert.equal(await runStage(pool, { embeddings: handler() }, "embeddings", blocked), "blocked");
  assert.equal((await pool.query("SELECT error_code FROM processing_state WHERE note_id=$1 AND stage='embeddings'", [blocked.noteId])).rows[0].error_code, "AI_DISABLED");
  await settings.save({ aiIndexingEnabled: true });
}));

test("killed worker releases the stage lock and recovery queues current work without accepting partial output", () => run(async () => {
  const job = await note();
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/worker-crash.ts", job.noteId], {
    windowsHide: true, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Crash fixture did not claim work")), 15000);
      child.stdout!.on("data", (data) => { output += data; if (output.includes("CLAIMED")) { clearTimeout(timer); resolve(); } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); if (!output.includes("CLAIMED")) reject(new Error("Crash fixture exited before claim")); });
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
    assert.equal((await state(job)).status, "processing");
    await pool.query("UPDATE processing_state SET heartbeat_at=now()-interval '3 minutes' WHERE note_id=$1 AND stage='chunks'", [job.noteId]);
    assert.equal(await recoverInterrupted(pool), 1);
    assert.equal((await state(job)).error_code, "RECOVERED");
    assert.equal(await runStage(pool, { chunks: handler() }, "chunks", job), "ready");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM fixture_projections WHERE note_id=$1", [job.noteId])).rows[0].n, 1);
  } finally { if (child.exitCode === null) child.kill("SIGKILL"); }
}));

test("Graphile consumes an explicitly empty registry without fabricating missing projection handlers", () => run(async () => {
  const job = await note();
  await runOnce({ pgPool: pool, taskList: taskRegistry(pool, {}), noHandleSignals: true, logger: new Logger(() => () => {}) });
  assert.equal((await state(job)).status, "pending");
  assert.equal((await state(job)).error_code, "HANDLER_NOT_IMPLEMENTED");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM graphile_worker.jobs")).rows[0].n, 0);
}));

test("usage admission is atomic across concurrent calls and reserves unknown usage without exposing content", () => run(async () => {
  const profiles = new EmbeddingProfiles(pool), profile = { model: "test/embedding", dimensions: 1536, normalization: "provider" as const, chunkerVersion: "v1" };
  const profileId = await profiles.record(profile);
  assert.equal(await profiles.record(profile), profileId);
  assert.equal((await pool.query("SELECT active FROM embedding_profiles WHERE id=$1", [profileId])).rows[0].active, false);
  await assert.rejects(profiles.record({ ...profile, dimensions: 768 }));
  const ledger = new UsageService(pool, { dailyRequestLimit: 2, dailyTokenBudget: 1000 });
  const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => ledger.start("chat", "test/chat", 400)));
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 2);
  const id = (attempts.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<string>).value;
  await ledger.finish(id, "completed", { tokens: 12, cost: 0.001, requestId: "gen-fixture" }, 25);
  await ledger.finish(id, "completed", { tokens: 9999 }, 100);
  const summary = await ledger.summary();
  assert.equal(summary.requests, 2); assert.equal(Number(summary.budgetedTokens), 412); assert.equal(summary.unreportedRequests, 1);
  assert.equal(Number(summary.reportedTokens), 12);
}));

test("provider concurrency is installation-wide and expired slots keep their budget reservations", () => run(async () => {
  await pool.query("DELETE FROM usage_events");
  const ledger = new UsageService(pool, { dailyRequestLimit: 100, dailyTokenBudget: 100000 });
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => ledger.start("chat", "test/chat", 10)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 4);
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, "AI_BUSY");
  await pool.query("UPDATE usage_events SET created_at=now()-interval '121 seconds'");
  await ledger.start("chat", "test/chat", 10);
  assert.equal(Number((await ledger.summary()).budgetedTokens), 50);
}));
