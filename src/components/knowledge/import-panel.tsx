"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client-api";
import { changed, message } from "./shared";
interface Item { path: string; status: string; expectedVersion?: number; noteId?: string }
export function ImportPanel({ folderId }: { folderId: string }) {
  const [file, setFile] = useState<File | null>(null), [items, setItems] = useState<Item[]>([]);
  const [policy, setPolicy] = useState("skip"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID()), [done, setDone] = useState(false), [previewed, setPreviewed] = useState(false);
  async function send(preview: boolean) {
    if (!file) return; setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("folderId", folderId); form.set("action", preview ? "preview" : "import"); form.set("policy", policy);
      form.set("expectedVersions", JSON.stringify(Object.fromEntries(items.filter(i => i.expectedVersion).map(i => [i.path, i.expectedVersion]))));
      const response = await apiFetch("/api/import", { method: "POST", headers: { "Idempotency-Key": key }, body: form });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setItems(result.items); setPreviewed(preview); setDone(!preview); if (!preview) changed();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="space-y-3"><p className="text-sm">Import UTF-8 Markdown, text or code, individually or in a ZIP. Limits: 10 MB upload, 200 files, 1 MB per file, 20 MB expanded. PDF, images, Office files and ChatGPT JSON exports are unsupported.</p>
    <label className="block text-sm">File<input type="file" disabled={busy} className="mt-2 block max-w-full" accept=".md,.txt,.zip,.java,.js,.jsx,.ts,.tsx,.py,.c,.cpp,.h,.cs,.go,.rs,.sql,.sh,.css,.html,.json,.yaml,.yml" onChange={e => { setFile(e.target.files?.[0] || null); setItems([]); setPreviewed(false); setDone(false); setKey(crypto.randomUUID()); }} /></label>
    <label className="block text-sm">Existing content<select disabled={busy || done} className="ml-2 rounded border border-line bg-ink-2 p-2" value={policy} onChange={e => { setPolicy(e.target.value); setKey(crypto.randomUUID()); }}><option value="skip">Skip unchanged and existing paths</option><option value="create">Create a separate copy</option><option value="merge">Append to existing note after preview</option></select></label>
    <p className="text-xs text-mist">Merge preserves the old note and appends the imported text in a new version. Original source text and upload are retained. All files commit together; an interrupted upload can be retried.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex gap-2"><Button disabled={!file || busy} variant="outline" onClick={() => send(true)}>{busy ? "Processing…" : "Preview files"}</Button>{previewed && !done && <Button disabled={busy} onClick={() => send(false)}>Import {items.length} files</Button>}</div>
    {done && <p role="status">Import complete. Created and merged notes are queued for indexing.</p>}
    <ul className="max-h-80 space-y-2 overflow-auto text-sm">{items.map(i => <li key={i.path} className="break-all rounded border border-line p-2">{i.noteId ? <Link className="underline" href={"/notes/" + i.noteId}>{i.path}</Link> : i.path} · {i.status}{i.expectedVersion ? ` · current v${i.expectedVersion}` : ""}</li>)}</ul>
  </section>;
}
