import { OpenRouterClient } from "./openrouter";
import { settings } from "../storage/settings";
import { getStorage } from "../storage/client";
import { UsageService } from "../storage/usage";
import { resolveAIConfig } from "./preferences";
import { EmbeddingProfiles } from "../storage/embedding-profiles";
export async function getAIProvider() {
  const config = resolveAIConfig(await settings().read());
  return new OpenRouterClient(config, new UsageService(getStorage().pool, config), fetch, undefined, new EmbeddingProfiles(getStorage().pool));
}
