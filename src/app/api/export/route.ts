import { NextRequest } from "next/server";
import { privateRoute } from "@/lib/http";
import { getStorage } from "@/lib/storage/client";
import { exportNotes } from "@/lib/storage/export";
export const runtime = "nodejs";
export const GET = privateRoute(async (r: NextRequest) => new Response(new Uint8Array(await exportNotes(getStorage().pool, r.nextUrl.searchParams.get("includeInactive") === "true")), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="myai-notes.zip"' } }));
