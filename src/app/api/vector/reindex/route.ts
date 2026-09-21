import { getStorage } from "@/lib/storage/client";
import { privateRoute, jsonBody } from "@/lib/http";
import { ok } from "@/lib/api";
import { requeue } from "@/lib/worker/admin";
export const runtime = "nodejs";
export const POST = privateRoute(async (request) => ok(await requeue(getStorage().pool, await jsonBody(request))));
