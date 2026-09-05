import { AIProvider } from "./provider";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { SmartFallbackProvider } from "./smart-fallback";
import { config } from "../config";
import { getDb } from "../db";

let cachedProvider: AIProvider | null = null;
let lastCheckTime = 0;
const CHECK_INTERVAL = 15000; // re-check availability every 15s

export function resetAIProviderCache() {
  cachedProvider = null;
  lastCheckTime = 0;
}

function getDynamicSettings(): Record<string, string> {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM app_settings").all() as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  } catch {
    return {};
  }
}

function resolveProviderDisplayName(baseUrl: string, defaultName = "BYOK / Cloud AI"): string {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("googleapis.com")) return "Google AI Studio (Gemini)";
  if (lower.includes("openrouter.ai")) return "OpenRouter";
  if (lower.includes("groq.com")) return "Groq";
  if (lower.includes("deepseek.com")) return "DeepSeek";
  if (lower.includes("openai.com")) return "OpenAI";
  return defaultName;
}

export async function getAIProvider(): Promise<AIProvider> {
  const now = Date.now();
  if (cachedProvider && now - lastCheckTime < CHECK_INTERVAL) {
    return cachedProvider;
  }

  const dbSettings = getDynamicSettings();
  const providerType = dbSettings.aiProvider || config.aiProvider || "auto";
  const apiKey = (dbSettings.openaiApiKey !== undefined ? dbSettings.openaiApiKey : config.openaiApiKey) || "";
  const baseUrl = (dbSettings.openaiBaseUrl || config.openaiBaseUrl || "https://api.openai.com/v1").trim();
  const model = (dbSettings.openaiModel || config.openaiModel || "gpt-4o-mini").trim();
  const ollamaUrl = (dbSettings.ollamaBaseUrl || config.ollamaBaseUrl || "http://localhost:11434").trim();
  const ollamaModel = (dbSettings.ollamaModel || config.ollamaModel || "llama3.1").trim();

  // 1. Explicit BYOK / Cloud Providers (Google AI Studio, OpenRouter, OpenAI, Groq, etc.)
  if (["openai", "byok", "google", "openrouter", "groq", "custom"].includes(providerType)) {
    if (apiKey) {
      const name = resolveProviderDisplayName(baseUrl);
      cachedProvider = new OpenAIProvider({ apiKey, baseUrl, model, name });
      lastCheckTime = now;
      return cachedProvider;
    }
  }

  // 2. Explicit Ollama
  if (providerType === "ollama") {
    const ollama = new OllamaProvider({ baseUrl: ollamaUrl, model: ollamaModel });
    const available = await ollama.isAvailable();
    if (available) {
      cachedProvider = ollama;
      lastCheckTime = now;
      return cachedProvider;
    }
  }

  // 3. Auto Mode:
  // Check if user has configured an API key in settings or env (BYOK)
  if (apiKey) {
    const name = resolveProviderDisplayName(baseUrl);
    const byokProvider = new OpenAIProvider({ apiKey, baseUrl, model, name });
    cachedProvider = byokProvider;
    lastCheckTime = now;
    return cachedProvider;
  }

  // Next check if local Ollama is running
  const ollama = new OllamaProvider({ baseUrl: ollamaUrl, model: ollamaModel });
  const ollamaAvailable = await ollama.isAvailable();
  if (ollamaAvailable) {
    cachedProvider = ollama;
    lastCheckTime = now;
    return cachedProvider;
  }

  // Fallback to built-in smart engine
  cachedProvider = new SmartFallbackProvider();
  lastCheckTime = now;
  return cachedProvider;
}

export * from "./provider";
