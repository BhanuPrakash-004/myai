import { NextRequest } from "next/server";
import { privateRoute, jsonBody, operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
import { knowledge } from "@/lib/storage/knowledge";
import { ImprovementService } from "@/lib/storage/improvements";
import { getAIProvider } from "@/lib/ai";
import { z } from "zod";
export const runtime = "nodejs";
export const POST = privateRoute(async (r: NextRequest) => ok({ proposal: await new ImprovementService(knowledge()).propose(await jsonBody(r), operationKey(r), await getAIProvider(), r.signal) }));
export const PATCH = privateRoute(async (r: NextRequest) => {
  const { id, decision, changes } = z.object({ id: z.uuid(), decision: z.enum(["apply", "original", "reject", "cancel"]), changes: z.unknown().optional() }).strict().parse(await jsonBody(r));
  return ok(await new ImprovementService(knowledge()).decide(id, decision, changes, operationKey(r)));
});
