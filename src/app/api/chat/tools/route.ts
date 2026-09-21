import { NextRequest } from "next/server";
import { privateRoute, jsonBody, operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
import { knowledge } from "@/lib/storage/knowledge";
import { ChatTools } from "@/lib/storage/chat-tools";
import { getAIProvider } from "@/lib/ai";
export const runtime = "nodejs";
export const POST = privateRoute(async (r: NextRequest) => ok(await new ChatTools(knowledge()).execute(await jsonBody(r), operationKey(r), getAIProvider, r.signal)));
