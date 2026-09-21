"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { apiFetch } from "@/lib/client-api";
export const ROOT = "00000000-0000-0000-0000-000000000001";
export interface FolderRecord { id: string; parent_id: string | null; name: string; path: string; sort_order: number; aliases: string[] }
export interface NoteRecord { id: string; folder_id: string; title: string; body: string; path: string; current_version: number; importance: number; lifecycle: "active" | "archived" | "trashed"; provenance: "user_written" | "imported" | "ai_generated" | "ai_improved" | "migrated_unknown"; metadata: Record<string, unknown> }
export interface SavedReceipt { noteId: string; version: number; path: string; operationId: string }
export interface Proposal { id: string; original: string; originalTitle: string; title: string; body: string; changes: string[]; uncertainties: string[]; model: string; receipt?: SavedReceipt }
export class RequestError extends Error { constructor(message: string, public status: number, public details?: Record<string, unknown>) { super(message); } }
export async function request<T>(url: string, method = "GET", body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { method, signal, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new RequestError(result.error || "Request failed. Your draft is preserved.", response.status, result.details);
  return result;
}
export const message = (error: unknown) => error instanceof Error ? error.message : "The operation failed. Please retry.";
export function changed() { window.dispatchEvent(new Event("myai:knowledge-changed")); }
export function Markdown({ body }: { body: string }) { return <article className="prose-vault min-w-0 break-words text-sm leading-7 [&_pre]:overflow-x-auto"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
  a: ({ href, children }) => <a href={href} rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>,
  // Imported notes are untrusted: do not contact tracking/image hosts on render.
  img: ({ src, alt }) => typeof src === "string" && /^https?:\/\//i.test(src)
    ? <a href={src} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">[Image: {alt || "open external image"}]</a>
    : <span>[Image: {alt || "not displayed"}]</span>,
}}>{body}</ReactMarkdown></article>; }
export function Destination({ folders, value, onChange, disabled }: { folders: FolderRecord[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="block text-sm">Destination<select className="mt-1 w-full rounded border border-line bg-ink-2 p-2" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{folders.map((f) => <option key={f.id} value={f.id}>{f.path ? "/" + f.path : "/ (Root)"}</option>)}</select></label>;
}
