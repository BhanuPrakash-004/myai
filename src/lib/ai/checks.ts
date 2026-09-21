import { z } from "zod";
import type { OpenRouterClient } from "./openrouter";
import { safeAIError } from "./errors";
export const checkTask = z.enum(["chat", "structured", "embeddings", "rerank"]);
export async function checkConnection(client: OpenRouterClient, task: z.infer<typeof checkTask>, signal?: AbortSignal) {
  const started = Date.now();
  try {
    if (task === "chat") await client.chat([{ role: "user", content: "Reply with the word ready." }], { signal, maxTokens: 128 });
    if (task === "structured") await client.chatStructured([{ role: "user", content: 'Return {"ready":true}.' }], z.object({ ready: z.literal(true) }).strict(), { signal, maxTokens: 128 });
    if (task === "embeddings") await client.embed(["A synthetic connection check."], { model: client.config.embeddingModel, dimensions: client.config.embeddingDimensions, normalization: "provider", chunkerVersion: "connection-check-v1" }, { signal });
    if (task === "rerank") {
      if (!client.config.rerankEnabled) return { task, ok: false, code: "RERANK_DISABLED", message: "Enable reranking before running its check.", durationMs: 0 };
      await client.rerank("Which sentence mentions Java?", [{ id: "java", text: "Java is a programming language." }, { id: "tree", text: "A tree has leaves." }], 2, { signal, fallback: false });
    }
    const model = task === "chat" ? client.config.chatModel : task === "structured" ? client.config.structuredModel : task === "embeddings" ? client.config.embeddingModel : client.config.rerankModel;
    return { task, ok: true, model, dimensions: task === "embeddings" ? client.config.embeddingDimensions : undefined, durationMs: Date.now() - started };
  } catch (cause) {
    const error = safeAIError(cause, signal);
    return { task, ok: false, code: error.code, message: error.message, durationMs: Date.now() - started };
  }
}
