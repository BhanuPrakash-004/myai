import { z } from "zod";
import { getAIProvider } from "@/lib/ai";
import { checkConnection, checkTask } from "@/lib/ai/checks";
import { publicAIConfig } from "@/lib/ai/preferences";
import { privateRoute, jsonBody } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime = "nodejs";
export const POST = privateRoute(async (request) => {
  const ai = await getAIProvider();
  const input = request.headers.get("content-type")?.includes("application/json")
    ? z.object({ task: checkTask.optional(), live: z.boolean().optional() }).strict().parse(await jsonBody(request, 4096)) : {};
  if (!input.live || !input.task) return ok({ configured: await ai.isAvailable(), effective: publicAIConfig(ai.config), message: "Configuration only. Choose a live task check to verify provider support." });
  return ok({ result: await checkConnection(ai, input.task, request.signal) });
});
