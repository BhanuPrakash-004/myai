import path from "node:path";
import { z } from "zod";

const booleanEnv = z.enum(["true", "false"]).transform((value) => value === "true");
const environment = z.object({
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value), "Use a PostgreSQL connection URL"),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(2).max(30).default(5),
  APP_URL: z.url().default("http://localhost:3000"),
  DATA_DIR: z.string().min(1).default("data/attachments"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_CHAT_MODEL: z.string().optional(),
  OPENROUTER_STRUCTURED_MODEL: z.string().optional(),
  OPENROUTER_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  OPENROUTER_RERANK_MODEL: z.string().default("cohere/rerank-v3.5"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().refine((value) => value === 1536, "The installed vector schema requires 1536 dimensions").default(1536),
  AI_INDEXING_ENABLED: booleanEnv.default(false),
  RERANK_ENABLED: booleanEnv.default(false),
});

export function readStorageConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = environment.safeParse(env);
  if (!parsed.success) {
    // Zod's original object may include credentials. Report field names only.
    throw new Error("Invalid storage configuration: " + [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", "));
  }
  return { ...parsed.data, DATA_DIR: path.resolve(parsed.data.DATA_DIR) };
}
