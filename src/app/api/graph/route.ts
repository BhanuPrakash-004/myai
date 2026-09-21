import { NextRequest } from "next/server";
import { GraphService } from "@/lib/storage/graph";
import { getStorage } from "@/lib/storage/client";
import { privateRoute, jsonBody, operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
import { z } from "zod";
export const runtime = "nodejs";
export const GET = privateRoute(async (r: NextRequest) => {
  const p = r.nextUrl.searchParams;
  return ok(await new GraphService(getStorage().pool).neighborhood({ folderId: p.get("folderId") || undefined, nodeId: p.get("nodeId") || undefined,
    noteId: p.get("noteId") || undefined, query: p.get("q") || "", includeDisabled: p.get("includeDisabled") === "true", offset: z.coerce.number().int().min(0).max(10000).parse(p.get("offset") ?? 0) }));
});
export const POST = privateRoute(async (r: NextRequest) => ok(await new GraphService(getStorage().pool).change(await jsonBody(r), operationKey(r))));
