import { getStorage } from "@/lib/storage/client";
import { privateRoute } from "@/lib/http";
import { ok } from "@/lib/api";
import { processingStatus } from "@/lib/worker/admin";
export const runtime = "nodejs";
export const GET = privateRoute(async () => ok(await processingStatus(getStorage().pool)));
