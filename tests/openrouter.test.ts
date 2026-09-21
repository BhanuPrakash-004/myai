import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { OpenRouterClient } from "../src/lib/ai/openrouter";
import { resolveAIConfig } from "../src/lib/ai/preferences";
import { AIContentService } from "../src/lib/ai/content";
import type { Usage, UsageLedger } from "../src/lib/storage/usage";

const config = resolveAIConfig({ chatModel: "test/chat", structuredModel: "test/structured", embeddingModel: "test/embedding", rerankModel: "test/rerank", rerankEnabled: true }, { OPENROUTER_API_KEY: "test-secret" });
class Ledger implements UsageLedger {
  started: { task: string; model: string; reserved: number }[] = [];
  finished: { outcome: string; usage: Usage }[] = [];
  async start(task: string, model: string, reserved: number) { this.started.push({ task, model, reserved }); return String(this.started.length); }
  async finish(_id: string, outcome: string, usage: Usage) { this.finished.push({ outcome, usage }); }
}
function fixture(transport: typeof fetch, overrides = {}) {
  const ledger = new Ledger();
  return { ledger, client: new OpenRouterClient({ ...config, ...overrides }, ledger, transport, { timeoutMs: 1000, maxRetries: 2, retryBaseMs: 1 }) };
}
const prompt = [{ role: "user" as const, content: "Synthetic question" }];
const completion = (content = "Answer", extra = {}) => ({ id: "gen-test", choices: [{ finish_reason: "stop", message: { content } }], usage: { total_tokens: 20, cost: 0.0001 }, ...extra });
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
function sse(parts: string[]) {
  const text = parts.join("\r\n\r\n") + "\r\n\r\n", bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    // Split every UTF-8 byte and CRLF boundary to exercise the actual framing/parser.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
const event = (value: unknown) => "data: " + JSON.stringify(value);

test("chat and structured requests use independent models, strict schemas and local validation", async () => {
  const sent: Record<string, unknown>[] = [];
  const { client, ledger } = fixture(async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init?.redirect, "error"); sent.push(JSON.parse(String(init?.body)));
    return json(completion(sent.length === 1 ? "Answer" : '{"ready":true}'));
  });
  assert.equal(await client.chat(prompt), "Answer");
  assert.deepEqual(await client.chatStructured(prompt, z.object({ ready: z.boolean() }).strict()), { ready: true });
  assert.deepEqual(sent.map((s) => s.model), ["test/chat", "test/structured"]);
  assert.deepEqual(sent[1].provider, { require_parameters: true });
  assert.equal((sent[1].response_format as { type: string }).type, "json_schema");
  assert.equal(ledger.finished[1].usage.tokens, 20);
  const malformed = fixture(async () => json(completion('{"ready":"yes","extra":1}')));
  await assert.rejects(malformed.client.chatStructured(prompt, z.object({ ready: z.boolean() }).strict()), { code: "AI_MALFORMED" });
});

test("fragmented streaming handles comments, Unicode, repeated terminal usage and explicit completion", async () => {
  const { client, ledger } = fixture(async () => sse([
    ": OPENROUTER PROCESSING", event({ choices: [{ index: 0, delta: { content: "😀 Current" }, finish_reason: null }] }),
    event({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    event({ id: "gen-stream", choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { total_tokens: 7, cost: 0.01 } }),
    "data: [DONE]",
  ]));
  const events = await Array.fromAsync(client.stream(prompt));
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "😀 Current");
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(ledger.finished[0].usage.tokens, 7); assert.equal(ledger.finished.length, 1);
});

test("truncation, malformed stream and midstream error never become a completed answer or retry", async () => {
  for (const ending of [
    event({ choices: [{ delta: {}, finish_reason: "length" }] }) + "\n\ndata: [DONE]",
    event({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    event({ error: { message: "secret upstream details" }, choices: [] }),
    "data: {broken",
  ]) {
    let calls = 0;
    const { client } = fixture(async () => { calls++; return sse([event({ choices: [{ delta: { content: "partial" }, finish_reason: null }] }), ending]); });
    const events = await Array.fromAsync(client.stream(prompt));
    assert.equal(events.at(-1)?.type, "failed"); assert.equal(calls, 1);
    assert.equal(JSON.stringify(events).includes("secret upstream"), false);
  }
});

test("provider errors are sanitized; only bounded transient failures retry and respect Retry-After", async () => {
  for (const status of [400, 401, 402, 403]) {
    let calls = 0; const { client } = fixture(async () => { calls++; return json({ error: "test-secret private body" }, status); });
    await assert.rejects(client.chat(prompt), (error: unknown) => error instanceof Error && !error.message.includes("test-secret"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const { client, ledger } = fixture(async () => ++calls < 3 ? json({}, calls === 1 ? 429 : 503, { "Retry-After": "0" }) : json(completion()));
  assert.equal(await client.chat(prompt), "Answer"); assert.equal(calls, 3); assert.equal(ledger.started.length, 3);
  const longWait = fixture(async () => json({}, 429, { "Retry-After": "120" }));
  await assert.rejects(longWait.client.chat(prompt), { code: "AI_RATE_LIMIT" }); assert.equal(longWait.ledger.started.length, 1);
});

test("cancellation, timeout and unavailable AI fail without fabricated output", async () => {
  const controller = new AbortController(); controller.abort();
  const noCall = fixture(async () => { throw new Error("Must not call"); });
  await assert.rejects(noCall.client.chat(prompt, { signal: controller.signal }), { code: "AI_CANCELLED" });
  const timed = fixture(async (_url, init) => new Promise<Response>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture timeout")), 2000);
    init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
  }));
  await assert.rejects(timed.client.chat(prompt), { code: "AI_TIMEOUT" });
  const missing = fixture(async () => { throw new Error("Must not call"); }, { apiKey: "" });
  await assert.rejects(missing.client.chat(prompt), { code: "AI_UNAVAILABLE" }); assert.equal(missing.ledger.started.length, 0);
});

test("embeddings map shuffled indices and enforce model, dimension, finite values and complete batches", async () => {
  const profile = { model: "test/embedding", dimensions: 1536, normalization: "provider" as const, chunkerVersion: "v1" };
  const vector = Array.from({ length: 1536 }, () => 0.1);
  const { client } = fixture(async (url, init) => {
    assert.match(String(url), /\/embeddings$/); const body = JSON.parse(String(init?.body)); assert.equal(body.encoding_format, "float");
    return json({ model: profile.model, data: [{ index: 1, embedding: vector.map(() => 0.2) }, { index: 0, embedding: vector }] });
  });
  const result = await client.embed(["one", "two"], profile); assert.equal(result.vectors[0][0], 0.1); assert.equal(result.vectors[1][0], 0.2);
  assert.equal(result.profile.model, profile.model); assert.equal(result.profileKey.length, 64);
  for (const data of [
    { model: "wrong/model", data: [{ index: 0, embedding: vector }] },
    { model: profile.model, data: [{ index: 0, embedding: [1] }] },
    { model: profile.model, data: [{ index: 0, embedding: vector.map(() => 0) }] },
    { model: profile.model, data: [{ index: 0, embedding: vector }, { index: 0, embedding: vector }] },
  ]) await assert.rejects(fixture(async () => json(data)).client.embed(["one"], profile), { code: "AI_PROFILE" });
  await assert.rejects(client.embed(["one"], { ...profile, dimensions: 768 }), { code: "AI_PROFILE" });
});

test("OpenRouter OpenAI upstream model aliases preserve the selected embedding profile", async () => {
  const model = "openai/text-embedding-3-small", vector = Array.from({ length: 1536 }, () => 0.1);
  const profile = { model, dimensions: 1536, normalization: "provider" as const, chunkerVersion: "v1" };
  const client = fixture(async () => json({ model: "text-embedding-3-small", data: [{ index: 0, embedding: vector }] }), { embeddingModel: model }).client;
  assert.equal((await client.embed(["synthetic"], profile)).profile.model, model);
  const wrong = fixture(async () => json({ model: "text-embedding-3-large", data: [{ index: 0, embedding: vector }] }), { embeddingModel: model }).client;
  await assert.rejects(wrong.embed(["synthetic"], profile), { code: "AI_PROFILE" });
});

test("reranking preserves input IDs, validates indices and falls back in original order without invented scores", async () => {
  const candidates = [{ id: "a", text: "First scoped source" }, { id: "b", text: "Second scoped source" }];
  const { client } = fixture(async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).documents, candidates.map((c) => c.text));
    return json({ results: [{ index: 1, relevance_score: 0.8 }, { index: 0, relevance_score: 0.2 }] });
  });
  assert.deepEqual((await client.rerank("query", candidates, 2)).results.map((r) => r.id), ["b", "a"]);
  const bad = fixture(async () => json({ results: [{ index: 2, relevance_score: 1 }, { index: 0, relevance_score: 1 }] }));
  const fallback = await bad.client.rerank("query", candidates, 2);
  assert.equal(fallback.reranked, false); assert.deepEqual(fallback.results.map((r) => r.id), ["a", "b"]); assert.equal(fallback.results[0].score, null);
  await assert.rejects(bad.client.rerank("query", candidates, 2, { fallback: false }), { code: "AI_MALFORMED" });
});

test("graph structured output must quote exact Unicode code-point spans and existing endpoints", async () => {
  const response = { concepts: [{ name: "A", description: "" }, { name: "B", description: "" }], relations: [{ from: "A", to: "B", type: "supports", quote: "A supports B", startOffset: 2, endOffset: 14 }] };
  const { client } = fixture(async () => json(completion(JSON.stringify(response))));
  assert.equal((await new AIContentService(client).extractGraph("😀 A supports B")).relations.length, 1);
  response.relations[0].quote = "An invented quote";
  await assert.rejects(new AIContentService(client).extractGraph("😀 A supports B"), { code: "AI_MALFORMED" });
});
