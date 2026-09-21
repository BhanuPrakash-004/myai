import { NextRequest } from "next/server";
import { getAuth, assertSameOrigin } from "@/lib/auth/server";
import { allowLogin } from "@/lib/auth/owner";
import { getStorage } from "@/lib/storage/client";
import { errorResponse, readBody } from "@/lib/http";
import { fail } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest) {
  try {
    const path = new URL(request.url).pathname.slice("/api/auth".length);
    if (!((request.method === "GET" && path === "/get-session") || (request.method === "POST" && ["/sign-in/email", "/sign-out"].includes(path)))) return fail("Authentication endpoint unavailable.", 404);
    assertSameOrigin(request);
    if (path === "/sign-in/email" && !await allowLogin(getStorage().pool)) return Response.json({ error: "Too many sign-in attempts. Try again in one minute." }, { status: 429, headers: { "Retry-After": "60" } });
    const bounded = request.method === "POST" ? new Request(request.url, { method: request.method, headers: request.headers, body: await readBody(request, 8192) }) : request;
    const response = await getAuth().handler(bounded);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return errorResponse(error); }
}
export const GET = handle;
export const POST = handle;
