// Node-only module: never import from a client component.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createParser } from "eventsource-parser";
import { z } from "zod";
import type { AIProvider, AIOptions, ChatMessage } from "./provider";
import type { AIConfig } from "./preferences";
import { AIError, providerError, safeAIError } from "./errors";
import type { Usage, UsageLedger } from "../storage/usage";

type Task = "chat" | "structured" | "embeddings" | "rerank";
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "completed"; model: string; usage: Usage }
  | { type: "failed"; status: "partial" | "failed" | "cancelled"; code: string; message: string };
export interface Candidate { id: string; text: string }
export interface EmbeddingProfile { model: string; dimensions: number; normalization: "provider"; chunkerVersion: string }
export interface EmbeddingProfileStore { record(profile: EmbeddingProfile): Promise<string> }
const messagesSchema = z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string().max(1000000) }).strict()).min(1).max(100);
const usageSchema = z.object({
  total_tokens: z.number().int().min(0).max(2147483647).optional(),
  prompt_tokens: z.number().int().min(0).max(2147483647).optional(),
  completion_tokens: z.number().int().min(0).max(2147483647).optional(),
  cost: z.number().finite().min(0).nullable().optional(),
});
function usageOf(data: Record<string, unknown>): Usage {
  const parsed = usageSchema.safeParse(data.usage);
  const value = parsed.success ? parsed.data : undefined;
  return { requestId: typeof data.id === "string" ? data.id.slice(0, 200) : undefined,
    tokens: value?.total_tokens, promptTokens: value?.prompt_tokens, completionTokens: value?.completion_tokens, cost: value?.cost ?? undefined };
}
function retryAfter(value: string | null) {
  if (!value) return 0;
  const numeric = Number(value);
  return Math.max(0, Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - Date.now()) || 0;
}
interface OpenRequest {
  response: Response; signal: AbortSignal;
  finish(outcome: string, usage: Usage): Promise<void>;
}
export class OpenRouterClient implements AIProvider {
  readonly id = "openrouter"; readonly name = "OpenRouter";
  constructor(readonly config: AIConfig, private ledger: UsageLedger, private transport: typeof fetch = fetch,
    private policy = { timeoutMs: 90000, maxRetries: 2, retryBaseMs: 400 }, private profileStore?: EmbeddingProfileStore) {}
  async isAvailable(task: "chat" | "structured" = "chat") { return Boolean(this.config.apiKey && (task === "structured" ? this.config.structuredModel : this.config.chatModel)); }
  private model(task: Task) {
    const model = task === "embeddings" ? this.config.embeddingModel : task === "rerank" ? this.config.rerankModel : task === "structured" ? this.config.structuredModel : this.config.chatModel;
    if (!this.config.apiKey || !model) throw new AIError("AI_UNAVAILABLE");
    return model;
  }
  private async open(task: Task, payload: Record<string, unknown>, options: AIOptions = {}): Promise<OpenRequest> {
    const model = this.model(task), body = JSON.stringify({ ...payload, model, provider: { require_parameters: true } });
    const bytes = Buffer.byteLength(body);
    if (bytes > 2000000) throw new AIError("AI_INVALID_REQUEST");
    const signal = AbortSignal.any([AbortSignal.timeout(this.policy.timeoutMs), ...(options.signal ? [options.signal] : [])]);
    const reserved = bytes + (typeof payload.max_tokens === "number" ? payload.max_tokens : 0);
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw safeAIError(null, signal);
      const ticket = await this.ledger.start(task, model, reserved, options.operationId), started = Date.now();
      let finalized = false;
      const finish = async (outcome: string, usage: Usage) => {
        if (finalized) return;
        await this.ledger.finish(ticket, outcome, usage, Date.now() - started); finalized = true;
      };
      let response: Response;
      try {
        response = await this.transport("https://openrouter.ai/api/v1/" + (task === "chat" || task === "structured" ? "chat/completions" : task), {
          method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.config.apiKey, "X-Title": "MyAI" }, body,
        });
      } catch {
        const error = signal.aborted ? safeAIError(null, signal) : new AIError("AI_PROVIDER", true);
        await finish(error.code, {});
        if (!error.retryable || attempt >= this.policy.maxRetries) throw error;
        await delay(this.policy.retryBaseMs * 2 ** attempt, undefined, { signal }).catch(() => { throw safeAIError(null, signal); }); continue;
      }
      if (response.ok) return { response, signal, finish };
      const error = providerError(response.status, retryAfter(response.headers.get("retry-after")));
      await response.body?.cancel();
      await finish(error.code, response.status < 500 ? { tokens: 0 } : {});
      // A long Retry-After is returned to the caller rather than violated.
      if (!error.retryable || attempt >= this.policy.maxRetries || error.retryAfterMs > 10000) throw error;
      await delay(Math.max(error.retryAfterMs, this.policy.retryBaseMs * 2 ** attempt), undefined, { signal }).catch(() => { throw safeAIError(null, signal); });
    }
  }
  private chatPayload(messages: ChatMessage[], options: AIOptions = {}) {
    messagesSchema.parse(messages);
    const maxTokens = options.maxTokens ?? this.config.maxOutputTokens;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > this.config.maxOutputTokens) throw new AIError("AI_INVALID_REQUEST");
    return { messages, max_tokens: maxTokens, temperature: z.number().min(0).max(2).parse(options.temperature ?? 0.3) };
  }
  private async readJSON(request: OpenRequest) {
    const reader = request.response.body?.getReader(); if (!reader) throw new AIError("AI_MALFORMED");
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        request.signal.throwIfAborted();
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 16000000) throw new AIError("AI_MALFORMED");
        chunks.push(value);
      }
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AIError("AI_MALFORMED");
      if (parsed.error) throw new AIError("AI_PROVIDER");
      return parsed as Record<string, unknown>;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private async json<T>(task: Task, payload: Record<string, unknown>, parse: (data: Record<string, unknown>) => T, options: AIOptions = {}) {
    let request: OpenRequest | undefined, usage: Usage = {};
    try {
      request = await this.open(task, payload, options);
      const data = await this.readJSON(request); usage = usageOf(data);
      const result = parse(data);
      await request.finish("completed", usage);
      return result;
    } catch (cause) {
      const error = safeAIError(cause, request?.signal ?? options.signal);
      await request?.finish(error.code, usage); throw error;
    }
  }
  private completion(data: Record<string, unknown>) {
    const parsed = z.object({ choices: z.array(z.object({
      finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
    })).length(1) }).parse(data);
    const choice = parsed.choices[0];
    if (choice.finish_reason !== "stop" || choice.message.refusal || !choice.message.content?.trim()) throw new AIError("AI_INCOMPLETE");
    return choice.message.content;
  }
  async chat(messages: ChatMessage[], options: AIOptions = {}) {
    return this.json("chat", { ...this.chatPayload(messages, options), stream: false }, (data) => this.completion(data), options);
  }
  async chatStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>, options: AIOptions = {}): Promise<T> {
    return this.json("structured", { ...this.chatPayload(messages, { ...options, temperature: 0 }), stream: false,
      response_format: { type: "json_schema", json_schema: { name: "myai_result", strict: true, schema: z.toJSONSchema(schema, { target: "draft-7" }) } },
    }, (data) => schema.parse(JSON.parse(this.completion(data))), options);
  }
  async *stream(messages: ChatMessage[], options: AIOptions = {}): AsyncGenerator<StreamEvent> {
    let request: OpenRequest | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let contentLength = 0, usage: Usage = {}, completed = false;
    try {
      request = await this.open("chat", { ...this.chatPayload(messages, options), stream: true, stream_options: { include_usage: true } }, options);
      if (!request.response.headers.get("content-type")?.includes("text/event-stream")) throw new AIError("AI_MALFORMED");
      reader = request.response.body?.getReader(); if (!reader) throw new AIError("AI_MALFORMED");
      const decoder = new TextDecoder("utf-8", { fatal: true }), events: string[] = [];
      const parser = createParser({ onEvent: (event) => events.push(event.data) });
      let stopped = false, doneMarker = false, received = 0;
      while (!doneMarker) {
        request.signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) { parser.feed(decoder.decode()); break; }
        received += part.value.byteLength; if (received > 8000000) throw new AIError("AI_MALFORMED");
        parser.feed(decoder.decode(part.value, { stream: true }));
        for (const payload of events.splice(0)) {
          if (doneMarker) throw new AIError("AI_MALFORMED");
          if (payload === "[DONE]") { doneMarker = true; continue; }
          const data = JSON.parse(payload);
          if (data.error) throw new AIError("AI_PROVIDER");
          if (data.usage || data.id) usage = { ...usage, ...Object.fromEntries(Object.entries(usageOf(data)).filter(([, v]) => v !== undefined)) };
          const parsed = z.object({ choices: z.array(z.object({
            index: z.literal(0).optional(), delta: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
            finish_reason: z.string().nullable().optional(),
          })).max(1) }).parse(data);
          const choice = parsed.choices[0]; if (!choice) continue;
          if (choice.delta.refusal) throw new AIError("AI_INCOMPLETE");
          const text = choice.delta.content || "";
          if (stopped && text) throw new AIError("AI_MALFORMED");
          if (choice.finish_reason) {
            if (choice.finish_reason !== "stop") throw new AIError("AI_INCOMPLETE");
            stopped = true;
          }
          if (text) { contentLength += text.length; if (contentLength > 1000000) throw new AIError("AI_MALFORMED"); yield { type: "delta", text }; }
        }
      }
      if (!doneMarker || !stopped || !contentLength) throw new AIError("AI_INCOMPLETE");
      await request.finish("completed", usage); completed = true;
      yield { type: "completed", model: this.config.chatModel, usage };
    } catch (cause) {
      const error = safeAIError(cause, request?.signal ?? options.signal);
      await request?.finish(error.code, usage); completed = true;
      yield { type: "failed", status: error.code === "AI_CANCELLED" ? "cancelled" : contentLength ? "partial" : "failed", code: error.code, message: error.message };
    } finally {
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
      if (!completed) await request?.finish("AI_CANCELLED", usage);
    }
  }
  async *chatStream(messages: ChatMessage[], options: AIOptions = {}): AsyncGenerator<string> {
    for await (const event of this.stream(messages, options)) {
      if (event.type === "delta") yield event.text;
      if (event.type === "failed") throw new AIError(event.code as AIError["aiCode"]);
    }
  }
  async embed(texts: string[], profile: EmbeddingProfile, options: AIOptions = {}) {
    z.array(z.string().min(1).max(32000)).min(1).max(64).parse(texts);
    z.string().min(1).max(100).parse(profile.chunkerVersion);
    if (profile.model !== this.config.embeddingModel || profile.dimensions !== this.config.embeddingDimensions || profile.normalization !== "provider" || !profile.chunkerVersion) throw new AIError("AI_PROFILE");
    const vectors = await this.json("embeddings", { input: texts, dimensions: profile.dimensions, encoding_format: "float" }, (data) => {
      const parsed = z.object({ model: z.string(), data: z.array(z.object({ index: z.number().int().min(0), embedding: z.array(z.number().finite()) })) }).parse(data);
      // OpenRouter passes through these OpenAI upstream response IDs without its
      // routing namespace. Accept only explicit verified aliases, never arbitrary
      // basename matches that could silently mix different embedding spaces.
      const responseAliases: Record<string, string> = {
        "openai/text-embedding-3-small": "text-embedding-3-small",
        "openai/text-embedding-3-large": "text-embedding-3-large",
        "openai/text-embedding-ada-002": "text-embedding-ada-002",
      };
      if ((parsed.model !== profile.model && parsed.model !== responseAliases[profile.model]) || parsed.data.length !== texts.length) throw new AIError("AI_PROFILE");
      const ordered: number[][] = new Array(texts.length), seen = new Set<number>();
      for (const row of parsed.data) {
        if (row.index >= texts.length || seen.has(row.index) || row.embedding.length !== profile.dimensions || !row.embedding.some((n) => Math.fround(n) !== 0) || row.embedding.some((n) => !Number.isFinite(Math.fround(n))) || !Number.isFinite(Math.hypot(...row.embedding))) throw new AIError("AI_PROFILE");
        seen.add(row.index); ordered[row.index] = row.embedding;
      }
      return ordered;
    }, options);
    return { profile: { ...profile }, profileId: await this.profileStore?.record(profile), profileKey: createHash("sha256").update(JSON.stringify([profile.model, profile.dimensions, profile.normalization, profile.chunkerVersion])).digest("hex"), vectors };
  }
  async rerank(query: string, candidates: Candidate[], topN: number, options: AIOptions & { fallback?: boolean } = {}) {
    z.string().min(1).max(8000).parse(query);
    z.array(z.object({ id: z.string().min(1), text: z.string().min(1).max(32000) }).strict()).max(100).parse(candidates);
    z.number().int().min(1).max(100).parse(topN);
    if (new Set(candidates.map((c) => c.id)).size !== candidates.length) throw new AIError("AI_INVALID_REQUEST");
    const fallback = (reason: string) => ({ results: candidates.slice(0, topN).map((candidate) => ({ ...candidate, score: null as number | null })), reranked: false, reason });
    if (!candidates.length || !this.config.rerankEnabled) return fallback("disabled");
    try {
      const results = await this.json("rerank", { query, documents: candidates.map((c) => c.text), top_n: Math.min(topN, candidates.length) }, (data) => {
        const parsed = z.object({ results: z.array(z.object({ index: z.number().int().min(0), relevance_score: z.number().finite() })) }).parse(data);
        if (parsed.results.length !== Math.min(topN, candidates.length)) throw new AIError("AI_MALFORMED");
        const seen = new Set<number>();
        for (const result of parsed.results) {
          if (result.index >= candidates.length || seen.has(result.index)) throw new AIError("AI_MALFORMED");
          seen.add(result.index);
        }
        return parsed.results.sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index)
          .map((result) => ({ ...candidates[result.index], score: result.relevance_score }));
      }, options);
      return { results, reranked: true, reason: null };
    } catch (cause) {
      const error = safeAIError(cause, options.signal);
      if (options.fallback === false || error.code === "AI_CANCELLED") throw error;
      return fallback(error.code);
    }
  }
}
