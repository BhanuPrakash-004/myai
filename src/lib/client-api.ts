"use client";
const pendingKeys = new Map<string, string>();
export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers), method = init.method ?? "GET";
  const signature = method + ":" + input + ":" + (typeof init.body === "string" ? init.body : "upload");
  const writes = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (writes && !headers.has("Idempotency-Key")) {
    const key = pendingKeys.get(signature) ?? crypto.randomUUID();
    pendingKeys.set(signature, key); headers.set("Idempotency-Key", key);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401)) pendingKeys.delete(signature);
  if (response.status === 401) window.dispatchEvent(new Event("myai:session-expired"));
  return response;
}
