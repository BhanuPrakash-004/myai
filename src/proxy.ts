import { NextRequest, NextResponse } from "next/server";

// Navigation convenience only; pages, APIs and domain services verify access separately.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-myai-return-to", request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
