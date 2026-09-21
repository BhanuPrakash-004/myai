import { settings } from "@/lib/storage/settings";
import { getStorage } from "@/lib/storage/client";
import { UsageService } from "@/lib/storage/usage";
import { publicAIConfig, resolveAIConfig } from "@/lib/ai/preferences";
import { privateRoute, jsonBody } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime = "nodejs";
export const GET = privateRoute(async () => {
  const saved = await settings().read(), config = resolveAIConfig(saved);
  return ok({ settings: saved, effective: publicAIConfig(config), storage: "PostgreSQL", hasApiKey: Boolean(config.apiKey),
    chatModel: config.chatModel, provider: "OpenRouter", usage: await new UsageService(getStorage().pool, config).summary() });
});
export const POST = privateRoute(async (request) => ok({ settings: await settings().save(await jsonBody(request)) }));
