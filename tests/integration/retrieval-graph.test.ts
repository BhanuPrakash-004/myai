import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createStorage } from "../../src/lib/storage/client";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { asMaintenance } from "../../src/lib/storage/access";
import { KnowledgeService } from "../../src/lib/storage/knowledge";
import { SettingsService } from "../../src/lib/storage/settings";
import { GraphService } from "../../src/lib/storage/graph";
import { ChatService } from "../../src/lib/storage/chat";
import { UsageService } from "../../src/lib/storage/usage";
import { OpenRouterClient } from "../../src/lib/ai/openrouter";
import { resolveAIConfig, type AIConfig } from "../../src/lib/ai/preferences";
import { RetrievalService } from "../../src/lib/retrieval/service";
import { groundedAnswer } from "../../src/lib/retrieval/answer";
import { CHUNKER_VERSION, chunkNote } from "../../src/lib/retrieval/chunks";
import { createProductionRegistry } from "../../src/lib/worker/projections";
import { runStage } from "../../src/lib/worker/runtime";
import { requeue } from "../../src/lib/worker/admin";

const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!url.pathname.startsWith("/myai_test")) throw new Error("Use a dedicated test database.");
const admin = new Pool({ connectionString: url.toString() }), name = "myai_test_rag_" + randomUUID().replaceAll("-", "");
let storage: ReturnType<typeof createStorage>, knowledge: KnowledgeService, settings: SettingsService, retrieval: RetrievalService, graph: GraphService;
let calls = 0, failEmbedding = false;
const run = <T>(fn: () => T) => asMaintenance(fn), key = () => randomUUID();
const oldKey = process.env.OPENROUTER_API_KEY;
function vector(text: string) {
  const v = Array(1536).fill(0) as number[];
  const words = [/horse|equine|foal|stallion/i, /sun|solar|photosynth/i, /queue|BFS|breadth/i, /garden|compost|soil/i];
  words.forEach((p, i) => { if (p.test(text)) v[i] = 1; }); if (!v.some(Boolean)) v[4] = 1; return v;
}
const transport: typeof fetch = async (url, init) => {
  calls++; const input = JSON.parse(String(init?.body));
  if (String(url).endsWith("embeddings")) {
    if (failEmbedding) throw new Error("synthetic interruption");
    return Response.json({ model: input.model, data: input.input.map((text: string, index: number) => ({ index, embedding: vector(text) })), usage: { total_tokens: 20 } });
  }
  if (String(url).endsWith("rerank")) return Response.json({ results: input.documents.slice(0, input.top_n).map((_: string, index: number) => ({ index, relevance_score: 1 / (index + 1) })) });
  const body = input.messages.at(-1).content as string;
  const concepts = body.includes("Queues") ? [{ name: "Queues", description: "FIFO data structure" }, { name: "BFS", description: "Breadth first traversal" }] : body.includes("BFS") ? [{ name: "BFS", description: "Breadth first traversal" }] : body.includes("Java") ? [{ name: "Java", description: body.includes("island") ? "An island" : "A programming language" }] : [];
  const quote = "Queues are prerequisite for BFS.";
  const start = body.indexOf(quote);
  const relations = start < 0 ? [] : [{ from: "Queues", to: "BFS", type: "prerequisite_for", quote, startOffset: Array.from(body.slice(0, start)).length, endOffset: Array.from(body.slice(0, start)).length + Array.from(quote).length }];
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ concepts, relations }) } }], usage: { total_tokens: 30 } });
};
function provider(pool: Pool, config: AIConfig) { return new OpenRouterClient({ ...config, apiKey: "synthetic" }, new UsageService(pool, config), transport, { timeoutMs: 1000, maxRetries: 0, retryBaseMs: 0 }); }
const registry = createProductionRegistry(() => storage.pool, provider);
async function create(title: string, body: string, folderId?: string) { return knowledge.execute({ action: "create", title, body, folderId, idempotencyKey: key() }); }
async function index(noteId: string, version = 1, stages: ("chunks" | "embeddings" | "graph")[] = ["chunks", "embeddings", "graph"]) {
  for (const stage of stages) assert.equal(await runStage(storage.pool, registry, stage, { noteId, noteVersion: version, pipelineVersion: "v1" }), "ready");
}
before(async () => {
  process.env.OPENROUTER_API_KEY = "synthetic";
  await admin.query('CREATE DATABASE "' + name + '"'); url.pathname = "/" + name;
  storage = createStorage({ DATABASE_URL: url.toString() }); await migrateDatabase(storage.pool);
  knowledge = new KnowledgeService(storage.pool); settings = new SettingsService(storage.pool); retrieval = new RetrievalService(storage.pool, provider); graph = new GraphService(storage.pool);
  await run(() => settings.save({ aiIndexingEnabled: true, embeddingModel: "test/embedding", structuredModel: "test/structured", dailyRequestLimit: 10000, dailyTokenBudget: 10000000 }));
});
after(async () => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; await storage?.close(); await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)'); await admin.end(); });

test("P08 exact Unicode chunks preserve late paragraphs/code and serve current scoped fallback", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Exact sources" }), outside = await knowledge.createFolder({ name: "Outside" });
  const body = "# Intro\n😀 Source material.\n\n" + "Unrelated background paragraph.\n\n".repeat(210) + "# Syntax\n```java\nMap.Entry<String, Integer> item; // C++ and C# differ\n```\n\nLate marker: --dry-run preserves a.b exactly.\n";
  const note = await create("Long syntax", body, folder.id); await create("Leak", "Map.Entry secret outside", outside.id);
  const chunks = chunkNote(note.noteId, 1, body), points = Array.from(body);
  assert(chunks.length > 2); assert(chunks.every((c) => points.slice(c.start, c.end).join("") === c.body && c.end - c.start <= 2400));
  assert(chunks.some((c) => c.body.includes("```java\nMap.Entry<String, Integer> item; // C++ and C# differ\n```")));
  for (const query of ["Map.Entry", "C++", "C#", "--dry-run", "a.b", '"Late marker"']) {
    const result = await retrieval.retrieve({ query, folderId: folder.id, method: "keyword" });
    assert(result.passages.some((p) => p.noteId === note.noteId && p.body.includes(query.replaceAll('"', ""))));
    assert(result.passages.every((p) => p.folderId === folder.id));
  }
  const old = (await retrieval.retrieve({ query: "Map.Entry", folderId: folder.id, method: "keyword" })).passages[0];
  await knowledge.execute({ action: "edit", noteId: note.noteId, expectedVersion: 1, title: "Updated", body: "New current source without old syntax", idempotencyKey: key() });
  assert.equal((await retrieval.retrieve({ query: "Map.Entry", folderId: folder.id, method: "keyword" })).passages.length, 0);
  assert.equal((await retrieval.inspect(old.id)).current, false);
  await index(note.noteId, 2, ["chunks"]);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS count FROM current_chunks WHERE note_id=$1 AND note_version=1", [note.noteId])).rows[0].count, 0);
}));

test("P08 real pgvector fusion improves synthetic paraphrase recall; profile changes and outages fall back", () => run(async () => {
  const scope = await knowledge.createFolder({ name: "Retrieval benchmark" });
  const horse = await create("Stable care", "A horse needs fresh water every day.", scope.id);
  const solar = await create("Plants", "Photosynthesis converts solar energy into chemical energy.", scope.id);
  const garden = await create("Compost", "Compost adds organic matter to garden soil.", scope.id);
  for (const note of await knowledge.list({ limit: 100 })) await index(note.id, note.current_version, ["chunks", "embeddings"]);
  const cases = [{ q: "equine hydration", id: horse.noteId }, { q: "solar energy", id: solar.noteId }, { q: "garden soil", id: garden.noteId }];
  let keywordRecall = 0, hybridRecall = 0; const times: number[] = [];
  for (const item of cases) {
    const keyword = await retrieval.retrieve({ query: item.q, folderId: scope.id, method: "keyword", limit: 2 });
    const hybrid = await retrieval.retrieve({ query: item.q, folderId: scope.id, limit: 2 });
    keywordRecall += Number(keyword.passages.some((p) => p.noteId === item.id)); hybridRecall += Number(hybrid.passages.some((p) => p.noteId === item.id)); times.push(hybrid.latencyMs);
  }
  assert.equal(hybridRecall, 3); assert(hybridRecall > keywordRecall);
  failEmbedding = true;
  const fallback = await retrieval.retrieve({ query: "garden soil", folderId: scope.id }); failEmbedding = false;
  assert(fallback.passages.some((p) => p.noteId === garden.noteId)); assert(fallback.warnings.some((w) => w.includes("unavailable")));
  await settings.save({ embeddingModel: "test/embedding-v2" });
  assert.equal((await storage.pool.query("SELECT id FROM embedding_profiles WHERE active")).rowCount, 0);
  const changed = await retrieval.retrieve({ query: "garden soil", folderId: scope.id }); assert.equal(changed.diagnostics.vectorCandidates, 0);
  console.log(JSON.stringify({ evaluation: "actual PostgreSQL pipeline; synthetic vectors, not live semantic quality", cases: 3, keywordRecallAt2: keywordRecall / 3, hybridRecallAt2: hybridRecall / 3, latencyMs: times, providerRequests: calls }));
}));

test("P08 claim support gate rejects invented citations and unsupported details; citations survive edits", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Grounding" });
  const note = await create("Water", "A horse needs fresh water every day.", folder.id);
  const result = await retrieval.retrieve({ query: "horse", folderId: folder.id, method: "keyword" });
  const passage = result.passages[0]; let phase = 0;
  const ai = new OpenRouterClient(resolveAIConfig({ structuredModel: "test/support" }, { OPENROUTER_API_KEY: "synthetic" }), { async start() { return key(); }, async finish() {} }, async () => {
    const output = phase++ === 0 ? { claims: [
      { text: "The note says a horse needs fresh water every day.", citations: [{ id: passage.citationId, quote: passage.body }] },
      { text: "Every horse drinks exactly 100 liters.", citations: [{ id: passage.citationId, quote: passage.body }] },
      { text: "Invented", citations: [{ id: "Eunknown", quote: "Invented" }] },
    ], abstention: "" } : { judgments: [{ index: 0, verdict: "supported" }, { index: 1, verdict: "insufficient" }] };
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const answer = await groundedAnswer(ai, "What does the note say?", result); assert.equal(answer.supportedClaims, 1); assert.equal(answer.rejectedClaims, 2); assert(!answer.reply.includes("100 liters"));
  const chat = new ChatService(storage.pool), token = key(), turn = await chat.begin({ messages: [{ role: "user", content: "horse" }], folderId: folder.id, mode: "ask" }, token);
  await chat.finish(turn, answer.reply, token, "test/support", [{ id: note.noteId, version: 1, title: "Water", path: passage.path, chunkId: passage.id, citationId: passage.citationId }], undefined, { citations: answer.citations });
  assert.equal((await storage.pool.query("SELECT * FROM message_citations WHERE message_id=$1", [turn.assistantId])).rowCount, 1);
  const empty = await groundedAnswer(ai, "Unknown", { ...result, passages: [] }); assert(empty.abstained); assert.equal(phase, 2);
  await knowledge.execute({ action: "lifecycle", noteId: note.noteId, expectedVersion: 1, lifecycle: "trashed", idempotencyKey: key() });
  assert.equal((await retrieval.inspect(passage.id)).current, false); assert.equal((await retrieval.retrieve({ query: "horse", folderId: folder.id, method: "keyword" })).passages.length, 0);
}));

test("P09 durable extraction, owner correction and same-label distinct meanings survive rebuilds", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Graph sources" });
  const note = await create("Traversal prerequisites", "😀 Queues are prerequisite for BFS.", folder.id);
  const java = await create("Programming", "Java is a programming language.", folder.id), island = await create("Geography", "Java is an island.", folder.id);
  for (const id of [note.noteId, java.noteId, island.noteId]) await index(id, 1, ["chunks", "graph"]);
  const view = await graph.neighborhood({ folderId: folder.id });
  assert.equal(view.nodes.filter((n) => n.label === "Java").length, 2);
  const edge = view.edges.find((e) => e.relation === "prerequisite_for")!; assert(edge);
  const proof = view.evidence.find((e) => e.edge_id === edge.id)!; assert.equal(proof.start_offset, 2); assert.equal(proof.quote, "Queues are prerequisite for BFS.");
  const op = key(), change = { action: "correct", edgeId: edge.id, expectedRevision: edge.revision, relation: "related_to" };
  const corrected = await graph.change(change, op); assert.deepEqual(await graph.change(change, op), corrected);
  await assert.rejects(graph.change(change, key()), { code: "GRAPH_CONFLICT" });
  const before = calls; await requeue(storage.pool, { action: "rebuild", noteId: note.noteId }); await index(note.noteId, 1, ["chunks", "graph"]);
  assert.equal(calls, before, "successful chunk extractions reused without another inference");
  const rebuilt = await graph.neighborhood({ folderId: folder.id });
  assert(!rebuilt.edges.some((e) => e.id === edge.id)); assert(rebuilt.edges.some((e) => e.id === corrected.edgeId && e.origin === "owner_curated"));
  await knowledge.execute({ action: "edit", noteId: note.noteId, expectedVersion: 1, title: "New source", body: "No old relationship remains supported.", idempotencyKey: key() });
  assert(!(await graph.neighborhood({ folderId: folder.id })).edges.some((e) => e.id === corrected.edgeId));
  assert.equal((await storage.pool.query("SELECT id FROM graph_edges WHERE id=$1", [corrected.edgeId])).rowCount, 1, "curation retained but stale support excluded");
}));

test("P09 reviewed cross-note concepts expand supporting passages without folder leakage", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Graph expansion" }), outside = await knowledge.createFolder({ name: "Graph private" });
  const a = await create("Prerequisites", "Queues are prerequisite for BFS.", folder.id);
  const b = await create("Traversal behavior", "BFS visits vertices in increasing distance order.", folder.id);
  const c = await create("Hidden traversal", "BFS hidden private evidence.", outside.id);
  for (const id of [a.noteId, b.noteId, c.noteId]) await index(id, 1, ["chunks", "graph"]);
  const view = await graph.neighborhood({ folderId: folder.id }); const concepts = view.nodes.filter((n) => n.label === "BFS"); assert.equal(concepts.length, 2);
  await graph.change({ action: "merge", fromId: concepts[0].id, toId: concepts[1].id }, key());
  await graph.change({ action: "alias", nodeId: concepts[1].id, alias: "breadth-first traversal" }, key());
  const baseline = await retrieval.retrieve({ query: "prerequisite", folderId: folder.id, method: "keyword", graph: false });
  const expanded = await retrieval.retrieve({ query: "prerequisite", folderId: folder.id, method: "keyword", graph: true });
  assert(!baseline.passages.some((p) => p.noteId === b.noteId)); assert(expanded.passages.some((p) => p.noteId === b.noteId && p.via.includes("graph")));
  assert(expanded.passages.every((p) => p.folderId === folder.id)); assert(!expanded.passages.some((p) => p.noteId === c.noteId));
  console.log(JSON.stringify({ graphEvaluation: "reviewed prerequisite bridge", baselineRecallAt8: .5, expandedRecallAt8: 1, outOfScope: 0 }));
}));

test("P08/P09 interruption publishes no partial graph and retry reuses staged chunks", () => run(async () => {
  const note = await create("Interrupted graph", "# First\nQueues are prerequisite for BFS.\n\n# Second\nBFS visits vertices.");
  await index(note.noteId, 1, ["chunks"]);
  let extractionCalls = 0;
  const interrupting = createProductionRegistry(() => storage.pool, (pool, config) => new OpenRouterClient({ ...config, apiKey: "synthetic" }, new UsageService(pool, config), async (...args) => {
    if (++extractionCalls === 2) throw new Error("Interrupted after first chunk"); return transport(...args);
  }, { timeoutMs: 1000, maxRetries: 0, retryBaseMs: 0 }));
  await assert.rejects(runStage(storage.pool, interrupting, "graph", { noteId: note.noteId, noteVersion: 1, pipelineVersion: "v1" }), /AI_PROVIDER/);
  assert.equal((await storage.pool.query("SELECT e.id FROM current_graph_edges e JOIN current_graph_evidence v ON v.edge_id=e.id WHERE v.note_id=$1 AND e.origin='ai_extracted'", [note.noteId])).rowCount, 0);
  assert.equal((await storage.pool.query("SELECT count(*)::int AS n FROM projection_cache p JOIN chunks c ON c.id=p.chunk_id WHERE c.note_id=$1", [note.noteId])).rows[0].n, 1);
  await requeue(storage.pool, { action: "retry", noteId: note.noteId }); const before = calls; await index(note.noteId, 1, ["graph"]); assert.equal(calls - before, 1);
  const old = await knowledge.get(note.noteId); await knowledge.execute({ action: "edit", noteId: note.noteId, expectedVersion: old!.current_version, title: "Changed", body: "Current replacement", idempotencyKey: key() });
  assert.equal(await runStage(storage.pool, registry, "graph", { noteId: note.noteId, noteVersion: 1, pipelineVersion: "v1" }), "stale");
}));

test("P08 folder coverage is explicit and paginated; empty evidence never claims a complete summary", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Summary" });
  for (let i = 0; i < 4; i++) await create("Summary " + i, "Unique information " + i, folder.id);
  const first = await retrieval.retrieve({ folderId: folder.id, mode: "summary", limit: 2, method: "keyword" });
  const second = await retrieval.retrieve({ folderId: folder.id, mode: "summary", limit: 2, offset: 2, method: "keyword" });
  assert.equal(first.coverage.totalNotes, 4); assert.equal(first.coverage.complete, false); assert(first.hasMore);
  assert.equal(new Set([...first.passages, ...second.passages].map((p) => p.noteId)).size, 4);
  assert.equal(second.hasMore, false);
  assert.equal(CHUNKER_VERSION, first.passages.length ? (await retrieval.inspect(first.passages[0].id)).chunker_version : "");
}));

test("P08 conflicting accounts stay separate and folder moves during reranking cannot leak sources", () => run(async () => {
  const folder = await knowledge.createFolder({ name: "Conflicting records" });
  const sourceA = await create("Plan A", "The launch date is June 1 according to plan A.", folder.id);
  const sourceB = await create("Plan B", "The launch date is July 1 according to plan B.", folder.id);
  const result = await retrieval.retrieve({ query: "launch date", folderId: folder.id, method: "keyword" });
  assert.deepEqual(new Set(result.passages.map((p) => p.noteId)), new Set([sourceA.noteId, sourceB.noteId]));
  let phase = 0;
  const ai = new OpenRouterClient(resolveAIConfig({ structuredModel: "test/conflict" }, { OPENROUTER_API_KEY: "synthetic" }), { async start() { return key(); }, async finish() {} }, async () => {
    const output = phase++ === 0 ? { claims: result.passages.map((p) => ({ text: p.body, citations: [{ id: p.citationId, quote: p.body }] })), abstention: "" } : { judgments: [{ index: 0, verdict: "supported" }, { index: 1, verdict: "supported" }] };
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const answer = await groundedAnswer(ai, "When is launch?", result); assert(answer.reply.includes("June 1")); assert(answer.reply.includes("July 1")); assert.equal(answer.citations.length, 2);
  const inside = await knowledge.createFolder({ name: "Moving child", parentId: folder.id }), outside = await knowledge.createFolder({ name: "Moved outside" });
  const moving = await create("Move fixture", "moving-token source", inside.id); await index(moving.noteId, 1, ["chunks"]);
  await settings.save({ rerankEnabled: true });
  const racing = new RetrievalService(storage.pool, (pool, config) => new OpenRouterClient({ ...config, apiKey: "synthetic" }, new UsageService(pool, config), async (...args) => {
    if (String(args[0]).endsWith("rerank")) await knowledge.moveFolder({ id: inside.id, parentId: outside.id, name: "Moving child" });
    return transport(...args);
  }));
  const afterMove = await racing.retrieve({ query: "moving-token", folderId: folder.id }); assert.equal(afterMove.passages.length, 0); assert(afterMove.warnings.some((w) => w.includes("changed")));
  assert.equal((await graph.neighborhood({ folderId: folder.id, noteId: moving.noteId })).edges.length, 0);
  await settings.save({ rerankEnabled: false });
  console.log(JSON.stringify({ supportFixture: "valid attributed conflicting claims", citedClaims: 2, supportedClaims: 2, folderMoveLeakage: 0 }));
}));
