import { NextRequest } from "next/server";
import { privateRoute } from "@/lib/http";
import { ok } from "@/lib/api";
import { ChatService } from "@/lib/storage/chat";
import { getStorage } from "@/lib/storage/client";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = privateRoute(async (_r: NextRequest, c: Context) => ok({ operation: await new ChatService(getStorage().pool).status((await c.params).id) }));
export const DELETE = privateRoute(async (_r: NextRequest, c: Context) => ok({ operation: await new ChatService(getStorage().pool).cancel((await c.params).id) }));
