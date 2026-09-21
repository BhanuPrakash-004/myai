import { NextRequest } from "next/server";
import { privateRoute, jsonBody, operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
import { getStorage, ROOT_FOLDER_ID } from "@/lib/storage/client";
import { PracticeService } from "@/lib/storage/practice";
import { studyAction } from "@/lib/study/contracts";
import { getAIProvider } from "@/lib/ai";
export const runtime = "nodejs";
export const GET = privateRoute(async (r: NextRequest) => {
  const service = new PracticeService(getStorage().pool), id = r.nextUrl.searchParams.get("sessionId");
  return ok(id ? await service.session(id) : await service.overview(r.nextUrl.searchParams.get("folderId") || ROOT_FOLDER_ID));
});
export const POST = privateRoute(async (r: NextRequest) => {
  const input = studyAction.parse(await jsonBody(r));
  return ok(await new PracticeService(getStorage().pool).act(input, operationKey(r), ["generate", "answer"].includes(input.action) ? await getAIProvider() : undefined, r.signal));
});
