import { z } from "zod";

export const modelId = z.string().trim().min(3).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/+-]*$/).refine((v) => v.includes("/") && !v.includes("://"), "Use an OpenRouter model ID, not a URL.");
export const preferencesSchema = z.object({
  chatModel: modelId.optional(), structuredModel: modelId.optional(),
  embeddingModel: modelId.optional(), rerankModel: modelId.optional(),
  embeddingDimensions: z.literal(1536).optional(),
  aiIndexingEnabled: z.boolean().optional(), rerankEnabled: z.boolean().optional(),
  graphExpansionEnabled: z.boolean().optional(),
  maxOutputTokens: z.number().int().min(128).max(32768).optional(),
  dailyRequestLimit: z.number().int().min(1).max(100000).optional(),
  dailyTokenBudget: z.number().int().min(1000).max(100000000).optional(),
  timezone: z.string().max(100).refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }).optional(),
}).strict();
export type AIPreferences = z.infer<typeof preferencesSchema>;
export interface AIConfig {
  apiKey: string; chatModel: string; structuredModel: string; embeddingModel: string; rerankModel: string;
  embeddingDimensions: 1536; aiIndexingEnabled: boolean; rerankEnabled: boolean;
  graphExpansionEnabled: boolean;
  maxOutputTokens: number; dailyRequestLimit: number; dailyTokenBudget: number;
}
export function resolveAIConfig(saved: AIPreferences = {}, env: Record<string, string | undefined> = process.env): AIConfig {
  const optionalModel = (key: string) => env[key]?.trim() || undefined;
  const flag = (key: string) => env[key] === undefined ? undefined : z.enum(["true", "false"]).parse(env[key]) === "true";
  try {
    const values = preferencesSchema.parse({
      chatModel: optionalModel("OPENROUTER_CHAT_MODEL"), structuredModel: optionalModel("OPENROUTER_STRUCTURED_MODEL"),
      embeddingModel: optionalModel("OPENROUTER_EMBEDDING_MODEL"), rerankModel: optionalModel("OPENROUTER_RERANK_MODEL"),
      embeddingDimensions: env.EMBEDDING_DIMENSIONS ? Number(env.EMBEDDING_DIMENSIONS) : 1536,
      aiIndexingEnabled: flag("AI_INDEXING_ENABLED"), rerankEnabled: flag("RERANK_ENABLED"),
      graphExpansionEnabled: flag("GRAPH_EXPANSION_ENABLED"),
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS ? Number(env.AI_MAX_OUTPUT_TOKENS) : undefined,
      dailyRequestLimit: env.AI_DAILY_REQUEST_LIMIT ? Number(env.AI_DAILY_REQUEST_LIMIT) : undefined,
      dailyTokenBudget: env.AI_DAILY_TOKEN_BUDGET ? Number(env.AI_DAILY_TOKEN_BUDGET) : undefined,
      ...saved,
    });
    return { apiKey: env.OPENROUTER_API_KEY?.trim() || "", chatModel: values.chatModel || "", structuredModel: values.structuredModel || "",
      embeddingModel: values.embeddingModel || "openai/text-embedding-3-small", rerankModel: values.rerankModel || "cohere/rerank-v3.5",
      embeddingDimensions: 1536, aiIndexingEnabled: values.aiIndexingEnabled ?? false, rerankEnabled: values.rerankEnabled ?? false,
      graphExpansionEnabled: values.graphExpansionEnabled ?? false,
      maxOutputTokens: values.maxOutputTokens ?? 4096, dailyRequestLimit: values.dailyRequestLimit ?? 200, dailyTokenBudget: values.dailyTokenBudget ?? 200000 };
  } catch { throw new Error("Invalid AI configuration. Check model IDs, dimensions, toggles and limits."); }
}
export function publicAIConfig(config: AIConfig) {
  const { apiKey, ...preferences } = config;
  return { ...preferences, hasApiKey: Boolean(apiKey) };
}
