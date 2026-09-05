import { AIProvider } from "./provider";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { SmartFallbackProvider } from "./smart-fallback";
import { config } from "../config";

let cachedProvider: AIProvider | null = null;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000; // re-check availability every 30s

export async function getAIProvider(): Promise<AIProvider> {
  const now = Date.now();
  if (cachedProvider && now - lastCheckTime < CHECK_INTERVAL) {
    return cachedProvider;
  }

  // Explicit OpenAI
  if (config.aiProvider === "openai" && config.openaiApiKey) {
    cachedProvider = new OpenAIProvider();
    lastCheckTime = now;
    return cachedProvider;
  }

  // Check Ollama
  const ollama = new OllamaProvider();
  const ollamaAvailable = await ollama.isAvailable();
  if (ollamaAvailable) {
    cachedProvider = ollama;
    lastCheckTime = now;
    return cachedProvider;
  }

  // If OpenAI key is set and Ollama is not running, use OpenAI
  if (config.openaiApiKey) {
    const openai = new OpenAIProvider();
    cachedProvider = openai;
    lastCheckTime = now;
    return cachedProvider;
  }

  // Fallback to built-in smart engine
  cachedProvider = new SmartFallbackProvider();
  lastCheckTime = now;
  return cachedProvider;
}

export * from "./provider";
