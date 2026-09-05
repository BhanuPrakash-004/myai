import path from "path";

export const config = {
  appName: process.env.APP_NAME || "MyAI",
  vaultPath: process.env.VAULT_PATH
    ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.VAULT_PATH)
    : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "vault"),
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH)
    : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data", "myai.db"),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.1",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  aiProvider: (process.env.AI_PROVIDER || "auto") as "auto" | "ollama" | "openai" | "mock",
};
