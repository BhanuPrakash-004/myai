import { NextRequest } from "next/server";
import { z } from "zod";
import { asOwner, DomainError } from "./storage/access";
import { ownerSession, assertSameOrigin } from "./auth/server";
import { fail } from "./api";

export function errorResponse(error: unknown) {
  if (error instanceof DomainError) return fail(error.message, error.status, { code: error.code, ...((error.details ?? {}) as object) });
  if (error instanceof z.ZodError) return fail("Invalid request fields.", 400, error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  if (error instanceof SyntaxError) return fail("Invalid JSON body.", 400);
  const code = (error as { code?: string })?.code;
  if (code === "23505") return fail("A record with that identity or path already exists.", 409);
  if (["23503", "23514", "P0001"].includes(code ?? "")) return fail("The operation violates a storage constraint. Check the target and version.", 409);
  console.error("[request] Operation failed", code ?? (error instanceof Error ? error.name : "Unknown"));
  return fail("The operation could not be completed. Check the server configuration and try again.", 500);
}
export function privateRoute<C>(handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: NextRequest, context: C): Promise<Response> => {
    try {
      const session = await ownerSession(request.headers);
      if (!session) return fail("Your session has expired. Sign in to continue.", 401);
      assertSameOrigin(request);
      const response = await asOwner(session.user.id, () => handler(request, context));
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch (error) { return errorResponse(error); }
  };
}
export async function jsonBody(request: Request, maxBytes = 1_100_000) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new DomainError("CONTENT_TYPE", "Use application/json.", 415);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBody(request, maxBytes)));
}
export async function readBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new DomainError("TOO_LARGE", "Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 30_000);
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new DomainError("TOO_LARGE", "Request is too large.", 413); }
      parts.push(value);
    }
    if (expired) throw new DomainError("BODY_TIMEOUT", "Request body timed out. Retry the upload.", 408);
  } finally { clearTimeout(timer); reader.releaseLock(); }
  return Buffer.concat(parts);
}
export function operationKey(request: Request) {
  return z.string().min(8).max(200).parse(request.headers.get("idempotency-key"));
}
