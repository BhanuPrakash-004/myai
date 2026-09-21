import { NextResponse } from "next/server";

/**
 * Shared API helpers — standard envelope + validation.
 *
 * Success envelope: { success: true, ...data }
 * Error envelope:   { success: false, error: string, details?: unknown }
 * Extra keys are preserved so existing frontends keep working
 * (they read `data.tree`, `data.items`, `data.results`, etc.).
 */

export function ok<T extends Record<string, unknown>>(data: T, init?: { status?: number; headers?: HeadersInit }) {
  return NextResponse.json({ success: true, ...data }, { status: init?.status ?? 200, headers: init?.headers });
}

export function fail(error: string, status = 500, details?: unknown) {
  return NextResponse.json(
    { success: false, error, ...(details !== undefined ? { details } : {}) },
    { status }
  );
}

export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? Math.floor(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getLimit(searchParams: URLSearchParams, fallback: number, max = 50): number {
  return clampInt(searchParams.get("limit") ?? searchParams.get("count"), fallback, 1, max);
}

export function getNonEmptyString(value: unknown, maxLen = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** Strict boolean coercion — fixes Boolean("false") === true bug. */
export function toBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes" || t === "y";
  }
  return Boolean(value);
}

const REL_PATH_RE = /^[A-Za-z0-9 _\-./()+,']+$/;

/** Validate a vault-relative markdown path. Prevents traversal + absolute paths. */
export function validateRelMdPath(relPath: string, opts?: { allowEmpty?: boolean }): string | null {
  if (typeof relPath !== "string") return "Path must be a string";
  const p = relPath.trim().replace(/\\/g, "/");
  if (!p) return opts?.allowEmpty ? null : "Path is required";
  if (p.length > 300) return "Path too long (max 300 chars)";
  if (p.startsWith("/") || p.includes("\0")) return "Invalid path";
  if (p.split("/").includes("..")) return "Path traversal not allowed";
  if (!REL_PATH_RE.test(p)) return "Path contains invalid characters";
  if (!p.toLowerCase().endsWith(".md")) return "Only .md files are supported";
  if (p.includes("//")) return "Invalid path";
  return null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function logApiError(route: string, error: unknown) {
  console.error(`[api:${route}]`, error instanceof Error ? error.message : error);
}
